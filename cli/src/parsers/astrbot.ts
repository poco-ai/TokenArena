import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { aggregateToBuckets } from "../domain/aggregator";
import type { ParseResult, TokenUsageEntry } from "../domain/types";
import { registerParser } from "./registry";
import type { IParser, ToolDefinition } from "./types";

const TOOL_ID = "astrbot";
const TOOL_NAME = "AstrBot";

function getDefaultDbPath(): string {
  const envRoot = process.env.ASTRBOT_ROOT?.trim();
  if (envRoot) {
    const resolved = resolve(envRoot);
    return join(resolved, "data", "data_v4.db");
  }
  const desktop = join(homedir(), ".astrbot", "data", "data_v4.db");
  if (existsSync(desktop)) return desktop;
  return join(process.cwd(), "data", "data_v4.db");
}

const PROVIDER_STATS_QUERY = `SELECT
  provider_model,
  token_input_other,
  token_input_cached,
  token_output,
  start_time
  FROM provider_stats
  WHERE (token_input_other > 0
    OR token_input_cached > 0
    OR token_output > 0)
    AND start_time > 0
  ORDER BY start_time ASC`;

interface ProviderStatRow {
  provider_model?: unknown;
  token_input_other?: unknown;
  token_input_cached?: unknown;
  token_output?: unknown;
  start_time?: unknown;
}

type SqliteQueryRows = (
  dbPath: string,
  query: string,
) => Promise<ProviderStatRow[]>;

interface AstrBotParserOptions {
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

async function readProviderStatRows(
  dbPath: string,
  query: string,
): Promise<ProviderStatRow[]> {
  return readSqliteRows<ProviderStatRow>(dbPath, query);
}

async function readSqliteRowsWithLockRetry(
  dbPath: string,
  query: string,
  queryRows: SqliteQueryRows,
): Promise<ProviderStatRow[]> {
  try {
    return await queryRows(dbPath, query);
  } catch (err) {
    if (isLockError(err)) {
      const snapshotDir = mkdtempSync(join(tmpdir(), "tokenarena-astrbot-"));
      const snapshotPath = join(snapshotDir, "data_v4.db");
      try {
        copyFileSync(dbPath, snapshotPath);
        for (const suffix of ["-shm", "-wal"]) {
          const companion = `${dbPath}${suffix}`;
          if (existsSync(companion))
            copyFileSync(companion, `${snapshotPath}${suffix}`);
        }
        return await queryRows(snapshotPath, query);
      } finally {
        rmSync(snapshotDir, { recursive: true, force: true });
      }
    }
    throw err;
  }
}

export class AstrBotParser implements IParser {
  readonly tool: ToolDefinition;
  private readonly dbPath: string;
  private readonly queryRows: SqliteQueryRows;

  constructor(options: AstrBotParserOptions = {}) {
    this.dbPath = options.dbPath || getDefaultDbPath();
    this.queryRows = options.queryRows || readProviderStatRows;
    this.tool = createToolDefinition(this.dbPath);
  }

  async parse(): Promise<ParseResult> {
    if (!existsSync(this.dbPath)) {
      return { buckets: [], sessions: [] };
    }

    const rows = await readSqliteRowsWithLockRetry(
      this.dbPath,
      PROVIDER_STATS_QUERY,
      this.queryRows,
    );

    if (!rows.length) return { buckets: [], sessions: [] };

    const entries: TokenUsageEntry[] = [];

    for (const row of rows) {
      const timestamp = parseUnixSeconds(row.start_time);
      if (!timestamp) continue;

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

      entries.push({
        source: TOOL_ID,
        model,
        project: "unknown",
        timestamp,
        inputTokens,
        outputTokens,
        reasoningTokens: 0,
        cachedTokens,
      });
    }

    return {
      buckets: aggregateToBuckets(entries),
      sessions: [],
    };
  }

  isInstalled(): boolean {
    return existsSync(this.dbPath);
  }
}

registerParser(new AstrBotParser());
