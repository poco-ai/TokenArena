import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { KimiCodeParser } from "./kimi-code";

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

describe("KimiCodeParser", () => {
  it("parses kimi wire logs and resolves the project name from kimi.json", async () => {
    const rootDir = makeTempDir("tokenarena-kimi-");
    const sessionsDir = join(rootDir, "sessions");
    const wireDir = join(sessionsDir, "workspace-hash", "session-1");
    mkdirSync(wireDir, { recursive: true });

    writeFileSync(
      join(rootDir, "kimi.json"),
      JSON.stringify({
        workspaces: {
          "workspace-hash": "/Users/dev/tokenarena",
        },
      }),
      "utf-8",
    );

    writeFileSync(
      join(wireDir, "wire.jsonl"),
      [
        JSON.stringify({
          type: "UserMessage",
          payload: {
            timestamp: "2026-03-26T10:00:00.000Z",
          },
        }),
        JSON.stringify({
          type: "StatusUpdate",
          payload: {
            timestamp: "2026-03-26T10:00:03.000Z",
            model: "kimi-k2.5",
            message_id: "msg-1",
            token_usage: {
              input_other: 90,
              output: 40,
              input_cache_read: 10,
            },
          },
        }),
      ].join("\n"),
      "utf-8",
    );

    const parser = new KimiCodeParser({
      sessionsDir,
      newSessionsDir: join(rootDir, "nonexistent"),
      configPath: join(rootDir, "kimi.json"),
    });
    const result = await parser.parse();

    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0]).toMatchObject({
      source: "kimi-code",
      model: "kimi-k2.5",
      project: "tokenarena",
      inputTokens: 90,
      outputTokens: 40,
      reasoningTokens: 0,
      cachedTokens: 10,
      totalTokens: 140,
    });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({
      source: "kimi-code",
      project: "tokenarena",
      durationSeconds: 3,
      messageCount: 2,
      userMessageCount: 1,
      inputTokens: 90,
      outputTokens: 40,
      reasoningTokens: 0,
      cachedTokens: 10,
      totalTokens: 140,
      primaryModel: "kimi-k2.5",
    });
  });

  it("parses wire logs with message wrapper (old Kimi format)", async () => {
    const rootDir = makeTempDir("tokenarena-kimi-wrap-");
    const sessionsDir = join(rootDir, "sessions");
    const wireDir = join(sessionsDir, "workspace-hash", "session-1");
    mkdirSync(wireDir, { recursive: true });

    writeFileSync(
      join(wireDir, "wire.jsonl"),
      [
        JSON.stringify({
          message: {
            type: "UserMessage",
            payload: {
              timestamp: "2026-03-26T10:00:00.000Z",
            },
          },
        }),
        JSON.stringify({
          message: {
            type: "StatusUpdate",
            payload: {
              timestamp: "2026-03-26T10:00:03.000Z",
              model: "kimi-k2.5",
              message_id: "msg-1",
              token_usage: {
                input_other: 200,
                output: 80,
                input_cache_read: 50,
                input_cache_creation: 10,
              },
            },
          },
        }),
      ].join("\n"),
      "utf-8",
    );

    const parser = new KimiCodeParser({
      sessionsDir,
      newSessionsDir: join(rootDir, "nonexistent"),
    });
    const result = await parser.parse();

    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0]).toMatchObject({
      source: "kimi-code",
      model: "kimi-k2.5",
      inputTokens: 200,
      outputTokens: 80,
      cachedTokens: 50,
      totalTokens: 330,
    });
  });

  it("parses new format usage.record events from ~/.kimi-code", async () => {
    const rootDir = makeTempDir("tokenarena-kimi-new-");
    const sessionsDir = join(rootDir, "sessions");
    const wireDir = join(
      sessionsDir,
      "wd_my-project_abc123",
      "session-test1",
      "agents",
      "main",
    );
    mkdirSync(wireDir, { recursive: true });

    writeFileSync(
      join(wireDir, "wire.jsonl"),
      [
        JSON.stringify({
          type: "metadata",
          protocol_version: "1.3",
          created_at: 1780306181936,
        }),
        JSON.stringify({
          type: "usage.record",
          model: "kimi-code/kimi-for-coding",
          usage: {
            inputOther: 5000,
            output: 200,
            inputCacheRead: 10000,
            inputCacheCreation: 0,
          },
          usageScope: "turn",
          time: 1780306248482,
        }),
        JSON.stringify({
          type: "usage.record",
          model: "kimi-code/kimi-for-coding",
          usage: {
            inputOther: 8000,
            output: 300,
            inputCacheRead: 15000,
            inputCacheCreation: 0,
          },
          usageScope: "turn",
          time: 1780306300000,
        }),
        // Session-level summary should be skipped
        JSON.stringify({
          type: "usage.record",
          model: "kimi-code/kimi-for-coding",
          usage: {
            inputOther: 13000,
            output: 500,
            inputCacheRead: 25000,
            inputCacheCreation: 0,
          },
          usageScope: "session",
          time: 1780306350000,
        }),
      ].join("\n"),
      "utf-8",
    );

    const parser = new KimiCodeParser({
      sessionsDir: join(rootDir, "nonexistent"),
      newSessionsDir: sessionsDir,
    });
    const result = await parser.parse();

    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0]).toMatchObject({
      source: "kimi-code",
      model: "kimi-for-coding",
      project: "my-project",
      inputTokens: 13000,
      outputTokens: 500,
      cachedTokens: 25000,
      totalTokens: 38500,
    });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({
      source: "kimi-code",
      project: "my-project",
      messageCount: 2,
      userMessageCount: 0,
      primaryModel: "kimi-for-coding",
    });
  });

  it("scans both old and new directories", async () => {
    const rootDir = makeTempDir("tokenarena-kimi-both-");

    // Old format
    const oldSessionsDir = join(rootDir, "old-sessions");
    const oldWireDir = join(oldSessionsDir, "hash1", "session-1");
    mkdirSync(oldWireDir, { recursive: true });
    writeFileSync(
      join(oldWireDir, "wire.jsonl"),
      JSON.stringify({
        type: "StatusUpdate",
        payload: {
          timestamp: "2026-03-26T10:00:00.000Z",
          model: "kimi-k2.5",
          message_id: "msg-1",
          token_usage: {
            input_other: 100,
            output: 50,
            input_cache_read: 20,
          },
        },
      }),
      "utf-8",
    );

    // New format
    const newSessionsDir = join(rootDir, "new-sessions");
    const newWireDir = join(
      newSessionsDir,
      "wd_project-x_def456",
      "session-2",
      "agents",
      "main",
    );
    mkdirSync(newWireDir, { recursive: true });
    writeFileSync(
      join(newWireDir, "wire.jsonl"),
      JSON.stringify({
        type: "usage.record",
        model: "kimi-for-coding",
        usage: {
          inputOther: 200,
          output: 100,
          inputCacheRead: 40,
        },
        usageScope: "turn",
        time: 1780306248482,
      }),
      "utf-8",
    );

    const parser = new KimiCodeParser({
      sessionsDir: oldSessionsDir,
      newSessionsDir: newSessionsDir,
      configPath: join(rootDir, "nonexistent.json"),
    });
    const result = await parser.parse();

    expect(result.buckets).toHaveLength(2);
    const projects = result.buckets.map((b) => b.project).sort();
    expect(projects).toEqual(["hash1", "project-x"]);
  });
});
