[![tokenarena](assets/banner.png)](https://token.poco-ai.com)

[![Docker Image](https://img.shields.io/badge/Docker%20Image-tokenarena%3Alatest-blue?logo=docker&logoColor=white)](https://github.com/poco-ai/tokenarena/pkgs/container/tokenarena) [![pnpm](https://img.shields.io/badge/pnpm-monorepo-blue?logo=pnpm)](https://pnpm.io/) [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](https://github.com/poco-ai/tokenarena/pulls) [![License](https://img.shields.io/github/license/poco-ai/tokenarena)](LICENSE) [![React Doctor](https://www.react.doctor/share/badge?p=web&s=73&e=0&w=0&f=0)](https://www.react.doctor/share?p=web&s=73&e=0&w=0&f=0)

你有没有好奇过：

- **每天到底花了多少 token？**
- 哪个项目最费 token？
- 输入、输出、reasoning、缓存的比例是多少？
- 一天里什么时候最活跃？

**Token Arena 是一个开源的 AI 用量追踪平台**

它能自动采集本地 AI coding CLI 的使用数据，让你在简洁的 Web 仪表盘中一目了然地看到每天的 token 消耗、会话活跃度和多维度分析。

## 功能概览

- **Usage 总览** — 按 1 天 / 7 天 / 30 天 / 自定义区间查看 token 用量
- **多维度分析** — 按设备、工具、模型、项目分组查看数据
- **详细指标** — 总 token、输入、输出、reasoning、缓存命中、活跃时长、会话数、消息数
- **多工具支持** — 支持采集多种本地 AI CLI 的 usage 数据
- **Oauth2 登录** — 支持 Discord、GitHub、GitLab、Google、Linux.do、观猹平台登录
- **Badge 分享** — 支持分享 token 使用、预计消耗、使用时长以及使用热力图
- **社区与排行榜** - 关注你感兴趣的人，查看他们的 token 用量排行榜
- **多语言 & 深色模式** — 支持中英文切换和主题切换
- **隐私优先** — 项目名称默认按 hash 匿名上传，你自行决定是否公开

## Quick Start

1. **注册账号** — 访问 [Token Arena](https://token.poco-ai.com) 注册并登录
2. **创建 API Key** — 在 [Settings](https://token.poco-ai.com/zh/settings/cli-keys) 中生成 API key
3. **下载**
    ```shell
    npm install -g @poco-ai/tokenarena
    ```
4. **初始化 CLI** — 运行 `tokenarena init`，输入 API key
5. **查看分析** — 打开 [Usage](https://token.poco-ai.com/zh/usage) 页面查看你的 token 用量分析

> [!TIP]
>
> - **手动同步**：运行 `tokenarena sync`，手动将本地数据上传至 Web 端。
> - **持续同步**：运行 `tokenarena daemon`，保持 CLI 运行，实现数据定时自动同步（默认每 5 分钟）。
> - **后台服务（Linux / macOS）**：运行 `tokenarena service setup`，将 daemon 注册为用户级后台服务，登录后自动启动、异常退出自动拉起。

**后台服务管理（Linux / macOS）**

```bash
tokenarena service setup      # 创建并启用服务
tokenarena service start      # 启动服务
tokenarena service stop       # 停止服务
tokenarena service restart    # 重启服务
tokenarena service status     # 查看服务状态
tokenarena service uninstall  # 卸载服务
```

> [!NOTE]
> `service` 仅在 Linux / macOS 上可用，无需 root 权限。
> - Linux 使用用户级 `systemd` 单元：`~/.config/systemd/user/tokenarena.service`
> - macOS 使用用户级 `launchd` Agent：`~/Library/LaunchAgents/com.poco-ai.tokenarena.plist`
> `tokenarena init` 在支持的环境中会自动询问是否设置此服务。

## 本地部署

### Docker 部署（推荐）

```bash
git clone https://github.com/poco-ai/tokenarena.git
cd tokenarena
chmod +x start.sh
./start.sh
```

```powershell
git clone https://github.com/poco-ai/tokenarena.git
cd tokenarena
.\start.ps1
# or: .\start.cmd
```

启动脚本会自动创建配置文件、生成安全密钥并启动所有服务。

**Docker 常用命令**

```bash
docker compose logs -f          # 查看日志
docker compose down              # 停止服务
docker compose pull && docker compose up -d  # 更新并重启
docker compose down -v           # 停止并删除数据
```

> [!TIP]
> 使用 `docker compose` / `./start.sh` 时，请修改仓库根目录的 `.env`。
> 此时 `DATABASE_URL` 的主机名应为 `db`，不要写 `localhost`。

### 本地开发

[![CI](https://github.com/poco-ai/tokenarena/actions/workflows/ci.yml/badge.svg)](https://github.com/poco-ai/tokenarena/actions/workflows/ci.yml) [![Release](https://github.com/poco-ai/tokenarena/actions/workflows/release.yml/badge.svg)](https://github.com/poco-ai/tokenarena/actions/workflows/release.yml) [![Coverage](https://codecov.io/gh/poco-ai/tokenarena/branch/main/graph/badge.svg)](https://codecov.io/gh/poco-ai/tokenarena) [![CodeQL](https://github.com/poco-ai/tokenarena/actions/workflows/codeql.yml/badge.svg)](https://github.com/poco-ai/tokenarena/actions/workflows/codeql.yml)

```bash
pnpm install
pnpm migrate      # 部署 Prisma 数据库迁移
pnpm db:seed      # 生成一些 mock user 数据，用于开发
pnpm dev:web      # 启动 Web 仪表盘
pnpm dev:cli      # 启动 CLI 开发模式
pnpm build:cli    # 构建 CLI 工具
TOKEN_ARENA_API_URL=http://localhost:3000 node cli/dist/index.js init
```

常用工作区命令：

```bash
pnpm build        # 构建 CLI 与 Web
pnpm build:cli    # 仅构建 CLI
pnpm build:web    # 仅构建 Web
pnpm test:cli     # 运行 CLI 测试并生成覆盖率
pnpm test:web     # 运行 Web 测试并生成覆盖率
pnpm check        # 运行 lint 与 format 检查
pnpm react-doctor       # 使用 React Doctor 检查 Web 端 React 代码健康度
```

发布由 release-please 管理。普通提交合入 `main` 后，Release workflow 会维护一个 Release PR；确认版本和 changelog 后合并该 PR，云端会创建 `vX.Y.Z` tag / GitHub Release，发布 CLI 到 npm，并用同一个 tag 构建 Web Docker 镜像。不要手动修改三个 `package.json` 版本或手动打 release tag。

Docker Compose 启动时，根目录 `.env` 里的 `DATABASE_URL` 应使用 `db` 作为主机名，例如：
 
```bash
DATABASE_URL=postgresql://postgres:postgres@db:5432/tokens_burned
```

### Windows 换行与提交说明

仓库根目录的 `.gitattributes` 已统一约束换行符，避免 Windows 下因为 `CRLF` / `LF` 差异导致 `Biome`、`Husky` 或 Git diff 异常：

- `*.ts`、`*.tsx`、`*.js`、`*.json`、`*.yml`、`*.md`、`*.css`、`*.sh` 等源码与配置文件统一使用 `LF`
- `*.ps1`、`*.cmd`、`*.bat` 保持 Windows 友好的 `CRLF`

如果你在 Windows 上提交代码时看到类似 `Formatter would have printed...`、`Found X errors`、`husky - pre-commit script failed` 之类的提示，通常先运行下面的命令即可：

```bash
pnpm run format:cli
pnpm run format:web
pnpm run lint:cli
pnpm run lint:web
pnpm run check
```

如果是旧工作区在 `.gitattributes` 生效前检出的文件导致换行不一致，可以额外执行一次：

```bash
git add --renormalize .
```

### 环境变量

可以参考 [`.env.example`](.env.example) 文件配置环境变量。

| 变量 | 说明 | 示例 |
|------|------|------|
| `BETTER_AUTH_SECRET` | 认证密钥 | `openssl rand -base64 32` 生成 |
| `BETTER_AUTH_URL` | 应用对外访问 URL | `http://localhost:3000` |
| `GA_SECRET` | Google Analytics 4 测量 ID（配置后才注入 GA 脚本） | `G-XXXXXXXXXX` |
| `AUTH_MODE` | 认证模式（`self-hosted` / `production`） | `self-hosted` |
| `DATABASE_URL` | PostgreSQL 连接字符串 | `postgresql://postgres:postgres@db:5432/token_arena` |
| `POSTGRES_USER` | PostgreSQL 用户名 | `postgres` |
| `POSTGRES_PASSWORD` | PostgreSQL 密码 | `postgres` |
| `POSTGRES_DB` | PostgreSQL 数据库名 | `token_arena` |
| `GITLAB_BASE_URL` | GitLab 实例地址，支持 `gitlab.com` 或自建实例 | `https://gitlab.example.com` |
| `GITLAB_CLIENT_ID` | GitLab OAuth Application Client ID | `glapp-xxxxx` |
| `GITLAB_CLIENT_SECRET` | GitLab OAuth Application Client Secret | `secret` |

当 `AUTH_MODE=production` 时，还需要按需配置以下 OAuth 变量：

- `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`
- `GITLAB_BASE_URL` / `GITLAB_CLIENT_ID` / `GITLAB_CLIENT_SECRET`
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- `LINUXDO_CLIENT_ID` / `LINUXDO_CLIENT_SECRET`
- `WATCHA_CLIENT_ID` / `WATCHA_CLIENT_SECRET`

`GITLAB_BASE_URL` 可指向 `https://gitlab.com` 或你的自建 GitLab；GitLab OAuth 回调地址为 `/api/auth/oauth2/callback/gitlab`。

## 技术栈

| 层 | 技术 |
|----|------|
| CLI | TypeScript, Commander |
| Web | Next.js (App Router), React, shadcn/ui |
| 数据库 | PostgreSQL, Prisma |
| 认证 | better-auth |
| 构建 | pnpm monorepo |
| 部署 | Docker Compose |

## 致谢

本项目灵感来源于 [vibe-cafe/vibe-usage](https://github.com/vibe-cafe/vibe-usage)，感谢该项目的启发。

特别感谢 [Linux.do](https://linux.do/) 和 [观猹](https://watcha.cn/) 社区的支持与帮助。

## License

MIT
