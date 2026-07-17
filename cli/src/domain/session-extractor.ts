import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { hasInvalidTokenCounts } from "./token-usage";
import type {
  SessionEvent,
  SessionMetadata,
  SessionModelUsage,
  TokenUsageEntry,
} from "./types";

function toEntryTotalTokens(entry: TokenUsageEntry) {
  return (
    entry.inputTokens +
    entry.outputTokens +
    entry.reasoningTokens +
    entry.cachedTokens
  );
}

function buildSessionUsage(entries: TokenUsageEntry[]) {
  const usageBySession = new Map<string, Map<string, SessionModelUsage>>();

  for (const entry of entries) {
    if (!entry.sessionId) {
      continue;
    }

    if (hasInvalidTokenCounts(entry)) {
      continue;
    }

    let byModel = usageBySession.get(entry.sessionId);
    if (!byModel) {
      byModel = new Map<string, SessionModelUsage>();
      usageBySession.set(entry.sessionId, byModel);
    }

    const existing = byModel.get(entry.model);
    if (existing) {
      existing.inputTokens += entry.inputTokens;
      existing.outputTokens += entry.outputTokens;
      existing.reasoningTokens += entry.reasoningTokens;
      existing.cachedTokens += entry.cachedTokens;
      existing.totalTokens += toEntryTotalTokens(entry);
      continue;
    }

    byModel.set(entry.model, {
      model: entry.model,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      reasoningTokens: entry.reasoningTokens,
      cachedTokens: entry.cachedTokens,
      totalTokens: toEntryTotalTokens(entry),
    });
  }

  return usageBySession;
}

/**
 * Extract session metadata from timing events.
 *
 * Turn = first AI response → last AI response before next user prompt.
 * activeSeconds = sum(generation durations), excluding queue/TTFT wait.
 * durationSeconds = wall clock from first to last message.
 */
export function extractSessions(
  events: SessionEvent[],
  entries: TokenUsageEntry[] = [],
): SessionMetadata[] {
  const groups = new Map<string, SessionEvent[]>();
  for (const e of events) {
    if (!groups.has(e.sessionId)) groups.set(e.sessionId, []);
    groups.get(e.sessionId)?.push(e);
  }

  const sessions: SessionMetadata[] = [];
  const host = hostname().replace(/\.local$/, "");
  const usageBySession = buildSessionUsage(entries);

  for (const [sessionId, sessionEvents] of groups) {
    sessionEvents.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    const first = sessionEvents[0];
    const last = sessionEvents[sessionEvents.length - 1];
    const durationSeconds = Math.round(
      (last.timestamp.getTime() - first.timestamp.getTime()) / 1000,
    );

    let activeSeconds = 0;
    let turnStart: Date | null = null;
    let turnEnd: Date | null = null;
    let waitingForFirstResponse = false;

    for (const event of sessionEvents) {
      if (event.role === "user") {
        if (turnStart !== null && turnEnd !== null && turnEnd > turnStart) {
          activeSeconds += Math.round(
            (turnEnd.getTime() - turnStart.getTime()) / 1000,
          );
        }
        turnStart = null;
        turnEnd = null;
        waitingForFirstResponse = true;
      } else if (waitingForFirstResponse) {
        turnStart = event.timestamp;
        turnEnd = event.timestamp;
        waitingForFirstResponse = false;
      } else if (turnStart !== null) {
        turnEnd = event.timestamp;
      }
    }
    if (turnStart !== null && turnEnd !== null && turnEnd > turnStart) {
      activeSeconds += Math.round(
        (turnEnd.getTime() - turnStart.getTime()) / 1000,
      );
    }

    const userPromptHours = new Array(24).fill(0);
    let userMessageCount = 0;
    for (const event of sessionEvents) {
      if (event.role === "user") {
        userMessageCount++;
        userPromptHours[event.timestamp.getUTCHours()]++;
      }
    }

    const modelUsages = Array.from(
      usageBySession.get(sessionId)?.values() ?? [],
    ).sort((left, right) => {
      if (right.totalTokens !== left.totalTokens) {
        return right.totalTokens - left.totalTokens;
      }

      return left.model.localeCompare(right.model);
    });
    const inputTokens = modelUsages.reduce(
      (sum, usage) => sum + usage.inputTokens,
      0,
    );
    const outputTokens = modelUsages.reduce(
      (sum, usage) => sum + usage.outputTokens,
      0,
    );
    const reasoningTokens = modelUsages.reduce(
      (sum, usage) => sum + usage.reasoningTokens,
      0,
    );
    const cachedTokens = modelUsages.reduce(
      (sum, usage) => sum + usage.cachedTokens,
      0,
    );
    const totalTokens = modelUsages.reduce(
      (sum, usage) => sum + usage.totalTokens,
      0,
    );
    const primaryModel = modelUsages[0]?.model ?? "";

    const sessionHash = createHash("sha256")
      .update(sessionId)
      .digest("hex")
      .slice(0, 16);

    sessions.push({
      source: first.source,
      project: first.project || "unknown",
      sessionHash,
      hostname: host,
      firstMessageAt: first.timestamp.toISOString(),
      lastMessageAt: last.timestamp.toISOString(),
      durationSeconds,
      activeSeconds,
      messageCount: sessionEvents.length,
      userMessageCount,
      userPromptHours,
      inputTokens,
      outputTokens,
      reasoningTokens,
      cachedTokens,
      totalTokens,
      primaryModel,
      modelUsages,
    });
  }

  return sessions;
}

/**
 * Add hostname to sessions after privacy filtering
 */
export function addHostnameToSessions(sessions: SessionMetadata[]): void {
  const host = hostname().replace(/\.local$/, "");
  for (const s of sessions) {
    s.hostname = host;
  }
}
