# 透明代理 MVP 规格

## 状态

Ready。

## 目标

启动一个本地转发服务，使其能在 account-mode 包契约完全最终确定前观察真实 Codex 流量。

## 范围

- 监听可配置的 host 和 port。
- 将 `/backend-api/codex/*` 请求转发到可配置的上游 base URL。
- 将 `/v1/*` 视为未来 API-key 兼容范围，而不是 account-login 代理默认行为。
- 支持出站模式：direct、HTTP proxy、HTTPS proxy、SOCKS4、SOCKS5。
- 保留 request body bytes。
- 保留 streaming responses。
- 在 SQLite 中记录脱敏请求元数据。
- 只有在显式启用 debug capture 时，才写入四个协议形态的 HTTP packet 文件。

## 默认值

- Listen host：`127.0.0.1`。
- Listen port：`33333`。
- Upstream base URL：`https://chatgpt.com/backend-api/codex`。
- Outbound mode：direct。
- Debug raw capture：disabled。
- Raw capture directory：system temp directory 下的 `CodexFree/raw-captures`。

## 账本字段

ledger 记录 request id、method、path、mode、outcome、status code、duration、byte counts、streaming flag、upstream host、outbound mode、auth presence flags，以及敏感 header 值的短 SHA-256 fingerprints。

ledger 不得存储 raw tokens、raw cookies、raw authorization headers 或 raw auth files。

## 调试原始抓包

启用后，raw capture 会为代理两侧分别写入一个 request packet 和一个 response packet：

- `codex-inbound-request.http`：Codex client 发往 CodexFree 的请求。
- `codex-downstream-response.http`：CodexFree 返回给 Codex 的响应。
- `chatgpt-outbound-request.http`：CodexFree 发往 ChatGPT upstream 的请求。
- `chatgpt-upstream-response.http`：ChatGPT upstream 返回给 CodexFree 的响应。

每个文件使用 HTTP protocol shape：start line、headers、blank line，以及可用时的 body sample。raw capture 不再写入额外的 `.json` 或 `.bin` 文件。

这只用于本地协议分析，绝不能写入仓库内。

## 非目标

- 不进行 auth header replacement。
- 不进行 quota switching。
- 不进行 API-key/account-mode enforcement。
- 此里程碑不包含 HAR parser。

## Codex 0.130 观察

使用首选 backend config 时，带 `codex-cli 0.130.0` 的容器验证确认以下 account-mode surfaces 会通过本地代理：

- `GET /backend-api/codex/models?client_version=0.130.0`
- `GET /backend-api/codex/responses`，带 `connection: Upgrade` 和 WebSocket beta headers
- `POST /backend-api/codex/responses`，带 `accept: text/event-stream` fallback

代理将 `chatgpt-account-id` 记录为 account metadata，并将 `thread_id`、`session_id` 或 `x-client-request-id` 记录为 conversation key。

当 `openai_base_url` 设置为 `/backend-api/codex` 时，Codex 会发出与 HAR 中观察到的相同 path family。未来 API-key 兼容模式可以暴露 OpenAI-style `/v1/models` 和 `/v1/responses`，但该模式必须返回 OpenAI-standard response shapes，并与 account-login proxying 保持分离。例如：

- `/v1/models` 获取上游账号 models，并将其转换为标准 OpenAI model-list response shape。
- `/v1/responses` 将 stateless OpenAI-style request 适配到账户 `/backend-api/codex/responses` 流程。
