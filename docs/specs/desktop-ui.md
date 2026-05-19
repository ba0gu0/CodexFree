# 桌面 UI 规格

## 状态

V3 desktop console 已实现。下一个 UI pass 不是再次 shell rewrite；它是 data-display optimization pass，用来让所有可见的 request、usage、overview 和 account metrics 与 `docs/proxy-traffic-analysis.md` 对齐。

## 主布局

使用 operations-console layout，而不是 marketing layout。

使用 Tailwind CSS 和 Coss UI components。Coss UI 遵循 shadcn-style component installation，并使用 Base UI primitives；不要把 Radix UI 作为默认 primitive layer。

## 渲染器架构

Renderer 代码必须遵循以下结构：

- `src/renderer/src/App.tsx` 只负责 shell state、view routing、locale/theme 和 IPC refresh wiring。
- `src/renderer/src/components/` 存放可复用 shell、table、panel、badge、form 和 layout primitives。
- `src/renderer/src/pages/` 每个 primary view 一个 page module。
- `src/renderer/src/data/` 存放 derived models、grouping helpers 和 formatting helpers。
- `src/renderer/src/i18n/` 存放 view-copy selection 和 locale-specific copy。
- `src/renderer/src/assets/` 只存放 global CSS。

renderer 不得把所有 page markup 放在一个大型文件中。View-specific data derivation 必须放在 page component 外部。

## UI 组件策略

- 优先使用 Coss UI components。
- 如果 Coss UI 不提供所需 component 或 behavior，则使用同一 `components/ui/` 层里的 shadcn component。
- component layer source-owned 保留在 repo 中；当 Coss/shadcn equivalents 存在时，不要为 Button、Card、Table、Badge、Input、Switch、Tabs 或类似 controls 发明平行的本地 primitives。
- action buttons 和 status markers 使用 `lucide-react` icons。
- account tokens 和 auth fields 默认保持 masked。
- 对 accounts、requests 和 usage records 使用 dense、scan-friendly tables。
- app shell 中避免 marketing-style cards 和 hero sections。

推荐 primary navigation：

- Dashboard
- Accounts
- Proxy
- Requests
- Usage
- Settings

## 仪表盘

展示：

- proxy running state；
- active account；
- available account count；
- quota-exhausted count；
- recent switching events；
- request volume summary。

Data-display requirements：

- 按 `request_purpose` 展示 recent request volume，不只按 outcome。
- active account 有 email 时优先显示 email，其次 label，最后 masked fallback。
- 当 latest usage query 已持久化这些字段时，展示 account plan、primary 已用百分比和 rate-limit reset time。
- quota、auth、network 和 system log categories 要在视觉上保持区分。
- 将 `/backend-api/wham/remote/*` 标记为 original Codex-account traffic，因为该路径有意绕过 account-pool auth replacement。

## 账号

支持：

- batch import；
- batch export；
- format filter；
- status filter；
- enable 和 disable；
- batch usage query；
- masked secret details；
- per-account request 和 quota history。

Data-display requirements：

- 账号名称优先使用 `proxy_accounts.email`。email 可用时，primary UI 中避免 synthetic `codex:<account-id>` labels。
- 从持久化 account row 展示 plan、primary 已用百分比、secondary 已用百分比、reset time、last usage check 和 last usage error。
- 将 quota exhaustion 视为 account state 加 quota/log history，而不只是最近 request row 的 status。
- auth fingerprints 和 token-bearing material 保持 masked。

## 请求

支持：

- request timeline；
- account used；
- upstream outcome；
- quota detection marker；
- API-key rejection marker；
- 在包证据确认 identifiers 后支持 conversation 或 run grouping。

Data-display requirements：

- 默认列为 time、status、purpose、method/path、account、model、token breakdown、duration 和 bytes。
- Purpose 使用 `request_purpose`；API-key probes 和非 `/backend-api` traffic 与默认 account-login path 分开分组。
- Token display 展示 input、cached input、output、reasoning 和 total tokens。Cached input tokens 不得折叠进 ordinary input。
- 在 row 或 detail panel 中展示 `token_usage_source`，让 `protocol`、`sse` 和 `analytics_event` usage 不会被静默混合。
- Request detail 将 HTTP metadata 与 protocol messages 分开。HTTP metadata 包含 content type、body encoding、request/response model、item counts、JSON-RPC fields、Codex thread/turn identifiers、runtime version、duration、bytes、upstream host 和 error text。
- Protocol message detail 使用 `proxy_protocol_messages` 展示 WSS/request-stream timelines，包括 direction、kind、protocol type、sequence、response ids、model、tool/input counts、per-message tokens、payload size 和 truncation。

## 用量

支持：

- request 和 error statistics；
- traffic statistics；
- token usage statistics；
- client 和 proxy usage records 的 source-aware analysis。

Data-display requirements：

- 按 account、model、thread、turn、source 和 day 聚合。
- 没有 usage 的 requests 参与 request volume、traffic、latency 和 error-rate statistics，但不参与 token totals。
- 默认 token totals 按 source 分离。未来 "merge by turn" view 必须显式，因为 analytics events 和 protocol/SSE usage 可以描述同一个 turn。
- `analytics_event` 是 Codex client view。`protocol` 和 `sse` 是 proxy-observed upstream response views。

## 设置

支持：

- 显示 local proxy endpoint；
- `~/.codex/config.toml` setup helper；
- placeholder `~/.codex/auth.json` generation workflow；
- SQLite data retention settings；
- proxy request body size limit（`maxRequestBodyBytes`）；
- local certificate status 和 setup instructions。

## 组件规则

- 创建本地 primitives 前先使用 Coss UI components。
- 只有当 Coss UI 缺少所需 primitive 或 pattern 时，才使用 shadcn UI。
