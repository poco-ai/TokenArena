import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GrokBuildParser, projectFromEncodedCwd } from "./grok-build";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("projectFromEncodedCwd", () => {
  it("decodes URL-encoded cwd and uses the leaf name", () => {
    expect(projectFromEncodedCwd("%2FUsers%2Fphilfan%2Fi%2FTokenArena")).toBe(
      "TokenArena",
    );
  });
});

describe("GrokBuildParser", () => {
  it("parses turn_completed usage with modelUsage breakdown", async () => {
    const dataDir = makeTempDir("tokenarena-grok-");
    const sessionDir = join(
      dataDir,
      "%2FUsers%2Fphilfan%2Fi%2FTokenArena",
      "019f92e1-9bce-7f10-9080-effadf368d1c",
    );
    mkdirSync(sessionDir, { recursive: true });

    writeFileSync(
      join(sessionDir, "summary.json"),
      JSON.stringify({
        info: { id: "019f92e1-9bce-7f10-9080-effadf368d1c" },
        current_model_id: "grok-4.5",
      }),
      "utf-8",
    );

    writeFileSync(
      join(sessionDir, "updates.jsonl"),
      [
        JSON.stringify({
          timestamp: 1_784_875_698,
          method: "session/update",
          params: {
            sessionId: "019f92e1-9bce-7f10-9080-effadf368d1c",
            update: {
              sessionUpdate: "user_message_chunk",
              content: { type: "text", text: "hello" },
              _meta: { promptId: "prompt-1" },
            },
          },
        }),
        // streaming duplicate of the same user prompt — should count once
        JSON.stringify({
          timestamp: 1_784_875_699,
          method: "session/update",
          params: {
            sessionId: "019f92e1-9bce-7f10-9080-effadf368d1c",
            update: {
              sessionUpdate: "user_message_chunk",
              content: { type: "text", text: " hello" },
              _meta: { promptId: "prompt-1" },
            },
          },
        }),
        JSON.stringify({
          timestamp: 1_784_875_720,
          method: "_x.ai/session/update",
          params: {
            sessionId: "019f92e1-9bce-7f10-9080-effadf368d1c",
            update: {
              sessionUpdate: "turn_completed",
              prompt_id: "prompt-1",
              stop_reason: "end_turn",
              usage: {
                inputTokens: 1000,
                outputTokens: 200,
                totalTokens: 1200,
                cachedReadTokens: 400,
                reasoningTokens: 50,
                modelCalls: 2,
                modelUsage: {
                  "grok-4.5-build-free": {
                    inputTokens: 1000,
                    outputTokens: 200,
                    totalTokens: 1200,
                    cachedReadTokens: 400,
                    reasoningTokens: 50,
                    modelCalls: 2,
                  },
                },
                numTurns: 2,
              },
            },
          },
          _meta: { agentTimestampMs: 1_784_875_720_000 },
        }),
      ].join("\n"),
      "utf-8",
    );

    const parser = new GrokBuildParser(dataDir);
    const result = await parser.parse();

    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0]).toMatchObject({
      source: "grok-build",
      model: "grok-4.5-build-free",
      project: "TokenArena",
      // input excludes cache, output excludes reasoning
      inputTokens: 600,
      outputTokens: 150,
      reasoningTokens: 50,
      cachedTokens: 400,
      totalTokens: 1200,
    });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({
      source: "grok-build",
      project: "TokenArena",
      userMessageCount: 1,
      messageCount: 2,
      primaryModel: "grok-4.5-build-free",
      totalTokens: 1200,
    });
  });

  it("returns empty when no sessions", async () => {
    const dataDir = makeTempDir("tokenarena-grok-empty-");
    const parser = new GrokBuildParser(dataDir);
    const result = await parser.parse();
    expect(result.buckets).toEqual([]);
    expect(result.sessions).toEqual([]);
  });
});
