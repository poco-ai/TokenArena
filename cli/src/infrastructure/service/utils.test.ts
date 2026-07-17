import { describe, expect, it } from "vitest";
import {
  getManagedServiceEnvironment,
  resolveManagedDaemonCommand,
} from "./utils";

describe("resolveManagedDaemonCommand", () => {
  it("appends daemon service mode arguments", () => {
    expect(
      resolveManagedDaemonCommand("/usr/local/bin/node", [
        "node",
        "/tmp/tokenarena/dist/index.js",
      ]),
    ).toEqual({
      execPath: "/usr/local/bin/node",
      args: ["/tmp/tokenarena/dist/index.js", "daemon", "--service"],
    });
  });
});

describe("getManagedServiceEnvironment", () => {
  it("merges path fallbacks and preserves supported XDG variables", () => {
    expect(
      getManagedServiceEnvironment({
        PATH: "/custom/bin:/usr/local/bin",
        TOKEN_ARENA_DEV: "1",
        ASTRBOT_BASE_PATH: "/srv/astrbot",
        XDG_CONFIG_HOME: "/tmp/config",
      }),
    ).toEqual({
      PATH: "/custom/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
      TOKEN_ARENA_DEV: "1",
      ASTRBOT_BASE_PATH: "/srv/astrbot",
      XDG_CONFIG_HOME: "/tmp/config",
    });
  });
});
