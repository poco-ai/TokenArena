// Import parsers to register them before CLI setup
import "./parsers/claude-code.js";
import "./parsers/codex.js";
import "./parsers/gsd.js";
import "./parsers/gemini-cli.js";
import "./parsers/hermes.js";
import "./parsers/copilot-cli.js";
import "./parsers/oh-my-pi.js";
import "./parsers/opencode.js";
import "./parsers/openclaw.js";
import "./parsers/qwen-code.js";
import "./parsers/kimi-code.js";
import "./parsers/droid.js";
import "./parsers/pi-coding-agent.js";
import "./parsers/qwenpaw.js";
import "./parsers/cline.js";
import "./parsers/kiro.js";
import "./parsers/roo-code.js";
import "./parsers/cursor.js";
import "./parsers/qodercli.js";
import "./parsers/grok-build.js";

import { createCli } from "./cli.js";
import { isMainModule } from "./infrastructure/runtime/main-module.js";

export function normalizeArgv(argv: string[]) {
  return argv.filter((arg, index) => index < 2 || arg !== "--");
}

export async function run(argv = process.argv) {
  const program = createCli();
  await program.parseAsync(normalizeArgv(argv));
}

if (isMainModule()) {
  void run();
}
