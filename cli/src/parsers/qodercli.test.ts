import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  classifyQoderEntrypoint,
  creditSnapshotsToEntries,
  extractCreditSnapshotsFromLog,
  extractQoderProject,
  QoderCliParser,
  totalCreditsUsed,
} from "./qodercli";

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

describe("extractQoderProject", () => {
  it("uses the final encoded path segment as the project name", () => {
    const projectsDir = "/home/user/.qoder/projects";
    expect(
      extractQoderProject(
        `${projectsDir}/-Users-philfan-i-TokenArena/sess.jsonl`,
        projectsDir,
      ),
    ).toBe("TokenArena");
  });
});

describe("classifyQoderEntrypoint", () => {
  it("detects qodercli vs Qoder IDE (acp)", () => {
    expect(
      classifyQoderEntrypoint(
        JSON.stringify({ type: "user", entrypoint: "cli" }),
      ),
    ).toBe("cli");
    expect(
      classifyQoderEntrypoint(
        JSON.stringify({ type: "user", entrypoint: "acp" }),
      ),
    ).toBe("acp");
    expect(classifyQoderEntrypoint(JSON.stringify({ type: "user" }))).toBe(
      "unknown",
    );
  });
});

describe("credit helpers", () => {
  it("sums personal + org + addon credits (not tokens)", () => {
    expect(
      totalCreditsUsed({
        userQuota: { used: 100 },
        orgResourcePackage: { used: 50 },
        addOnQuota: { used: 25 },
      }),
    ).toBe(175);
  });

  it("extracts credit snapshots from quota log lines", () => {
    const log = [
      `2026-07-24T12:34:04.680+08:00 INFO  [session=sess-1] session.config.loaded model="efficient"`,
      `2026-07-24T12:34:06.951+08:00 INFO  debug.message [qoderApi] GET https://openapi.qoder.sh/api/v2/quota/usage response: ${JSON.stringify(
        {
          usageType: "credits",
          userQuota: { used: 6000, unit: "credits" },
          orgResourcePackage: { used: 100, unit: "credits" },
        },
      )}`,
    ].join("\n");

    const snaps = extractCreditSnapshotsFromLog(log, {
      project: "TokenArena",
      runId: "run-1",
    });

    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toMatchObject({
      totalUsed: 6100,
      project: "TokenArena",
      sessionId: "sess-1",
      model: "efficient",
    });
  });

  it("turns positive credit deltas into usage entries (credits in inputTokens)", () => {
    const entries = creditSnapshotsToEntries([
      {
        timestamp: new Date("2026-07-24T10:00:00.000Z"),
        totalUsed: 1000,
        project: "a",
        sessionId: "s1",
        model: "efficient",
        runId: "r1",
      },
      {
        timestamp: new Date("2026-07-24T11:00:00.000Z"),
        totalUsed: 1250,
        project: "b",
        sessionId: "s2",
        model: "kmodel",
        runId: "r2",
      },
      // quota reset — ignore negative jump
      {
        timestamp: new Date("2026-07-24T12:00:00.000Z"),
        totalUsed: 100,
        project: "c",
        sessionId: "s3",
        model: "kmodel",
        runId: "r3",
      },
      {
        timestamp: new Date("2026-07-24T13:00:00.000Z"),
        totalUsed: 150,
        project: "c",
        sessionId: "s3",
        model: "kmodel",
        runId: "r4",
      },
    ]);

    expect(entries).toHaveLength(2);
    // First positive delta: 250 credits stored in inputTokens (NOT tokens)
    expect(entries[0]).toMatchObject({
      source: "qodercli",
      model: "kmodel",
      project: "b",
      inputTokens: 250,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedTokens: 0,
    });
    expect(entries[1]).toMatchObject({
      inputTokens: 50,
      project: "c",
    });
  });
});

describe("QoderCliParser", () => {
  it("parses credit deltas from run logs and sessions from cli transcripts", async () => {
    const root = makeTempDir("tokenarena-qoder-");
    const projectsDir = join(root, "projects");
    const logsDir = join(root, "logs");
    const runsDir = join(root, "runs");

    const sessionDir = join(projectsDir, "-Users-philfan-i-TokenArena");
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, "sess-cli.jsonl"),
      [
        JSON.stringify({
          type: "user",
          uuid: "u1",
          timestamp: "2026-07-24T10:00:00.000Z",
          entrypoint: "cli",
          message: { role: "user", content: "hi" },
        }),
        JSON.stringify({
          type: "assistant",
          uuid: "a1",
          timestamp: "2026-07-24T10:00:05.000Z",
          entrypoint: "cli",
          message: { role: "assistant", model: "efficient", content: "ok" },
        }),
      ].join("\n"),
      "utf-8",
    );

    // Two runs with quota snapshots → one credit delta of 100
    for (const [runId, used, ts] of [
      ["run-a", 1000, "2026-07-24T09:00:00.000+08:00"],
      ["run-b", 1100, "2026-07-24T10:00:00.000+08:00"],
    ] as const) {
      const runPath = join(runsDir, runId);
      mkdirSync(runPath, { recursive: true });
      writeFileSync(
        join(runPath, "manifest.json"),
        JSON.stringify({
          run_id: runId,
          cwd: "/Users/philfan/i/TokenArena",
          project_id: "-Users-philfan-i-TokenArena",
        }),
        "utf-8",
      );
      writeFileSync(
        join(runPath, "qodercli.log"),
        [
          `${ts} INFO  [session=sess-cli] session.config.loaded model="efficient"`,
          `${ts} INFO  debug.message [qoderApi] GET https://openapi.qoder.sh/api/v2/quota/usage response: ${JSON.stringify(
            {
              usageType: "credits",
              userQuota: { used, unit: "credits" },
              orgResourcePackage: { used: 0, unit: "credits" },
            },
          )}`,
        ].join("\n"),
        "utf-8",
      );
    }

    const parser = new QoderCliParser(projectsDir, logsDir, runsDir);
    const result = await parser.parse();

    // Credit delta 100 → bucket totalTokens=100 (these are credits, not tokens)
    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0]).toMatchObject({
      source: "qodercli",
      model: "efficient",
      project: "TokenArena",
      inputTokens: 100,
      outputTokens: 0,
      totalTokens: 100,
    });

    expect(result.sessions.length).toBeGreaterThanOrEqual(1);
    const session = result.sessions.find((s) => s.project === "TokenArena");
    expect(session).toMatchObject({
      source: "qodercli",
      project: "TokenArena",
      userMessageCount: 1,
    });
  });

  it("ignores Qoder IDE (acp) sessions", async () => {
    const root = makeTempDir("tokenarena-qoder-ide-");
    const projectsDir = join(root, "projects");
    const sessionDir = join(projectsDir, "-Users-philfan-i-motif");
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, "ide-sess.jsonl"),
      [
        JSON.stringify({
          type: "user",
          timestamp: "2026-07-24T10:00:00.000Z",
          entrypoint: "acp",
          message: { role: "user" },
        }),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-07-24T10:00:05.000Z",
          entrypoint: "acp",
          message: { role: "assistant" },
        }),
      ].join("\n"),
      "utf-8",
    );

    const parser = new QoderCliParser(
      projectsDir,
      join(root, "logs"),
      join(root, "runs"),
    );
    const result = await parser.parse();
    expect(result.buckets).toEqual([]);
    expect(result.sessions).toEqual([]);
  });

  it("returns empty when no data", async () => {
    const root = makeTempDir("tokenarena-qoder-empty-");
    const parser = new QoderCliParser(
      join(root, "missing-projects"),
      join(root, "missing-logs"),
      join(root, "missing-runs"),
    );
    const result = await parser.parse();
    expect(result.buckets).toEqual([]);
    expect(result.sessions).toEqual([]);
  });
});
