# 架构

## 系统形态

CodexFree 有三个主要 runtime surface，外加一个未来兼容 surface：

1. Electron desktop app，用于账号管理、用量检查、导入/导出和操作控制。
2. 独立本地 proxy daemon，拥有 forwarding socket 和账号 routing state。
3. 本地 admin/control surface，app 用它来启动、停止、检查和配置 daemon。
4. 未来在单独端口上的显式 API-key compatibility service。该模式默认关闭，并且必须提示 operator：把外部 API-key 流量适配到账号 WebSocket 流量可能增加账号检测或封禁风险。

## 已确认技术栈

实现技术栈为：

- Bun 用于 runtime scripts 和 package execution。
- Strict TypeScript。
- Electron 和 Vite 用于 desktop application shell。
- React 19 用于 renderer。
- Tailwind CSS 和 Coss UI 用于 component system。
- 通过 Coss UI 使用 Base UI 作为 primitive layer，而不是 Radix UI。
- `lucide-react` 用于 icons。
- SQLite with Drizzle ORM 用于本地持久化。
- Vitest 用于 unit 和 integration tests。
- 需要 UI 和 Electron 验证时，稍后使用 Playwright。

## 代理路径

```text
Codex CLI
  -> http://127.0.0.1:33333/backend-api/codex
  -> request classifier
  -> account-session router
  -> upstream Codex/OpenAI account endpoint
```

代理对 request bodies 是透明的。唯一允许的 mutation 是 authentication-related upstream headers。

默认 Codex config 在 `/backend-api` 下使用 `chatgpt_base_url`，在 `/backend-api/codex` 下使用 `openai_base_url`。本地 `/v1` path 属于未来 API-key compatibility surface，不是 account-login default。

account-login proxy 和未来 API-key compatibility service 是独立 trust boundaries。API-key 形态请求在普通 Codex account proxy 上仍保持拒绝。如果实现 compatibility service，它必须监听自己的 configured port，要求显式 local API key，并把每个已接受的 OpenAI-compatible request 转换为针对 `/backend-api/codex/responses` 的短生命周期 account WebSocket exchange。这适用于 `/v1/responses` HTTP、SSE 和 WebSocket clients，也适用于经过 request conversion 后的 legacy `/v1/chat/completions`。发往 ChatGPT 的上游 generation calls 必须使用 WSS，而不是 HTTP `POST /backend-api/codex/responses`。

## 账号会话路由

router 拥有：

- 从 app-managed import directory 选择 active auth file；
- 每账号 health 和 quota status；
- in-progress run binding；
- next-message auth switching；
- quota detection 和 account transitions 的 audit events。

关键规则是：quota exhaustion 不得强行改写 in-flight request stream 的 auth。只有识别出当前 run boundary 后，切换才应用到下一个 eligible request。

runtime account source 有意不允许配置为任意路径。operator 将文件批量导入 app-managed auth pool，然后启用或禁用该 pool。这使 UI database、account status、usage checks 和 proxy routing 对齐到同一组文件。

Codex CLI 0.130 流量通过 request headers 暴露该边界：

- `thread_id` / `session_id` 标识 conversation。
- `x-codex-turn-metadata` 包含 active user turn 的 `turn_id`。
- `x-codex-window-id` 仍绑定 active conversation window。
- `chatgpt-account-id` 标识 Codex 当前使用的 upstream account。

当存在 active `turn_id` 时，auth switching 应把账号绑定到该 turn。如果该 turn 期间检测到 quota exhaustion，该账号会被标记为未来 eligible turns 不可用，但当前 turn 不会用不同 auth file replay。同一 conversation 中之后的 user message 可以切换，因为它会有新的 `turn_id`。

## 存储

SQLite 是以下内容的本地事实来源：

- imported auth file metadata；
- normalized account identifiers；
- request records；
- usage counters；
- quota and rejection events；
- import/export history；
- batch usage query results。

实现开始时，raw secrets 应加密或通过 platform credential store 存储。如果早期开发使用 plain local storage，必须记录为临时方案，并排除在 commits 之外。

project manifest 创建后，Drizzle ORM 应拥有 schema definitions 和 migrations。

## 运行时拆分

已接受方向记录在 `docs/specs/proxy-daemon-and-app-split.md`。

当前实现仍有 Electron main-process wiring，但下一个架构步骤是提取 daemon boundary：

```text
Codex CLI -> codexfree-proxy daemon -> ChatGPT account backend
CodexFree App -> local admin API / IPC -> codexfree-proxy daemon
```

daemon 和 app 必须共享：

- SQLite ledger 和 account state；
- app-managed auth-pool directory；
- proxy config file；
- raw capture directory policy。

daemon 拥有 forwarding、WSS parsing、quota decisions 和 active-account selection。app 拥有 account import/export、batch usage checks、settings 和 visual inspection。该拆分允许 proxy-core debugging 和 App UI work 并行推进，而不修改同一个 hot path。

## UI 区域

推荐主导航：

- Dashboard：account pool health、active account、recent quota events。
- Accounts：import、validate、tag、enable 或 disable、batch actions。
- Proxy：local endpoint state、certificate status、request mode rejection counts。
- Requests：可搜索 request ledger 和 per-conversation activity。
- Usage：account-level usage statistics 和 batch quota query。
- Settings：Codex config helper、auth placeholder generation、data retention。

## 渲染器技术栈

renderer 是 Electron/Vite 内的 React 19 application，并且在计划中的 UI refactor 后必须遵循 source-owned design system layout：

- `src/renderer/src/components/ui/` 包含 Coss/shadcn component source；
- `src/renderer/src/components/` 包含 app-specific composition；
- `src/renderer/src/pages/` 每个 view 一个 page module；
- `src/renderer/src/data/` 包含 derived models 和 pure formatting helpers；
- `src/renderer/src/i18n/` 包含 copy tables 和 locale routing；
- `src/renderer/src/assets/main.css` 只包含 global tokens、layout primitives 和 page-scale utilities。

当前实现说明：renderer 已经进入 V3 desktop-console shell，Dashboard、Accounts、Proxy、
Requests 和 Usage 已实现并连接。上面的目录结构仍是后续维护 renderer 时的目标边界。

组件策略：

- buttons、cards、tables、toggles、inputs、tabs 和 layout primitives 优先使用 Coss UI；
- 只有当 Coss UI 不提供所需 component 或 interaction pattern 时，才使用 shadcn/ui；
- 当已有 Coss 或 shadcn source component 可以复制到 `components/ui/` 时，不要创建平行 custom primitive layer。

shadcn CLI 不会自动检测 electron-vite，因此本项目保留手动 `components.json` 配置。使用 `bunx shadcn@latest` 命令添加 components，并按最终项目结构和 Coss-first policy 调整。

## 兼容输入

实现标记为 Ready 前，以下内容必须来自 packet captures：

- account-mode request headers；
- streaming response shape；
- quota-exhaustion response body 和 status；
- conversation 或 run identifiers；
- API-key mode request signal；
- Codex account login 使用的 upstream endpoint paths。
