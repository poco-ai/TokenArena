import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { aggregateToBuckets } from "../domain/aggregator";
import { extractSessions } from "../domain/session-extractor";
import type {
  ParseResult,
  SessionEvent,
  TokenUsageEntry,
} from "../domain/types";
import { readFileSafe } from "../infrastructure/fs/utils";
import { registerParser } from "./registry";
import type { IParser, ToolDefinition } from "./types";

const TOOL_ID = "workbuddy";
const TOOL_NAME = "WorkBuddy";
const DEFAULT_DATA_DIR = join(homedir(), ".workbuddy", "projects");

interface WorkBuddyUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  inputTokensDetails?: Array<{ cached_tokens?: number }>;
  outputTokensDetails?: Array<{ reasoning_tokens?: number }>;
}

interface WorkBuddyProviderData {
  model?: string;
  usage?: WorkBuddyUsage;
}

interface WorkBuddyEvent {
  type?: string;
  role?: string;
  timestamp?: number;
  providerData?: WorkBuddyProviderData;
  sessionId?: string;
  cwd?: string;
}

function createToolDefinition(dataDir: string): ToolDefinition {
  return {
    id: TOOL_ID,
    name: TOOL_NAME,
    dataDir,
  };
}

function toSafeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatProjectName(dirName: string): string {
  return (
    dirName.replace(/^Users-[^-]+-/, "").replace(/^\d{4}-\d{2}-\d{2}-/, "") ||
    dirName
  );
}

function findSessionFiles(
  baseDir: string,
): Array<{ filePath: string; projectDir: string }> {
  const results: Array<{ filePath: string; projectDir: string }> = [];
  if (!existsSync(baseDir)) return results;

  try {
    for (const project of readdirSync(baseDir, { withFileTypes: true })) {
      if (!project.isDirectory()) continue;

      const projectPath = join(baseDir, project.name);
      try {
        for (const entry of readdirSync(projectPath, { withFileTypes: true })) {
          if (entry.isFile() && entry.name.endsWith(".jsonl")) {
            results.push({
              filePath: join(projectPath, entry.name),
              projectDir: project.name,
            });
          } else if (entry.isDirectory() && entry.name === "subagents") {
            const subDir = join(projectPath, entry.name);
            try {
              for (const sub of readdirSync(subDir, { withFileTypes: true })) {
                if (sub.isFile() && sub.name.endsWith(".jsonl")) {
                  results.push({
                    filePath: join(subDir, sub.name),
                    projectDir: project.name,
                  });
                }
              }
            } catch {
              // Ignore unreadable subagent directories.
            }
          }
        }
      } catch {
        // Ignore unreadable project directories.
      }
    }
  } catch {
    return results;
  }

  return results;
}

export class WorkBuddyParser implements IParser {
  readonly tool: ToolDefinition;
  private readonly dataDir: string;

  constructor(dataDir?: string) {
    this.dataDir = dataDir || DEFAULT_DATA_DIR;
    this.tool = createToolDefinition(this.dataDir);
  }

  async parse(): Promise<ParseResult> {
    const sessionFiles = findSessionFiles(this.dataDir);
    if (sessionFiles.length === 0) {
      return { buckets: [], sessions: [] };
    }

    const entries: TokenUsageEntry[] = [];
    const sessionEvents: SessionEvent[] = [];
    const seenIds = new Set<string>();

    for (const { filePath, projectDir } of sessionFiles) {
      const content = readFileSafe(filePath);
      if (!content) continue;

      const sessionId = filePath;
      const project = formatProjectName(projectDir);
      let currentModel = "workbuddy";

      let fileMtime: Date | null = null;
      try {
        fileMtime = statSync(filePath).mtime;
      } catch {
        // Ignore stat errors.
      }

      for (const line of content.split("\n")) {
        if (!line.trim()) continue;

        let obj: WorkBuddyEvent;
        try {
          obj = JSON.parse(line) as WorkBuddyEvent;
        } catch {
          continue;
        }

        const timestamp = obj.timestamp ? new Date(obj.timestamp) : fileMtime;
        if (!timestamp || Number.isNaN(timestamp.getTime())) continue;

        const role =
          obj.role === "user"
            ? "user"
            : obj.type === "message" && obj.role === "assistant"
              ? "assistant"
              : null;
        if (role) {
          sessionEvents.push({
            sessionId,
            source: TOOL_ID,
            project,
            timestamp,
            role,
          });
        }

        const providerData = obj.providerData;
        if (!providerData) continue;

        if (providerData.model) {
          currentModel = providerData.model;
        }

        const usage = providerData.usage;
        if (!usage) continue;

        const inputTokens = toSafeNumber(usage.inputTokens);
        const outputTokens = toSafeNumber(usage.outputTokens);
        const cachedTokens = toSafeNumber(
          usage.inputTokensDetails?.[0]?.cached_tokens,
        );
        const reasoningTokens = toSafeNumber(
          usage.outputTokensDetails?.[0]?.reasoning_tokens,
        );

        if (inputTokens === 0 && outputTokens === 0) continue;

        const entryId =
          obj.timestamp?.toString() ?? `${inputTokens}-${outputTokens}`;
        if (seenIds.has(entryId)) continue;
        seenIds.add(entryId);

        entries.push({
          sessionId,
          source: TOOL_ID,
          model: currentModel,
          project,
          timestamp,
          inputTokens,
          outputTokens,
          reasoningTokens,
          cachedTokens,
        });
      }
    }

    return {
      buckets: aggregateToBuckets(entries),
      sessions: extractSessions(sessionEvents, entries),
    };
  }

  isInstalled(): boolean {
    return existsSync(this.dataDir);
  }
}

registerParser(new WorkBuddyParser());
