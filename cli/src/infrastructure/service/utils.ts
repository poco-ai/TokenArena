const SERVICE_PATH_FALLBACKS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
];

const SERVICE_ENV_KEYS = [
  "TOKEN_ARENA_DEV",
  "ASTRBOT_ROOT",
  "CLAUDE_CONFIG_DIR",
  "CURSOR_CONFIG_DIR",
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
  "XDG_RUNTIME_DIR",
] as const;

export interface ManagedDaemonCommand {
  execPath: string;
  args: string[];
}

function dedupePaths(paths: string[]): string[] {
  return [...new Set(paths.filter(Boolean))];
}

export function getManagedServiceEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const pathEntries = dedupePaths([
    ...(env.PATH?.split(":") ?? []),
    ...SERVICE_PATH_FALLBACKS,
  ]);
  const next: Record<string, string> = {
    PATH: pathEntries.join(":"),
  };

  for (const key of SERVICE_ENV_KEYS) {
    const value = env[key];
    if (value) {
      next[key] = value;
    }
  }

  return next;
}

export function resolveManagedDaemonCommand(
  execPath = process.execPath,
  argv = process.argv,
): ManagedDaemonCommand {
  const scriptPath = argv[1];
  if (!scriptPath) {
    throw new Error("无法解析 CLI 入口路径，请通过 tokenarena 命令重新执行。");
  }

  return {
    execPath,
    args: [scriptPath, "daemon", "--service"],
  };
}

export function escapeDoubleQuotedValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
