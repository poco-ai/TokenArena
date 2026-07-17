import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AstrBotParser, readSqliteRowsWithLockRetry } from "./astrbot";

const tempDirs: string[] = [];
const originalAstrBotRoot = process.env.ASTRBOT_ROOT;

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeDbPath(): string {
  const dataDir = makeTempDir("tokenarena-astrbot-test-");
  const dbPath = join(dataDir, "data_v4.db");
  writeFileSync(dbPath, "", "utf-8");
  return dbPath;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }

  if (originalAstrBotRoot === undefined) {
    delete process.env.ASTRBOT_ROOT;
  } else {
    process.env.ASTRBOT_ROOT = originalAstrBotRoot;
  }
});

describe("AstrBotParser", () => {
  it("maps provider stats and preserves request duration", async () => {
    const dbPath = makeDbPath();
    const parser = new AstrBotParser({
      dbPath,
      queryRows: async <TRow>(targetDbPath: string, query: string) => {
        expect(targetDbPath).toBe(dbPath);
        expect(query).toContain("FROM provider_stats");

        return [
          {
            id: 1,
            conversation_id: "conversation-1",
            provider_model: "gpt-5.4",
            token_input_other: "100",
            token_input_cached: 20,
            token_output: 30,
            start_time: 1713002400,
            end_time: 1713002405,
          },
        ] as TRow[];
      },
    });

    const result = await parser.parse();

    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0]).toMatchObject({
      source: "astrbot",
      model: "gpt-5.4",
      project: "unknown",
      inputTokens: 100,
      outputTokens: 30,
      reasoningTokens: 0,
      cachedTokens: 20,
      totalTokens: 150,
    });
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({
      source: "astrbot",
      project: "unknown",
      durationSeconds: 5,
      activeSeconds: 5,
      messageCount: 2,
      userMessageCount: 1,
      inputTokens: 100,
      outputTokens: 30,
      cachedTokens: 20,
      totalTokens: 150,
      primaryModel: "gpt-5.4",
    });
  });

  it("falls back to the start time when end_time is invalid", async () => {
    const dbPath = makeDbPath();
    const parser = new AstrBotParser({
      dbPath,
      queryRows: async <TRow>() =>
        [
          {
            id: 2,
            provider_model: "model",
            token_output: 1,
            start_time: 1713002400,
            end_time: 1713002399,
          },
        ] as TRow[],
    });

    const result = await parser.parse();

    expect(result.sessions[0]).toMatchObject({
      durationSeconds: 0,
      activeSeconds: 0,
    });
  });

  it("returns an empty result when the database does not exist", async () => {
    const parser = new AstrBotParser({
      dbPath: join(makeTempDir("tokenarena-astrbot-missing-"), "missing.db"),
      queryRows: async <_TRow>() => {
        throw new Error("query should not run");
      },
    });

    await expect(parser.parse()).resolves.toEqual({
      buckets: [],
      sessions: [],
    });
    expect(parser.isInstalled()).toBe(false);
  });

  it("resolves the database from ASTRBOT_ROOT", () => {
    const root = makeTempDir("tokenarena-astrbot-root-");
    const dataDir = join(root, "data");
    mkdirSync(dataDir);
    writeFileSync(join(dataDir, "data_v4.db"), "", "utf-8");
    process.env.ASTRBOT_ROOT = root;

    const parser = new AstrBotParser();

    expect(parser.tool.dataDir).toBe(dataDir);
    expect(parser.isInstalled()).toBe(true);
  });
});

describe("readSqliteRowsWithLockRetry", () => {
  it("keeps the snapshot until the asynchronous retry finishes", async () => {
    const dbPath = makeDbPath();
    writeFileSync(`${dbPath}-wal`, "wal", "utf-8");
    writeFileSync(`${dbPath}-shm`, "shm", "utf-8");
    let attempts = 0;
    let snapshotPath = "";

    const rows = await readSqliteRowsWithLockRetry<{ id: number }>(
      dbPath,
      "SELECT id FROM provider_stats",
      async <TRow>(targetDbPath: string) => {
        attempts++;
        if (attempts === 1) {
          throw new Error("database is locked");
        }

        snapshotPath = targetDbPath;
        expect(existsSync(snapshotPath)).toBe(true);
        expect(existsSync(`${snapshotPath}-wal`)).toBe(true);
        expect(existsSync(`${snapshotPath}-shm`)).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(existsSync(snapshotPath)).toBe(true);
        return [{ id: 1 }] as TRow[];
      },
    );

    expect(rows).toEqual([{ id: 1 }]);
    expect(attempts).toBe(2);
    expect(existsSync(snapshotPath)).toBe(false);
  });

  it("does not retry non-lock errors", async () => {
    const dbPath = makeDbPath();
    let attempts = 0;

    await expect(
      readSqliteRowsWithLockRetry(dbPath, "SELECT 1", async <_TRow>() => {
        attempts++;
        throw new Error("schema mismatch");
      }),
    ).rejects.toThrow("schema mismatch");
    expect(attempts).toBe(1);
  });
});
