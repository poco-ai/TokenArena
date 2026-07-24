import { homedir } from "node:os";
import { join } from "node:path";
import { aggregateToBuckets } from "../domain/aggregator";
import { extractSessions } from "../domain/session-extractor";
import type {
  ParseResult,
  SessionEvent,
  TokenUsageEntry,
} from "../domain/types";
import { findJsonlFiles, readFileSafe } from "../infrastructure/fs/utils";
import { registerParser } from "./registry";
import type { IParser, ToolDefinition } from "./types";

const TOOL_ID = "codex";
const TOOL_NAME = "Codex CLI";
const DEFAULT_DATA_DIR = join(homedir(), ".codex", "sessions");

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

function toNonNegativeDelta(current: unknown, previous: unknown): number {
  return Math.max(0, toSafeNumber(current) - toSafeNumber(previous));
}

interface CodexEvent {
  type: string;
  timestamp?: string;
  payload?: {
    type?: string;
    model?: string;
    cwd?: string;
    git?: {
      repository_url?: string;
    };
    info?: {
      model?: string;
      last_token_usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cached_input_tokens?: number;
        reasoning_output_tokens?: number;
      };
      total_token_usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cached_input_tokens?: number;
        reasoning_output_tokens?: number;
      };
    };
  };
}

function getPathLeaf(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  const leaf = normalized.split("/").filter(Boolean).pop();
  return leaf || "unknown";
}

export function resolveCodexProject(payload?: CodexEvent["payload"]): string {
  if (!payload) {
    return "unknown";
  }

  const repositoryUrl = payload.git?.repository_url;
  if (repositoryUrl) {
    const match = repositoryUrl.match(/([^/]+\/[^/]+?)(?:\.git)?$/);
    if (match) {
      return match[1];
    }
  }

  if (payload.cwd) {
    return getPathLeaf(payload.cwd);
  }

  return "unknown";
}

export class CodexParser implements IParser {
  readonly tool: ToolDefinition;

  constructor(private readonly dataDir = DEFAULT_DATA_DIR) {
    this.tool = createToolDefinition(dataDir);
  }

  async parse(): Promise<ParseResult> {
    const entries: TokenUsageEntry[] = [];
    const sessionEvents: SessionEvent[] = [];
    const files = findJsonlFiles(this.dataDir);

    if (files.length === 0) {
      return { buckets: [], sessions: [] };
    }

    for (const filePath of files) {
      const content = readFileSafe(filePath);
      if (!content) continue;

      let sessionProject = "unknown";
      const sessionModel = "unknown";
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line) as CodexEvent;
          if (obj.type === "session_meta") {
            sessionProject = resolveCodexProject(obj.payload);
            break;
          }
        } catch {
          break;
        }
      }

      let turnContextModel = "unknown";
      type TokenUsage = {
        input_tokens?: number;
        output_tokens?: number;
        cached_input_tokens?: number;
        reasoning_output_tokens?: number;
      };
      const prevTotal = new Map<string, TokenUsage>();

      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line) as CodexEvent;

          if (obj.type === "turn_context" && obj.timestamp) {
            const eventTimestamp = new Date(obj.timestamp);
            if (!Number.isNaN(eventTimestamp.getTime())) {
              sessionEvents.push({
                sessionId: filePath,
                source: TOOL_ID,
                project: sessionProject,
                timestamp: eventTimestamp,
                role: "user",
              });
            }
          }

          if (obj.type === "turn_context" && obj.payload?.model) {
            turnContextModel = obj.payload.model;
            continue;
          }

          if (obj.type !== "event_msg") continue;

          const payload = obj.payload;
          if (payload?.type !== "token_count") continue;

          const info = payload.info;
          if (!info) continue;

          const timestamp = obj.timestamp ? new Date(obj.timestamp) : null;
          if (!timestamp || Number.isNaN(timestamp.getTime())) continue;

          sessionEvents.push({
            sessionId: filePath,
            source: TOOL_ID,
            project: sessionProject,
            timestamp,
            role: "assistant",
          });

          let usage = info.last_token_usage;
          if (!usage && info.total_token_usage) {
            const totalKey = `${info.model || payload.model || turnContextModel || ""}`;
            const prev = prevTotal.get(totalKey);
            const curr = info.total_token_usage;
            if (prev) {
              usage = {
                input_tokens: toNonNegativeDelta(
                  curr.input_tokens,
                  prev.input_tokens,
                ),
                output_tokens: toNonNegativeDelta(
                  curr.output_tokens,
                  prev.output_tokens,
                ),
                cached_input_tokens: toNonNegativeDelta(
                  curr.cached_input_tokens,
                  prev.cached_input_tokens,
                ),
                reasoning_output_tokens: toNonNegativeDelta(
                  curr.reasoning_output_tokens,
                  prev.reasoning_output_tokens,
                ),
              };
            } else {
              usage = curr;
            }
            prevTotal.set(totalKey, { ...curr });
          }
          if (!usage) continue;

          const model =
            info.model || payload.model || turnContextModel || sessionModel;
          const cachedInput = toSafeNumber(usage.cached_input_tokens);
          const reasoningTokens = toSafeNumber(usage.reasoning_output_tokens);
          const inputTokens = Math.max(
            0,
            toSafeNumber(usage.input_tokens) - cachedInput,
          );
          const outputTokens = Math.max(
            0,
            toSafeNumber(usage.output_tokens) - reasoningTokens,
          );

          if (
            inputTokens === 0 &&
            outputTokens === 0 &&
            reasoningTokens === 0 &&
            cachedInput === 0
          ) {
            continue;
          }

          entries.push({
            sessionId: filePath,
            source: TOOL_ID,
            model,
            project: sessionProject,
            timestamp,
            inputTokens,
            outputTokens,
            reasoningTokens,
            cachedTokens: cachedInput,
          });
        } catch {
          // Ignore malformed lines and continue scanning the session log.
        }
      }
    }

    return {
      buckets: aggregateToBuckets(entries),
      sessions: extractSessions(sessionEvents, entries),
    };
  }
}

registerParser(new CodexParser());
