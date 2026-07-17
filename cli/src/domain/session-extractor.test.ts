import { describe, expect, it } from "vitest";

import { extractSessions } from "./session-extractor";

describe("extractSessions", () => {
  it("counts messages and aggregates exact session token usage", () => {
    const [session] = extractSessions(
      [
        {
          sessionId: "s1",
          source: "claude-code",
          project: "tokenarena",
          timestamp: new Date("2026-03-26T10:00:00.000Z"),
          role: "user",
        },
        {
          sessionId: "s1",
          source: "claude-code",
          project: "tokenarena",
          timestamp: new Date("2026-03-26T10:00:05.000Z"),
          role: "assistant",
        },
      ],
      [
        {
          sessionId: "s1",
          source: "claude-code",
          model: "claude-sonnet-4-20250514",
          project: "tokenarena",
          timestamp: new Date("2026-03-26T10:00:05.000Z"),
          inputTokens: 100,
          outputTokens: 60,
          cachedTokens: 25,
          reasoningTokens: 10,
        },
        {
          sessionId: "s1",
          source: "claude-code",
          model: "claude-opus-4-20250514",
          project: "tokenarena",
          timestamp: new Date("2026-03-26T10:00:06.000Z"),
          inputTokens: 40,
          outputTokens: 20,
          cachedTokens: 0,
          reasoningTokens: 5,
        },
      ],
    );

    expect(session.messageCount).toBe(2);
    expect(session.userMessageCount).toBe(1);
    expect(session.inputTokens).toBe(140);
    expect(session.outputTokens).toBe(80);
    expect(session.reasoningTokens).toBe(15);
    expect(session.cachedTokens).toBe(25);
    expect(session.totalTokens).toBe(260);
    expect(session.primaryModel).toBe("claude-sonnet-4-20250514");
    expect(session.modelUsages).toEqual([
      {
        model: "claude-sonnet-4-20250514",
        inputTokens: 100,
        outputTokens: 60,
        reasoningTokens: 10,
        cachedTokens: 25,
        totalTokens: 195,
      },
      {
        model: "claude-opus-4-20250514",
        inputTokens: 40,
        outputTokens: 20,
        reasoningTokens: 5,
        cachedTokens: 0,
        totalTokens: 65,
      },
    ]);
  });

  it("ignores malformed token usage entries with negative counts", () => {
    const [session] = extractSessions(
      [
        {
          sessionId: "s1",
          source: "claude-code",
          project: "tokenarena",
          timestamp: new Date("2026-03-26T10:00:00.000Z"),
          role: "user",
        },
        {
          sessionId: "s1",
          source: "claude-code",
          project: "tokenarena",
          timestamp: new Date("2026-03-26T10:00:05.000Z"),
          role: "assistant",
        },
      ],
      [
        {
          sessionId: "s1",
          source: "claude-code",
          model: "claude-sonnet-4-20250514",
          project: "tokenarena",
          timestamp: new Date("2026-03-26T10:00:05.000Z"),
          inputTokens: 100,
          outputTokens: 60,
          cachedTokens: 25,
          reasoningTokens: 10,
        },
        {
          sessionId: "s1",
          source: "claude-code",
          model: "claude-opus-4-20250514",
          project: "tokenarena",
          timestamp: new Date("2026-03-26T10:00:06.000Z"),
          inputTokens: -40,
          outputTokens: 20,
          cachedTokens: 120,
          reasoningTokens: 0,
        },
      ],
    );

    expect(session.inputTokens).toBe(100);
    expect(session.outputTokens).toBe(60);
    expect(session.reasoningTokens).toBe(10);
    expect(session.cachedTokens).toBe(25);
    expect(session.totalTokens).toBe(195);
    expect(session.primaryModel).toBe("claude-sonnet-4-20250514");
    expect(session.modelUsages).toEqual([
      {
        model: "claude-sonnet-4-20250514",
        inputTokens: 100,
        outputTokens: 60,
        reasoningTokens: 10,
        cachedTokens: 25,
        totalTokens: 195,
      },
    ]);
  });
});
