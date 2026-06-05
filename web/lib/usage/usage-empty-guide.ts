/** Commands shown in the usage dashboard empty-state setup guide (copyable blocks). */
export const USAGE_EMPTY_INSTALL_COMMAND = "npm install -g @ihadu/tokenarena";

/** Offline fallback for users without a GitHub PAT / account. */
export const USAGE_EMPTY_INSTALL_OFFLINE_COMMAND = `# 1. 浏览器下载最新版本（无需 GitHub 账号）:
#    https://github.com/ihadu/TokenArena/releases/latest
# 2. 终端安装（替换 <version> 为实际版本号）:
npm install -g ./ihadu-tokenarena-<version>.tgz`;

export const USAGE_EMPTY_INIT_COMMAND =
  "tokenarena init --api-url http://192.168.6.74:3000";
