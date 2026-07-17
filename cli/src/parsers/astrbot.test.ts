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
import { AstrBotParser } from "./astrbot";

const tempDirs: string[] = [];
const originalAstrBotBasePath = process.env.ASTRBOT_BASE_PATH;

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

  if (originalAstrBotBasePath === undefined) {
    delete process.env.ASTRBOT_BASE_PATH;
  } else {
    process.env.ASTRBOT_BASE_PATH = originalAstrBotBasePath;
  }
});

describe("AstrBotParser", () => {
  it("maps provider stats to token buckets", async () => {
    const dbPath = makeDbPath();
    const parser = new AstrBotParser({
      dbPath,
      queryRows: async (targetDbPath: string, query: string) => {
        expect(targetDbPath).toBe(dbPath);
        expect(query).toContain("FROM provider_stats");

        return [
          {
            provider_model: "gpt-5.4",
            token_input_other: "100",
            token_input_cached: 20,
            token_output: 30,
            start_time: 1713002400,
          },
        ];
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
    expect(result.sessions).toEqual([]);
  });

  it("clamps negative token counts to zero", async () => {
    const dbPath = makeDbPath();
    const parser = new AstrBotParser({
      dbPath,
      queryRows: async () => [
        {
          provider_model: "gpt-5.4",
          token_input_other: -10,
          token_input_cached: -5,
          token_output: 8,
          start_time: 1713002400,
        },
      ],
    });

    const result = await parser.parse();

    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0]).toMatchObject({
      inputTokens: 0,
      cachedTokens: 0,
      outputTokens: 8,
      totalTokens: 8,
    });
  });

  it("returns an empty result when the database does not exist", async () => {
    const parser = new AstrBotParser({
      dbPath: join(makeTempDir("tokenarena-astrbot-missing-"), "missing.db"),
      queryRows: async () => {
        throw new Error("query should not run");
      },
    });

    await expect(parser.parse()).resolves.toEqual({
      buckets: [],
      sessions: [],
    });
    expect(parser.isInstalled()).toBe(false);
  });

  it("resolves the database from ASTRBOT_BASE_PATH", () => {
    const root = makeTempDir("tokenarena-astrbot-base-");
    const dataDir = join(root, "data");
    mkdirSync(dataDir);
    writeFileSync(join(dataDir, "data_v4.db"), "", "utf-8");
    process.env.ASTRBOT_BASE_PATH = root;

    const parser = new AstrBotParser();

    expect(parser.tool.dataDir).toBe(dataDir);
    expect(parser.isInstalled()).toBe(true);
  });
});

describe("SQLite lock retry", () => {
  it("keeps the snapshot until the asynchronous retry finishes", async () => {
    const dbPath = makeDbPath();
    writeFileSync(`${dbPath}-wal`, "wal", "utf-8");
    writeFileSync(`${dbPath}-shm`, "shm", "utf-8");
    let attempts = 0;
    let snapshotPath = "";

    const parser = new AstrBotParser({
      dbPath,
      queryRows: async (targetDbPath: string) => {
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
        return [
          {
            provider_model: "model",
            token_output: 1,
            start_time: 1713002400,
          },
        ];
      },
    });

    const result = await parser.parse();

    expect(result.buckets).toHaveLength(1);
    expect(attempts).toBe(2);
    expect(existsSync(snapshotPath)).toBe(false);
  });

  it("does not retry non-lock errors", async () => {
    const dbPath = makeDbPath();
    let attempts = 0;

    await expect(
      new AstrBotParser({
        dbPath,
        queryRows: async () => {
          attempts++;
          throw new Error("schema mismatch");
        },
      }).parse(),
    ).rejects.toThrow("schema mismatch");
    expect(attempts).toBe(1);
  });
});
