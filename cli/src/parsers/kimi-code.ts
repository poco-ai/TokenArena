import { createHash } from "node:crypto";
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

const TOOL_ID = "kimi-code";
const TOOL_NAME = "Kimi Code";
const OLD_SESSIONS_DIR = join(homedir(), ".kimi", "sessions");
const NEW_SESSIONS_DIR = join(homedir(), ".kimi-code", "sessions");
const OLD_CONFIG_PATH = join(homedir(), ".kimi", "kimi.json");

const USER_EVENT_TYPES = new Set(["UserMessage", "user_message", "Input"]);
const ASSISTANT_EVENT_TYPES = new Set([
  "AssistantMessage",
  "assistant_message",
  "Output",
  "ModelOutput",
  "AssistantOutput",
]);

interface KimiTokenUsage {
  input_other?: unknown;
  output?: unknown;
  input_cache_read?: unknown;
  input_cache_creation?: unknown;
}

interface KimiPayload {
  timestamp?: string | number;
  model?: string;
  role?: string;
  token_usage?: KimiTokenUsage;
  message_id?: string;
}

interface KimiEvent {
  type?: string;
  timestamp?: string | number;
  payload?: KimiPayload;
  message?: KimiEvent;
}

interface NewKimiUsageRecord {
  type: "usage.record";
  model?: string;
  usage?: {
    inputOther?: unknown;
    output?: unknown;
    inputCacheRead?: unknown;
    inputCacheCreation?: unknown;
  };
  usageScope?: string;
  time?: number;
}

export interface KimiCodeParserOptions {
  sessionsDir?: string;
  newSessionsDir?: string;
  configPath?: string;
}

function createToolDefinition(dataDir: string): ToolDefinition {
  return {
    id: TOOL_ID,
    name: TOOL_NAME,
    dataDir,
  };
}

function toSafeNumber(value: unknown): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function getPathLeaf(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  const leaf = normalized.split("/").filter(Boolean).pop();
  return leaf || "unknown";
}

function findWireFiles(
  baseDir: string,
): Array<{ filePath: string; workDirHash: string }> {
  const results: Array<{ filePath: string; workDirHash: string }> = [];
  if (!existsSync(baseDir)) return results;

  try {
    for (const workDir of readdirSync(baseDir, { withFileTypes: true })) {
      if (!workDir.isDirectory()) continue;

      const workDirPath = join(baseDir, workDir.name);
      try {
        for (const session of readdirSync(workDirPath, {
          withFileTypes: true,
        })) {
          if (!session.isDirectory()) continue;

          const wireFile = join(workDirPath, session.name, "wire.jsonl");
          if (existsSync(wireFile)) {
            results.push({ filePath: wireFile, workDirHash: workDir.name });
          }
        }
      } catch {
        // Ignore unreadable session directories and keep scanning.
      }
    }
  } catch {
    return results;
  }

  return results;
}

function extractProjectFromDirName(dirName: string): string {
  // wd_<projectName>_<hash> -> projectName
  const match = dirName.match(/^wd_(.+)_[a-f0-9]+$/);
  return match ? match[1] : dirName;
}

function findNewWireFiles(
  baseDir: string,
): Array<{ filePath: string; projectName: string }> {
  const results: Array<{ filePath: string; projectName: string }> = [];
  if (!existsSync(baseDir)) return results;

  try {
    for (const workDir of readdirSync(baseDir, { withFileTypes: true })) {
      if (!workDir.isDirectory()) continue;

      const projectName = extractProjectFromDirName(workDir.name);
      const workDirPath = join(baseDir, workDir.name);
      try {
        for (const session of readdirSync(workDirPath, {
          withFileTypes: true,
        })) {
          if (!session.isDirectory()) continue;

          const wireFile = join(
            workDirPath,
            session.name,
            "agents",
            "main",
            "wire.jsonl",
          );
          if (existsSync(wireFile)) {
            results.push({ filePath: wireFile, projectName });
          }
        }
      } catch {
        // Ignore unreadable session directories.
      }
    }
  } catch {
    return results;
  }

  return results;
}

function parseTimestamp(value: string | number | undefined): Date | null {
  if (value == null) return null;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp;
}

function classifyKimiRole(
  type: string | undefined,
  payload: KimiPayload | undefined,
): SessionEvent["role"] | null {
  if (payload?.role === "user" || payload?.role === "assistant") {
    return payload.role;
  }

  if (type && USER_EVENT_TYPES.has(type)) {
    return "user";
  }

  if (type && ASSISTANT_EVENT_TYPES.has(type)) {
    return "assistant";
  }

  if (type?.toLowerCase().includes("assistant")) {
    return "assistant";
  }

  return null;
}

function loadProjectMap(configPath: string): Map<string, string> {
  const projectMap = new Map<string, string>();
  const content = readFileSafe(configPath);
  if (!content) return projectMap;

  try {
    const config = JSON.parse(content) as {
      workspaces?: Record<string, string | { path?: string; dir?: string }>;
      projects?: Record<string, string | { path?: string; dir?: string }>;
      work_dirs?: Array<{ path?: string }>;
    };

    const workspaces = config.workspaces || config.projects || {};
    for (const [hash, info] of Object.entries(workspaces)) {
      const pathValue =
        typeof info === "string" ? info : info.path || info.dir || undefined;
      if (!pathValue) continue;

      projectMap.set(hash, getPathLeaf(pathValue));
    }

    if (config.work_dirs) {
      for (const entry of config.work_dirs) {
        if (!entry.path) continue;
        const leaf = getPathLeaf(entry.path);
        if (leaf === "unknown") continue;

        const hash = createHash("md5").update(entry.path).digest("hex");
        if (!projectMap.has(hash)) {
          projectMap.set(hash, leaf);
        }
      }
    }
  } catch {
    // Ignore unreadable config and fall back to work-dir hashes.
  }

  return projectMap;
}

export class KimiCodeParser implements IParser {
  readonly tool: ToolDefinition;
  private readonly oldSessionsDir: string;
  private readonly newSessionsDir: string;
  private readonly configPath: string;

  constructor(options: KimiCodeParserOptions = {}) {
    this.oldSessionsDir = options.sessionsDir || OLD_SESSIONS_DIR;
    this.newSessionsDir = options.newSessionsDir || NEW_SESSIONS_DIR;
    this.configPath = options.configPath || OLD_CONFIG_PATH;
    this.tool = createToolDefinition(this.oldSessionsDir);
  }

  async parse(): Promise<ParseResult> {
    const oldWireFiles = findWireFiles(this.oldSessionsDir);
    const newWireFiles = findNewWireFiles(this.newSessionsDir);

    if (oldWireFiles.length === 0 && newWireFiles.length === 0) {
      return { buckets: [], sessions: [] };
    }

    const projectMap = loadProjectMap(this.configPath);
    const entries: TokenUsageEntry[] = [];
    const sessionEvents: SessionEvent[] = [];
    const seenMessageIds = new Set<string>();

    // Parse old format: ~/.kimi/sessions/<hash>/<sessionId>/wire.jsonl
    for (const { filePath, workDirHash } of oldWireFiles) {
      const content = readFileSafe(filePath);
      if (!content) continue;

      const sessionId = filePath;
      const project = projectMap.get(workDirHash) || workDirHash;
      let currentModel = "kimi-for-coding";
      let lastTimestampRaw: string | number | undefined;

      let fileMtime: Date | null = null;
      try {
        fileMtime = statSync(filePath).mtime;
      } catch {
        // Ignore stat errors.
      }

      for (const line of content.split("\n")) {
        if (!line.trim()) continue;

        let obj: KimiEvent;
        try {
          obj = JSON.parse(line) as KimiEvent;
        } catch {
          continue;
        }

        if (obj.message) {
          obj = obj.message;
        }

        const payload = obj.payload;
        if (!payload) continue;

        if (payload.model) {
          currentModel = payload.model;
        }

        const timestampValue =
          payload.timestamp ?? obj.timestamp ?? lastTimestampRaw;
        const timestamp = parseTimestamp(timestampValue) ?? fileMtime;
        if (payload.timestamp != null) {
          lastTimestampRaw = payload.timestamp;
        } else if (obj.timestamp != null) {
          lastTimestampRaw = obj.timestamp;
        }

        const role = classifyKimiRole(obj.type, payload);
        if (role && timestamp) {
          sessionEvents.push({
            sessionId,
            source: TOOL_ID,
            project,
            timestamp,
            role,
          });
        }

        if (obj.type !== "StatusUpdate") continue;

        const tokenUsage = payload.token_usage;
        if (!tokenUsage || !timestamp) continue;

        const inputTokens = toSafeNumber(tokenUsage.input_other);
        const outputTokens = toSafeNumber(tokenUsage.output);
        const cachedTokens = toSafeNumber(tokenUsage.input_cache_read);
        const cacheCreateTokens = toSafeNumber(tokenUsage.input_cache_creation);

        if (
          inputTokens === 0 &&
          outputTokens === 0 &&
          cachedTokens === 0 &&
          cacheCreateTokens === 0
        ) {
          continue;
        }

        if (payload.message_id) {
          if (seenMessageIds.has(payload.message_id)) continue;
          seenMessageIds.add(payload.message_id);
        }

        if (!role) {
          sessionEvents.push({
            sessionId,
            source: TOOL_ID,
            project,
            timestamp,
            role: "assistant",
          });
        }

        entries.push({
          sessionId,
          source: TOOL_ID,
          model: currentModel,
          project,
          timestamp,
          inputTokens,
          outputTokens,
          reasoningTokens: 0,
          cachedTokens,
        });
      }
    }

    // Parse new format: ~/.kimi-code/sessions/wd_<name>_<hash>/<sessionId>/agents/main/wire.jsonl
    for (const { filePath, projectName } of newWireFiles) {
      const content = readFileSafe(filePath);
      if (!content) continue;

      const sessionId = filePath;

      for (const line of content.split("\n")) {
        if (!line.trim()) continue;

        let obj: NewKimiUsageRecord;
        try {
          obj = JSON.parse(line) as NewKimiUsageRecord;
        } catch {
          continue;
        }

        if (obj.type !== "usage.record") continue;
        if (obj.usageScope === "session") continue;

        const usage = obj.usage;
        if (!usage) continue;

        const timestamp = obj.time ? new Date(obj.time) : null;
        if (!timestamp || Number.isNaN(timestamp.getTime())) continue;

        const inputTokens = toSafeNumber(usage.inputOther);
        const outputTokens = toSafeNumber(usage.output);
        const cachedTokens = toSafeNumber(usage.inputCacheRead);

        if (inputTokens === 0 && outputTokens === 0 && cachedTokens === 0) {
          continue;
        }

        // Extract model name, strip "kimi-code/" prefix if present
        const rawModel = obj.model || "kimi-for-coding";
        const model = rawModel.replace(/^kimi-code\//, "");

        sessionEvents.push({
          sessionId,
          source: TOOL_ID,
          project: projectName,
          timestamp,
          role: "assistant",
        });

        entries.push({
          sessionId,
          source: TOOL_ID,
          model,
          project: projectName,
          timestamp,
          inputTokens,
          outputTokens,
          reasoningTokens: 0,
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
    return existsSync(this.oldSessionsDir) || existsSync(this.newSessionsDir);
  }
}

registerParser(new KimiCodeParser());
