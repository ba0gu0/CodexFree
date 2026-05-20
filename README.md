# CodexFree

[English](./README_EN.md)

CodexFree 是一个 Electron 桌面工具，用于管理大量 Codex JSON 授权文件，并在本机运行
Codex 账号模式代理。它可以把多个 free、plus、pro 账号授权导入账号池，在使用 Codex
App 或 Codex CLI 时自动轮换账号额度，不需要频繁重启 Codex App，也不需要部署 VPS 服务器。

## 它解决什么问题

- 你有多个 Codex / ChatGPT 账号授权文件，希望统一导入、管理和检查额度。
- 你希望 Codex 请求自动使用账号池额度，而不是一直消耗本地登录账号。
- 某个账号额度耗尽后，希望后续请求自动切换到其他可用账号。
- 你希望在本机桌面应用中查看代理状态、请求记录、账号用量和切换事件。

## 工作原理

CodexFree 修改 Codex 的 base URL，让 Codex 请求先进入本机服务：

```toml
chatgpt_base_url = "http://127.0.0.1:33333/backend-api"
openai_base_url = "http://127.0.0.1:33333/backend-api/codex"
```

请求进入本机代理后，CodexFree 不修改 request body，只在转发上游时替换认证相关 header，
让请求实际使用账号池中的账号额度。

本机 `~/.codex/auth.json` 仍然需要存在。它的作用是让 Codex App / Codex CLI 正常启动并
进入 ChatGPT 账号模式。建议先登录一个自己的 ChatGPT/Codex 账号，free 账号也可以。这样配置后，
Codex App 的远程控制仍然可以正常使用：手机版 ChatGPT App 登录相同账号，点击 Codex 连接即可。
CodexFree 不影响远程控制的连接和管理。

如果没有自己的账号，也可以手动从账号池中复制一个账号写入 `~/.codex/auth.json`。注意：
使用账号池账号作为本地登录账号时，不要打开 Codex 远程控制功能，除非该账号确实属于你自己，
避免会话被账号所有者看到或控制。

## 当前功能

- Electron 桌面控制台，包含总览、账号、代理、请求和用量页面。
- 批量导入 Codex native auth、CPA-like、sub2api-like 授权文件。
- 账号池状态管理：可用、禁用、额度耗尽、401 清理和耗尽重置。
- 批量查询账号用量，并把结果写入本地 SQLite。
- 本机 Codex 账号模式代理，默认监听 `127.0.0.1:33333`。
- 透明转发 Codex account-login 请求，不改写请求体。
- 自动替换上游 `Authorization` 和 `chatgpt-account-id`。
- 按会话/轮次绑定账号，识别 quota exhaustion 后在后续边界切换账号。
- WebSocket responses 流量解析、请求 ledger、quota 事件和路由事件记录。
- 可选 raw capture 调试目录，默认关闭。
- 首次引导和配置助手，用于检查代理、`config.toml`、`auth.json` 和账号池状态。

## 快速使用

1. 启动 CodexFree。
2. 使用自己的 ChatGPT/Codex 账号完成 Codex 官方登录，生成 `~/.codex/auth.json`。
3. 打开 CodexFree 的配置助手，写入或检查 `~/.codex/config.toml`。
4. 导入账号池授权文件或目录。
5. 查询所有用户用量信息，确认账号可用。
6. 在 Codex App / Codex CLI 中正常使用 Codex。

`config.toml` 中的两行必须位于 TOML 顶层，不能写进 `[profiles.xxx]`。如果存在
`provider` 或 `model_provider` 相关配置，应移除，避免 Codex 走错误的 provider 路径。

Docker 或 LAN 场景只替换 host，路径保持不变：

```toml
chatgpt_base_url = "http://host.docker.internal:33333/backend-api"
openai_base_url = "http://host.docker.internal:33333/backend-api/codex"
```

## 安全边界

- CodexFree 不会自动覆盖、复制或替换你的 `~/.codex/auth.json`。
- 重新登录辅助只会在二次确认后重命名现有 `auth.json`，不会写入替代文件。
- 导入的账号授权文件由 CodexFree 管理，不应提交到 Git。
- 普通日志不会记录 access token、refresh token、cookie 或完整授权文件内容。
- raw capture 可能包含敏感 header，只能在明确调试时启用，并写入仓库外 app data 目录。
- API-key 模式不是当前默认能力；普通账号模式代理会拒绝 API-key 形态请求。

## 本地开发

需要 Bun 和 Electron 依赖：

```bash
bun install
bun run dev
```

常用命令：

```bash
bun run lint
bun run typecheck
bun run test
bun run build
bun run build:unpack
```

单独启动 daemon：

```bash
bun run daemon
```

平台构建：

```bash
bun run build:mac
bun run build:win
bun run build:linux
```

## 项目结构

- `src/main`：Electron main、daemon 管理、proxy、SQLite ledger 和 auth 处理。
- `src/preload`：Electron preload API。
- `src/renderer`：React 19 桌面界面。
- `docs`：当前状态、架构、规格、ADR、安全清单和任务队列。
- `test`：本地抓包样例、授权样例和兼容验证材料。

## 当前限制

- API-key compatibility 仍是未来独立能力，必须先完成抓包和协议确认。
- 生产级 auth 加密或平台凭据存储仍需完善。
- 更多真实世界 sub2api 变体还需要持续补充验证。
- macOS packaging/signing 细节需要按发布方式继续确认。
