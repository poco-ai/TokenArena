import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { aggregateToBuckets } from "../domain/aggregator";
import { extractSessions } from "../domain/session-extractor";
import type {
  ParseResult,
  SessionEvent,
  TokenUsageEntry,
} from "../domain/types";
import {
  extractSessionId,
  findJsonlFiles,
  readFileSafe,
} from "../infrastructure/fs/utils";
import { registerParser } from "./registry";
import type { IParser, ToolDefinition } from "./types";

const TOOL_ID = "qodercli";
const TOOL_NAME = "Qoder CLI";
const DEFAULT_PROJECTS_DIR = join(homedir(), ".qoder", "projects");
const DEFAULT_LOGS_DIR = join(homedir(), ".qoder", "logs", "sessions");
const DEFAULT_RUNS_DIR = join(homedir(), ".qoder", "logs", "runs");

/**
 * qodercli (the CLI) — not the Qoder IDE.
 *
 * Both products write under ~/.qoder, distinguished by `entrypoint`:
 *   - "cli" → qodercli (this parser)
 *   - "acp" → Qoder IDE via ACP (ignored here)
 *
 * ---------------------------------------------------------------------------
 * IMPORTANT — no local token data, only credits
 * ---------------------------------------------------------------------------
 * qodercli does NOT persist usable per-request token counts on this machine:
 *   - project transcripts have no `message.usage`
 *   - log segments write `input_tokens` / `output_tokens` but they are always 0
 *
 * What we DO have is Qoder **credits** from the quota API, cached in run logs:
 *   ~/.qoder/logs/runs/<runId>/qodercli.log
 *   GET https://openapi.qoder.sh/api/v2/quota/usage
 *   → userQuota.used + orgResourcePackage.used + addOnQuota.used (unit: credits)
 *
 * Therefore TokenUsageEntry fields for this source store **credits, not tokens**:
 *   - inputTokens  = credit delta since the previous quota snapshot
 *   - outputTokens / reasoningTokens / cachedTokens = 0
 *   - totalTokens  (after aggregation) = credit delta
 *
 * Session timing still comes from cli project transcripts (user/assistant turns).
 * ---------------------------------------------------------------------------
 *
 * Session storage (Claude-compatible layout):
 *   ~/.qoder/projects/<encoded-cwd>/<sessionId>.jsonl
 */

/** Only qodercli sessions; IDE ACP sessions are excluded. */
const CLI_ENTRYPOINT = "cli";
const IDE_ENTRYPOINT = "acp";

/** Synthetic model label when run log has no model; still marks unit as credits. */
const CREDIT_MODEL_FALLBACK = "credits";

function createToolDefinition(projectsDir: string): ToolDefinition {
  return {
    id: TOOL_ID,
    name: TOOL_NAME,
    dataDir: projectsDir,
  };
}

function toSafeNumber(value: unknown): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

/** Normalize path separators so prefix matching works on Windows and Unix. */
function normalizeForPrefix(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function extractQoderProject(
  filePath: string,
  projectsDir: string,
): string {
  const normalizedFilePath = normalizeForPrefix(filePath);
  const normalizedProjectsDir = normalizeForPrefix(projectsDir);
  const prefix = `${normalizedProjectsDir}/`;
  if (!normalizedFilePath.startsWith(prefix)) return "unknown";
  const relative = normalizedFilePath.slice(prefix.length);
  const firstSeg = relative.split("/")[0];
  if (!firstSeg) return "unknown";
  const parts = firstSeg.split("-").filter(Boolean);
  return parts.length > 0 ? (parts[parts.length - 1] ?? "unknown") : "unknown";
}

/**
 * Classify a project transcript as qodercli vs Qoder IDE.
 * Returns "cli" only when at least one record has entrypoint "cli".
 * Pure "acp" (IDE) or unknown transcripts are not attributed to qodercli.
 */
export function classifyQoderEntrypoint(
  content: string,
): "cli" | "acp" | "unknown" {
  let hasCli = false;
  let hasAcp = false;

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line) as { entrypoint?: string };
      if (obj.entrypoint === CLI_ENTRYPOINT) hasCli = true;
      else if (obj.entrypoint === IDE_ENTRYPOINT) hasAcp = true;
    } catch {
      // Ignore malformed lines while classifying.
    }
    if (hasCli) return "cli";
  }

  if (hasAcp) return "acp";
  return "unknown";
}

function isQodercliBinaryPresent(): boolean {
  const home = homedir();
  const candidates = [
    join(home, ".local", "bin", "qodercli"),
    join(home, ".qoder", "bin", "qodercli"),
    join(home, ".qoder-cli"),
  ];
  return candidates.some((path) => existsSync(path));
}

function projectFromEncodedSlug(slug: string): string {
  const parts = slug.split("-").filter(Boolean);
  return parts.length > 0 ? (parts[parts.length - 1] ?? "unknown") : "unknown";
}

function projectFromCwd(cwd: string | undefined): string {
  if (!cwd) return "unknown";
  const leaf = basename(cwd.replace(/[\\/]+$/, ""));
  return leaf || "unknown";
}

interface QuotaBucket {
  used?: number;
  total?: number;
  remaining?: number;
  unit?: string;
}

interface QuotaUsageResponse {
  usageType?: string;
  userQuota?: QuotaBucket;
  orgResourcePackage?: QuotaBucket;
  addOnQuota?: QuotaBucket;
}

/**
 * Sum consumed credits across personal + org + addon pools.
 * NOTE: returns credits, not tokens.
 */
export function totalCreditsUsed(quota: QuotaUsageResponse): number {
  return (
    toSafeNumber(quota.userQuota?.used) +
    toSafeNumber(quota.orgResourcePackage?.used) +
    toSafeNumber(quota.addOnQuota?.used)
  );
}

interface CreditSnapshot {
  timestamp: Date;
  totalUsed: number;
  project: string;
  sessionId: string;
  model: string;
  runId: string;
}

interface RunManifest {
  run_id?: string;
  started_at?: string;
  cwd?: string;
  project_id?: string;
}

function parseRunManifest(content: string | null): RunManifest | null {
  if (!content) return null;
  try {
    return JSON.parse(content) as RunManifest;
  } catch {
    return null;
  }
}

/**
 * Extract credit snapshots from a single qodercli.log.
 * Values are credits from quota/usage — not token counters.
 */
export function extractCreditSnapshotsFromLog(
  logContent: string,
  meta: {
    project: string;
    runId: string;
    defaultSessionId?: string;
    defaultModel?: string;
  },
): CreditSnapshot[] {
  const snapshots: CreditSnapshot[] = [];
  let sessionId = meta.defaultSessionId || meta.runId;
  let model = meta.defaultModel || CREDIT_MODEL_FALLBACK;

  for (const line of logContent.split("\n")) {
    if (!line.trim()) continue;

    // session.config.loaded ... session=<id> ... model="efficient"
    if (line.includes("session.config.loaded")) {
      const sessionMatch = line.match(/session=([^\s\]]+)/);
      if (sessionMatch?.[1]) sessionId = sessionMatch[1];
      const modelMatch = line.match(/model="([^"]+)"/);
      if (modelMatch?.[1]) model = modelMatch[1];
    }

    // Quota API response body is logged inline as JSON (unit: credits).
    if (!line.includes("quota/usage response:")) continue;

    const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[^\s]+)/);
    const jsonMatch = line.match(/response:\s+(\{.*\})\s*$/);
    if (!tsMatch?.[1] || !jsonMatch?.[1]) continue;

    let quota: QuotaUsageResponse;
    try {
      quota = JSON.parse(jsonMatch[1]) as QuotaUsageResponse;
    } catch {
      continue;
    }

    const timestamp = new Date(tsMatch[1]);
    if (Number.isNaN(timestamp.getTime())) continue;

    snapshots.push({
      timestamp,
      // credits, not tokens
      totalUsed: totalCreditsUsed(quota),
      project: meta.project,
      sessionId,
      model,
      runId: meta.runId,
    });
  }

  return snapshots;
}

/**
 * Convert consecutive quota snapshots into credit-delta usage entries.
 * Negative deltas (quota reset / package refresh) are ignored.
 *
 * Mapping (credits → TokenUsageEntry fields):
 *   inputTokens = credit delta
 *   output/reasoning/cached = 0
 */
export function creditSnapshotsToEntries(
  snapshots: CreditSnapshot[],
): TokenUsageEntry[] {
  if (snapshots.length === 0) return [];

  const sorted = [...snapshots].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
  );

  const entries: TokenUsageEntry[] = [];
  let previousUsed: number | null = null;

  for (const snap of sorted) {
    if (previousUsed !== null) {
      const creditDelta = snap.totalUsed - previousUsed;
      // Only count consumption; skip resets (negative jumps).
      if (creditDelta > 0) {
        entries.push({
          sessionId: snap.sessionId,
          source: TOOL_ID,
          model: snap.model || CREDIT_MODEL_FALLBACK,
          project: snap.project,
          timestamp: snap.timestamp,
          // CREDIT counts (not tokens) — see file header.
          inputTokens: creditDelta,
          outputTokens: 0,
          reasoningTokens: 0,
          cachedTokens: 0,
        });
      }
    }
    previousUsed = snap.totalUsed;
  }

  return entries;
}

export class QoderCliParser implements IParser {
  readonly tool: ToolDefinition;

  constructor(
    private readonly projectsDir = DEFAULT_PROJECTS_DIR,
    private readonly logsDir = DEFAULT_LOGS_DIR,
    private readonly runsDir = DEFAULT_RUNS_DIR,
  ) {
    this.tool = createToolDefinition(projectsDir);
  }

  async parse(): Promise<ParseResult> {
    const entries: TokenUsageEntry[] = [];
    const sessionEvents: SessionEvent[] = [];

    // Sessions from cli transcripts (timing only — no token usage on disk).
    this.parseProjectSessions(sessionEvents);

    // Credits from quota snapshots in run logs (not tokens).
    entries.push(...this.parseCreditDeltas());

    return {
      buckets: aggregateToBuckets(entries),
      sessions: extractSessions(sessionEvents, entries),
    };
  }

  private parseProjectSessions(sessionEvents: SessionEvent[]): void {
    if (!existsSync(this.projectsDir)) return;

    for (const filePath of findJsonlFiles(this.projectsDir)) {
      if (basename(filePath).startsWith("verified-")) continue;

      const content = readFileSafe(filePath);
      if (!content) continue;

      // Shared ~/.qoder/projects holds both qodercli and Qoder IDE (acp).
      if (classifyQoderEntrypoint(content) !== CLI_ENTRYPOINT) continue;

      const project = extractQoderProject(filePath, this.projectsDir);
      const sessionId = extractSessionId(filePath);

      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line) as {
            type?: string;
            timestamp?: string | number;
            entrypoint?: string;
          };

          if (obj.entrypoint === IDE_ENTRYPOINT) continue;
          if (obj.type !== "user" && obj.type !== "assistant") continue;

          const timestamp = obj.timestamp;
          if (timestamp == null) continue;
          const ts = new Date(
            typeof timestamp === "number" && timestamp < 1e12
              ? timestamp * 1000
              : timestamp,
          );
          if (Number.isNaN(ts.getTime())) continue;

          sessionEvents.push({
            sessionId,
            source: TOOL_ID,
            project,
            timestamp: ts,
            role: obj.type === "user" ? "user" : "assistant",
          });
        } catch {
          // Ignore malformed lines
        }
      }
    }
  }

  /**
   * Parse credit consumption from run logs.
   * There is no token data here — only quota/usage credit totals.
   */
  private parseCreditDeltas(): TokenUsageEntry[] {
    if (!existsSync(this.runsDir)) return [];

    let runDirs: import("node:fs").Dirent[];
    try {
      runDirs = readdirSync(this.runsDir, { withFileTypes: true }).filter((d) =>
        d.isDirectory(),
      );
    } catch {
      return [];
    }

    const allSnapshots: CreditSnapshot[] = [];

    for (const dir of runDirs) {
      const runPath = join(this.runsDir, dir.name);
      const logPath = join(runPath, "qodercli.log");
      if (!existsSync(logPath)) continue;

      const logContent = readFileSafe(logPath);
      if (!logContent?.includes("quota/usage response:")) {
        continue;
      }

      const manifest = parseRunManifest(
        readFileSafe(join(runPath, "manifest.json")),
      );
      const project = manifest?.project_id
        ? projectFromEncodedSlug(manifest.project_id)
        : projectFromCwd(manifest?.cwd);

      const snapshots = extractCreditSnapshotsFromLog(logContent, {
        project,
        runId: manifest?.run_id || dir.name,
      });
      allSnapshots.push(...snapshots);
    }

    // Global chronological delta across all runs so we capture usage between
    // process starts (each run usually logs quota once at startup).
    return creditSnapshotsToEntries(allSnapshots);
  }

  isInstalled(): boolean {
    // Prefer CLI-specific markers; plain ~/.qoder also exists for the IDE alone.
    return (
      isQodercliBinaryPresent() ||
      existsSync(this.runsDir) ||
      existsSync(this.logsDir) ||
      existsSync(this.projectsDir)
    );
  }
}

registerParser(new QoderCliParser());
