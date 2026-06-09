# CodexFree

[English](./README_EN.md)

当前仓库适合作为开源 alpha 源码发布。macOS 安装包按成本约束默认不签名、不公证；
如果你直接安装 release 产物，可能需要在系统安全设置中手动允许打开。更敏感的环境建议
从源码自行构建并核对依赖。

CodexFree 是一个 Electron 桌面工具，用于管理大量 Codex JSON 授权文件，并在本机运行
Codex 账号模式代理。它可以把多个 free、plus、pro 账号授权导入账号池，在使用 Codex
App 或 Codex CLI 时自动轮换账号额度，不需要频繁重启 Codex App，也不需要部署 VPS 服务器。

CodexFree 主要面向已经拥有 CPA、sub2api、Codex 官方登录后导出的账号授权配置文件的用户。
它不是 API key 切换器，也不适用于各种 OpenAI API 中转站。API key、base URL 中转站或普通
API 模式请使用 `cc switch` 等配置切换工具；CodexFree 走的是 ChatGPT/Codex 账号登录代理路径。
使用 CodexFree 账号模式代理时可以使用 Codex 的 fast 模式，普通 API key 模式无法使用这条能力。

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

代理模式下，`config.toml` 顶层不应存在 `model_provider`。如果你之前使用过
`model_provider = "codex"` 和 `[model_providers.codex]` 这类 API 模式配置，CodexFree
只会删除顶层 `model_provider`，不会修改 `[model_providers.<name>]` 配置块。这样能让代理模式
回到 Codex 默认账号路径；需要切回 API 模式时，从 CodexFree 创建的配置文件备份恢复。
如果你还使用 `cc switch` 或其他会修改 Codex 配置的工具，建议不要和 CodexFree 同时运行
配置写入，也不要在两类工具之间频繁来回切换同一个 `config.toml`，否则容易出现配置文件冲突。

请求进入本机代理后，CodexFree 不修改 request body，只在转发上游时替换认证相关 header，
让请求实际使用账号池中的账号额度。

本机 `~/.codex/auth.json` 仍然需要存在。它的作用是让 Codex App / Codex CLI 正常启动并
进入 ChatGPT 账号模式。建议先登录一个自己的 ChatGPT/Codex 账号，free 账号也可以。这样配置后，
Codex App 的远程控制仍然可以正常使用：手机版 ChatGPT App 登录相同账号，点击 Codex 连接即可。
CodexFree 不影响远程控制的连接和管理。

如果没有自己的账号，也可以先导入账号池，再在引导中显式选择一个已导入账号写入
`~/.codex/auth.json`。注意：使用账号池账号作为本地登录账号时，不要打开 Codex 远程控制功能，
除非该账号确实属于你自己，避免会话被账号所有者看到或控制。写入前 CodexFree 会备份现有
`auth.json`，并把这个账号排在代理轮换后面，优先消耗其他可用账号的额度。

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
2. 先导入账号池授权文件或目录。
3. 查询所有用户用量信息，确认账号可用。
4. 检查 `~/.codex/auth.json`；如果没有自有登录账号，可以在引导中从已导入账号选择一个写入。
5. 打开 CodexFree 的配置助手，写入或检查 `~/.codex/config.toml`。
6. 在 Codex App / Codex CLI 中正常使用 Codex。

`config.toml` 中的两行必须位于 TOML 顶层，不能写进 `[profiles.xxx]`。代理模式只需要移除
顶层 `model_provider`；不要删除 `[model_providers.<name>]`，也不要额外写入
`model_provider = "openai"`。写入配置前会把当前 `config.toml` 备份为
`config-codexfree-YYYYMMDD-HHMMSS.toml`；如果需要切回 API 模式，可以在 Proxy 页面从
备份列表选择要恢复的配置文件，并按当前配置同步历史会话 provider。
`cc switch` 或其他配置切换工具可以继续使用，但不要与 CodexFree 同时改同一个
`config.toml`；切换前先关闭另一方的自动配置写入或监控，避免互相覆盖。

Docker 或 LAN 场景只替换 host，路径保持不变：

```toml
chatgpt_base_url = "http://host.docker.internal:33333/backend-api"
openai_base_url = "http://host.docker.internal:33333/backend-api/codex"
```

## 安全边界

- 只导入和使用你自己拥有或明确获授权使用的账号授权文件。
- CodexFree 不是 OpenAI、ChatGPT 或 Codex 官方产品，也不隶属于这些产品。
- CodexFree 不会自动覆盖、复制或替换你的 `~/.codex/auth.json`。
- 只有用户在引导中显式选择已导入账号并二次确认时，CodexFree 才会写入 `auth.json`；
  写入前会备份现有文件。
- CodexFree 创建的配置备份使用专用命名：`config-codexfree-YYYYMMDD-HHMMSS.toml` 和
  `auth-codexfree-YYYYMMDD-HHMMSS.json`；恢复时只从这些备份中选择，不读取任意文件，
  并且恢复动作不会再额外备份当前文件。
- 重新登录辅助只会在二次确认后重命名现有 `auth.json`，不会写入替代文件。
- 导入的账号授权文件由 CodexFree 管理，不应提交到 Git。
- 普通日志不会记录 access token、refresh token、cookie 或完整授权文件内容。
- raw capture 可能包含敏感 header，只能在明确调试时启用，并写入仓库外 app data 目录。
- API-key 模式不是当前默认能力；普通账号模式代理会拒绝 API-key 形态请求。
- 报告安全问题时不要附带真实 auth 文件、token、cookie、raw capture 或本地 SQLite 数据库；
  详细规则见 [SECURITY.md](./SECURITY.md)。

## 开源与发布

- 许可证：MIT，见 [LICENSE](./LICENSE)。
- 安全报告规则：见 [SECURITY.md](./SECURITY.md)。
- macOS release 默认不签名、不公证。这是当前发布策略，不是阻塞项；用户需要自行判断安装风险，
  并按需在本机允许打开或自行签名。
- macOS 也使用 Velopack 支持检查、下载和应用更新；GitHub Release 同时保留完整安装包供
  手动下载安装。Windows/Linux 同样使用 Velopack 更新。
- 仓库忽略本地 `test` 参考材料、抓包、数据库和构建产物。不要手动把本地目录压缩上传替代
  GitHub 源码包。

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
- `test`：本地抓包样例、授权样例和兼容验证材料，默认不进入 Git 发布。

## 当前限制

- API-key compatibility 仍是未来独立能力，必须先完成抓包和协议确认。
- 生产级 auth 加密或平台凭据存储仍需完善。
- 更多真实世界 sub2api 变体还需要持续补充验证。
- macOS 安装包当前不签名、不公证；这是为了控制发布成本而保留的 alpha 限制。
