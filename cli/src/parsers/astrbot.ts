import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { aggregateToBuckets } from "../domain/aggregator";
import { extractSessions } from "../domain/session-extractor";
import type {
  ParseResult,
  SessionEvent,
  TokenUsageEntry,
} from "../domain/types";
import { registerParser } from "./registry";
import type { IParser, ToolDefinition } from "./types";

const TOOL_ID = "astrbot";
const TOOL_NAME = "AstrBot";

// AstrBot stores data in {root}/data/data_v4.db.
// Root resolution (mirrors astrbot/core/utils/astrbot_path.py):
//   1. ASTRBOT_ROOT env var
//   2. ~/.astrbot (desktop-packaged runtime)
//   3. cwd (most common for CLI deployments)
function getDefaultDbPath(): string {
  const envRoot = process.env.ASTRBOT_ROOT?.trim();
  if (envRoot) {
    const resolved = resolve(envRoot);
    return join(resolved, "data", "data_v4.db");
  }
  // Desktop-packaged runtime default
  const desktop = join(homedir(), ".astrbot", "data", "data_v4.db");
  if (existsSync(desktop)) return desktop;
  // CLI / source deployment — current working directory
  return join(process.cwd(), "data", "data_v4.db");
}

const PROVIDER_STATS_QUERY = `SELECT
  id,
  agent_type,
  conversation_id,
  provider_model,
  token_input_other,
  token_input_cached,
  token_output,
  start_time,
  end_time
  FROM provider_stats
  WHERE (token_input_other > 0
    OR token_input_cached > 0
    OR token_output > 0)
    AND start_time > 0
  ORDER BY start_time ASC`;

interface ProviderStatRow {
  id?: unknown;
  agent_type?: unknown;
  conversation_id?: unknown;
  provider_model?: unknown;
  token_input_other?: unknown;
  token_input_cached?: unknown;
  token_output?: unknown;
  start_time?: unknown;
  end_time?: unknown;
}

export type SqliteQueryRows = <TRow>(
  dbPath: string,
  query: string,
) => Promise<TRow[]>;

export interface AstrBotParserOptions {
  dbPath?: string;
  queryRows?: SqliteQueryRows;
}

function createToolDefinition(dbPath: string): ToolDefinition {
  return {
    id: TOOL_ID,
    name: TOOL_NAME,
    dataDir: dirname(dbPath),
  };
}

function toSafeNumber(value: unknown): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

/** AstrBot stores timestamps as Unix epoch seconds (float). */
function parseUnixSeconds(value: unknown): Date | null {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return null;
  const timestamp = new Date(numberValue * 1000);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp;
}

function isLockError(err: unknown): boolean {
  return (
    err instanceof Error &&
    typeof err.message === "string" &&
    /database is locked/i.test(err.message)
  );
}

// ---- sqlite3 CLI helpers (same pattern as hermes.ts / opencode.ts / kiro.ts) ----

function withSuppressedSqliteWarning<T>(fn: () => Promise<T>): Promise<T> {
  const originalEmitWarning = process.emitWarning;

  process.emitWarning = ((
    warning: string | Error,
    ...args: unknown[]
  ): void => {
    const warningName =
      typeof warning === "string"
        ? typeof args[0] === "string"
          ? args[0]
          : ""
        : warning.name;
    const warningMessage =
      typeof warning === "string" ? warning : warning.message;

    if (
      warningName === "ExperimentalWarning" &&
      warningMessage.includes("SQLite")
    ) {
      return;
    }

    (
      originalEmitWarning as (
        warning: string | Error,
        ...warningArgs: unknown[]
      ) => void
    ).call(process, warning, ...args);
  }) as typeof process.emitWarning;

  return fn().finally(() => {
    process.emitWarning = originalEmitWarning;
  });
}

async function readSqliteRowsWithBuiltin<TRow>(
  dbPath: string,
  query: string,
): Promise<TRow[] | null> {
  try {
    return await withSuppressedSqliteWarning(async () => {
      const sqliteModuleId = "node:sqlite";
      const sqlite = (await import(sqliteModuleId)) as {
        DatabaseSync: new (
          location: string,
        ) => {
          close(): void;
          prepare(sql: string): {
            all(): TRow[];
          };
        };
      };
      const db = new sqlite.DatabaseSync(dbPath);

      try {
        return db.prepare(query).all() as TRow[];
      } finally {
        db.close();
      }
    });
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    const message = (err as Error).message;
    if (
      error.code === "ERR_UNKNOWN_BUILTIN_MODULE" ||
      message.includes("node:sqlite")
    ) {
      return null;
    }

    throw err;
  }
}

function readSqliteRowsWithCli<TRow>(dbPath: string, query: string): TRow[] {
  const candidates = [
    process.env.TOKEN_ARENA_SQLITE3,
    "sqlite3",
    "sqlite3.exe",
  ].filter((value): value is string => Boolean(value));

  let lastError: Error | null = null;

  for (const command of candidates) {
    try {
      const output = execFileSync(command, ["-json", dbPath, query], {
        encoding: "utf-8",
        maxBuffer: 100 * 1024 * 1024,
        timeout: 30000,
        windowsHide: true,
      }).trim();

      if (!output || output === "[]") {
        return [];
      }

      return JSON.parse(output) as TRow[];
    } catch (err) {
      lastError = err as Error;
      const nodeError = err as NodeJS.ErrnoException & { status?: number };
      if (nodeError.status === 127 || nodeError.message?.includes("ENOENT")) {
        continue;
      }

      throw err;
    }
  }

  throw new Error(
    `sqlite3 CLI not found. Install sqlite3 or set TOKEN_ARENA_SQLITE3 to its full path. Last error: ${lastError?.message || "not found"}`,
  );
}

async function readSqliteRows<TRow>(
  dbPath: string,
  query: string,
): Promise<TRow[]> {
  const builtinRows = await readSqliteRowsWithBuiltin<TRow>(dbPath, query);
  return builtinRows ?? readSqliteRowsWithCli<TRow>(dbPath, query);
}

export async function readSqliteRowsWithLockRetry<TRow>(
  dbPath: string,
  query: string,
  queryRows: SqliteQueryRows = readSqliteRows,
): Promise<TRow[]> {
  try {
    return await queryRows<TRow>(dbPath, query);
  } catch (err) {
    if (isLockError(err)) {
      // Database locked — snapshot and retry (same pattern as kiro.ts)
      const snapshotDir = mkdtempSync(join(tmpdir(), "tokenarena-astrbot-"));
      const snapshotPath = join(snapshotDir, "data_v4.db");
      try {
        copyFileSync(dbPath, snapshotPath);
        for (const suffix of ["-shm", "-wal"]) {
          const companion = `${dbPath}${suffix}`;
          if (existsSync(companion))
            copyFileSync(companion, `${snapshotPath}${suffix}`);
        }
        return await queryRows<TRow>(snapshotPath, query);
      } finally {
        rmSync(snapshotDir, { recursive: true, force: true });
      }
    }
    throw err;
  }
}

// ---- Parser ----

export class AstrBotParser implements IParser {
  readonly tool: ToolDefinition;
  private readonly dbPath: string;
  private readonly queryRows: SqliteQueryRows;

  constructor(options: AstrBotParserOptions = {}) {
    this.dbPath = options.dbPath || getDefaultDbPath();
    this.queryRows = options.queryRows || readSqliteRowsWithLockRetry;
    this.tool = createToolDefinition(this.dbPath);
  }

  async parse(): Promise<ParseResult> {
    if (!existsSync(this.dbPath)) {
      return { buckets: [], sessions: [] };
    }

    let rows: ProviderStatRow[];
    try {
      rows = await this.queryRows<ProviderStatRow>(
        this.dbPath,
        PROVIDER_STATS_QUERY,
      );
    } catch (err) {
      if (
        err instanceof Error &&
        typeof err.message === "string" &&
        err.message.includes("ENOENT")
      ) {
        throw new Error(
          "sqlite3 CLI not found. Install sqlite3 to sync AstrBot data.",
        );
      }
      throw err;
    }

    if (!rows.length) return { buckets: [], sessions: [] };

    const entries: TokenUsageEntry[] = [];
    const sessionEvents: SessionEvent[] = [];

    for (const row of rows) {
      const startTimestamp = parseUnixSeconds(row.start_time);
      if (!startTimestamp) continue;
      const parsedEndTimestamp = parseUnixSeconds(row.end_time);
      const endTimestamp =
        parsedEndTimestamp && parsedEndTimestamp >= startTimestamp
          ? parsedEndTimestamp
          : startTimestamp;

      const inputTokens = toSafeNumber(row.token_input_other);
      const cachedTokens = toSafeNumber(row.token_input_cached);
      const outputTokens = toSafeNumber(row.token_output);

      if (inputTokens === 0 && cachedTokens === 0 && outputTokens === 0) {
        continue;
      }

      const model =
        typeof row.provider_model === "string" && row.provider_model.length > 0
          ? row.provider_model
          : "unknown";

      // Each provider_stats row is one LLM API call — use its id as a unique
      // reference and conversation_id for session grouping.
      const conversationId =
        typeof row.conversation_id === "string" &&
        row.conversation_id.length > 0
          ? row.conversation_id
          : row.id != null
            ? `orphan-${String(row.id)}`
            : "unknown";

      entries.push({
        sessionId: conversationId,
        source: TOOL_ID,
        model,
        project: "unknown",
        timestamp: startTimestamp,
        inputTokens,
        outputTokens,
        reasoningTokens: 0,
        cachedTokens,
      });

      // Each provider_stats row represents one request. AstrBot does not
      // expose the corresponding message table here, so synthesize a user
      // event plus an assistant timing range. The start marker is excluded
      // from message counts but lets extractSessions preserve active time.
      sessionEvents.push({
        sessionId: conversationId,
        source: TOOL_ID,
        project: "unknown",
        timestamp: startTimestamp,
        role: "user",
      });
      sessionEvents.push({
        sessionId: conversationId,
        source: TOOL_ID,
        project: "unknown",
        timestamp: startTimestamp,
        role: "assistant",
        countAsMessage: false,
      });
      sessionEvents.push({
        sessionId: conversationId,
        source: TOOL_ID,
        project: "unknown",
        timestamp: endTimestamp,
        role: "assistant",
      });
    }

    return {
      buckets: aggregateToBuckets(entries),
      sessions: extractSessions(sessionEvents, entries),
    };
  }

  isInstalled(): boolean {
    return existsSync(this.dbPath);
  }
}

registerParser(new AstrBotParser());
