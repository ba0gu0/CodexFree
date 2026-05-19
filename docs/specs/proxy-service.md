# 代理服务规格

## 状态

account-login proxy core 已 Ready。API-key 兼容仍然是单独的未来阶段。

## 目标

暴露本地 `/backend-api` 和 `/backend-api/codex` 端点，供 Codex 作为 `chatgpt_base_url` 和 `openai_base_url` 使用，同时代理通过受管理的 auth files 转发 account-login 流量。

## 必需行为

- 默认监听 `http://127.0.0.1:33333/backend-api` 和 `http://127.0.0.1:33333/backend-api/codex`。
- 将 `/v1` 保留给单独的 API-key 兼容模式。
- 只接受 Codex account-mode 流量。
- 在 account-login proxy 上拒绝 API-key mode 流量。
- 不修改 request body bytes。
- 只替换上游认证相关 header。
- 只从 app-managed batch-import directory 加载可路由账号。
- 保留 Codex 预期的 streaming behavior。
- 在 SQLite 中记录 request metadata 和 routing outcome。

## 未来 API-key 兼容模式

API-key 兼容是单独的下一阶段功能，不属于默认 account-login proxy。如果稍后启用，它必须：

- 默认关闭；
- 使用单独 listener port 和 operator 明确提供的本地 API key；
- 显示清楚警告，说明该行为可能被检测到，并可能导致账号限制或封禁；
- 只接受 `/v1/models`、`/v1/responses` 和 legacy `/v1/chat/completions`；
- 使用标准 OpenAI model-list response shape 返回 `/v1/models`，该响应从上游账号 models payload 转换而来；
- 将每个 generation request 适配为指向 `/backend-api/codex/responses` 的标准账号 WebSocket flow；上游 generation traffic 不得使用 HTTP `POST /backend-api/codex/responses`；
- 支持 `/v1/responses` 作为 HTTP/SSE 和 WebSocket client surfaces；
- 在 adapter boundary 转换 legacy Chat Completions requests 和 responses；
- 单个外部请求完成后关闭 upstream WebSocket；
- 保持 account-login proxy request body forwarding rules 不变。

具体 T8 设计记录在 `docs/specs/v1-compatibility-adapter.md`。

## 配额切换

真实 usage-limit 样例显示，主 `responses` 请求仍然返回 HTTP `101 Switching Protocols`；quota error 在 upgrade 后的 WebSocket message stream 中传递。因此，代理必须从 WebSocket frames 分类 quota events，而不能只依赖 HTTP upgrade status。

Raw capture 现在把 upgraded WebSocket traffic 存储到 JSONL frame files。上游 `usage_limit_reached` message 使用 `permessage-deflate` 压缩，所以 capture layer 必须保留 connection-level inflater context，并在 quota classification 前解码 payload。

检测到 quota exhaustion 时：

- 将当前 auth file 标记为未来 eligible requests 不可用；
- 在任何上游 business frame 被转发前，抑制 quota frame 并标记账号 exhausted；
- 只有当当前 `response.create` frame 是 self-contained 时，才重连上游并 replay buffered client frames：没有 `previous_response_id`，且有非空 `input` array；
- 如果当前 turn 依赖之前的上游 response state，且另一个账号可用，则关闭 client WSS，让 Codex 重新连接并重新发送它拥有的完整 context；
- 如果当前 turn 无法 replay 且没有 replacement account 可用，则将最终 `usage_limit_reached` frame 转发给 Codex；
- 正常上游 streaming 开始后，让 active stream 保持原 auth，并只为下一个 eligible request 选择 replacement account；
- 写入包含 account、request 和 detection reason metadata 的 audit event。

当前实现状态：decoded upstream WebSocket frames 会被解析以寻找 `usage_limit_reached`；request ledger 更新为 `quota_exhausted`；bound account 标记为 exhausted；下一个 eligible request 或 WSS upgrade 会选择另一个可用账号。一个狭窄的 initial-WSS retry shield 只有在尚未转发任何 upstream business frame，且当前 `response.create` 可安全 replay 时，才隐藏 quota frame。否则它会抑制 quota 并强制 client reconnect，而不是伪造缺失 context，除非 pool 没有 replacement account，在这种情况下它会转发 terminal quota。

## 需要的包证据

account-login proxy core 在 capture 识别出以下内容后达到 Ready：

- 普通 request 和 response shape；
- streaming request 和 response details；
- quota-exhaustion status、body 和 headers；
- usage-limit event 的 WebSocket frame payload；
- account-mode 与 API-key mode signals；
- 识别 conversation、run 或 next user-message boundaries 的字段。

剩余未来工作只限于 storage hardening、更丰富的 operator diagnostics，以及单独的默认关闭 API-key compatibility mode。
