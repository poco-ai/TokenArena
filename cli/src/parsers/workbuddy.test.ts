import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkBuddyParser } from "./workbuddy";

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

describe("WorkBuddyParser", () => {
  it("parses session JSONL with providerData usage", async () => {
    const dataDir = makeTempDir("tokenarena-wb-");
    const projectDir = join(dataDir, "Users-mac-MyProject");
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(
      join(projectDir, "session-1.jsonl"),
      [
        JSON.stringify({
          type: "message",
          role: "user",
          timestamp: 1700000000000,
          content: "hello",
        }),
        JSON.stringify({
          type: "function_call",
          timestamp: 1700000060000,
          providerData: {
            model: "gpt-4o",
            usage: {
              requests: 1,
              inputTokens: 1000,
              outputTokens: 200,
              totalTokens: 1200,
              inputTokensDetails: [{ cached_tokens: 300 }],
              outputTokensDetails: [{ reasoning_tokens: 50 }],
            },
          },
        }),
        JSON.stringify({
          type: "message",
          role: "assistant",
          timestamp: 1700000120000,
          providerData: {
            model: "gpt-4o",
            usage: {
              requests: 1,
              inputTokens: 500,
              outputTokens: 100,
              totalTokens: 600,
              inputTokensDetails: [{ cached_tokens: 0 }],
              outputTokensDetails: [{ reasoning_tokens: 0 }],
            },
          },
        }),
      ].join("\n"),
      "utf-8",
    );

    const parser = new WorkBuddyParser(dataDir);
    const result = await parser.parse();

    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0]).toMatchObject({
      source: "workbuddy",
      model: "gpt-4o",
      project: "MyProject",
      inputTokens: 1500,
      outputTokens: 300,
      cachedTokens: 300,
      reasoningTokens: 50,
    });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({
      source: "workbuddy",
      project: "MyProject",
      primaryModel: "gpt-4o",
      messageCount: 2,
      inputTokens: 1500,
      outputTokens: 300,
    });
  });

  it("handles missing providerData gracefully", async () => {
    const dataDir = makeTempDir("tokenarena-wb-nopd-");
    const projectDir = join(dataDir, "Users-mac-test");
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(
      join(projectDir, "session-1.jsonl"),
      [
        JSON.stringify({
          type: "message",
          role: "user",
          timestamp: 1700000000000,
        }),
        JSON.stringify({
          type: "message",
          role: "assistant",
          timestamp: 1700000060000,
        }),
      ].join("\n"),
      "utf-8",
    );

    const parser = new WorkBuddyParser(dataDir);
    const result = await parser.parse();

    expect(result.buckets).toHaveLength(0);
  });

  it("scans subagent JSONL files", async () => {
    const dataDir = makeTempDir("tokenarena-wb-sub-");
    const projectDir = join(dataDir, "Users-mac-test");
    const subDir = join(projectDir, "subagents");
    mkdirSync(subDir, { recursive: true });

    writeFileSync(
      join(subDir, "agent-abc.jsonl"),
      JSON.stringify({
        type: "function_call",
        timestamp: 1700000000000,
        providerData: {
          model: "sonnet",
          usage: {
            inputTokens: 2000,
            outputTokens: 500,
            totalTokens: 2500,
            inputTokensDetails: [{ cached_tokens: 100 }],
            outputTokensDetails: [{ reasoning_tokens: 0 }],
          },
        },
      }),
      "utf-8",
    );

    const parser = new WorkBuddyParser(dataDir);
    const result = await parser.parse();

    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0]).toMatchObject({
      source: "workbuddy",
      model: "sonnet",
      inputTokens: 2000,
      outputTokens: 500,
    });
  });
});
