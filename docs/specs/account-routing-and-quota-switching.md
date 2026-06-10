# 账号路由与额度切换草案

## 状态

account-login proxy core 已 Ready。包级 WebSocket frame capture 确认了 usage-limit event shape，代理会自动分类解码后的 WebSocket `usage_limit_reached` payload。Account selection、next-boundary replacement、persistent account state、app-managed import、batch usage checks、per-account disable/enable 和 exhaustion reset 均已实现。

## 已观察到的 Codex 0.130 流量

`codex` Docker container 配置为：

```toml
chatgpt_base_url = "http://host.docker.internal:33333/backend-api"
openai_base_url = "http://host.docker.internal:33333/backend-api/codex"
```

观察到的 request surfaces：

- `GET /backend-api/codex/models?client_version=0.130.0`
- `GET /backend-api/codex/responses`，带 WebSocket upgrade headers
- `POST /backend-api/codex/responses`，带 `accept: text/event-stream`

HAR 文件 `test/History-1778577142774.har` 显示直接 ChatGPT upstream surfaces：

- `/backend-api/codex/models`
- `/backend-api/codex/responses`
- `/backend-api/codex/analytics-events/events`
- `/backend-api/connectors/directory/list`
- `/backend-api/wham/usage`
- `/backend-api/wham/apps`
- `/backend-api/plugins/featured`

使用 `openai_base_url` 时，Codex 会在精确配置的 base URL 下发送 model endpoints。已验证两种本地 routing shapes：

- `openai_base_url = "http://host.docker.internal:33333/backend-api/codex"` 在 Docker Codex-to-proxy 侧发出 `/backend-api/codex/models` 和 `/backend-api/codex/responses`。Host-side Codex 只需把 host 替换为 `127.0.0.1` 或本机 IP。
- `/v1/models` 和 `/v1/responses` 保留给未来 API-key compatibility surface。它们不是已文档化的 account-login config。

首选 `/backend-api/codex` 形态，因为本地代理观察到的 account backend path family 与原生 ChatGPT account-mode 流量相同。

有用 headers：

- `authorization`：上游 bearer token；只在核心 account-mode requests 上替换。
- `chatgpt-account-id`：上游 account id；只在核心 account-mode requests 上替换为选中的 auth file。
- `thread_id` / `session_id`：conversation identity。
- `x-client-request-id`：conversation-level request id fallback。
- `x-codex-turn-metadata`：包含 `turn_id` 的 JSON metadata。
- `x-codex-window-id`：conversation window id。

来自 `test/History-1778683339690.har` 和 raw captures 的最新证据显示，session 启动后，Codex 可以建立 WSS `/backend-api/codex/responses` channel，后续 conversation traffic 会承载在该 WSS stream 上。因此，auth switching 必须绑定到 WSS application messages 和 request boundaries，而不能只绑定到一个 HTTP request/response pair。

## 认证替换边界

对于核心 account-mode requests，代理只能替换上游 auth identity：

- `Authorization`
- `Chatgpt-Account-Id`

代理不得修改 body、model、messages、tool payload、compression、streaming headers 或用户可见 conversation fields。

当前核心替换范围是 `/backend-api/codex/models`、`/backend-api/codex/responses`、
`/backend-api/codex/responses/compact` 和 `/backend-api/wham/usage`。analytics、plugins、
apps、connectors 等辅助接口只透明转发，保留 incoming auth headers。

四账号包对比确认，只有 `Authorization` 和 `chatgpt-account-id` 需要账号替换。以下字段由 Codex session/runtime state 拥有，必须从 incoming request 保留：

- `thread_id`
- `session_id`
- `x-client-request-id`
- `x-codex-window-id`
- `x-codex-turn-metadata`
- `sec-websocket-key`

在同一个 Codex conversation 内切换账号时，同一规则仍然成立。`test/raw-captures/same-session-account-switch` 中的 same-session sample 使用一个 thread id 穿过三个 account files：

- thread/session/client request id：`019e<thread-redacted>`
- step 1 account id：`<uuid>`
- step 2 account id：`<uuid>`
- step 3 account id：`<uuid>`

三个 turns 中，`thread_id`、`session_id`、`x-client-request-id`、`x-codex-window-id` 和 `x-codex-turn-metadata` 保持稳定。account id 和 bearer token 改变。`sec-websocket-key` 每次 WSS upgrade 都会改变，必须视为 transport randomness，而不是 account state。

## Auth 文件规范化发现

Codex 0.130.0 期望 `~/.codex/auth.json` 使用原生形态：

```json
{
  "auth_mode": "chatgpt",
  "OPENAI_API_KEY": null,
  "tokens": {
    "id_token": "...",
    "access_token": "...",
    "refresh_token": "...",
    "account_id": "..."
  },
  "last_refresh": "..."
}
```

顶层带 `access_token`、`refresh_token` 和 `account_id` 的 flat templates 必须先规范化为该形态，Codex 才会发出 `authorization` 和 `chatgpt-account-id` headers。

## 运行绑定规则

使用可用的最具体稳定 key：

1. 来自 `x-codex-turn-metadata` 的 `turn_id`
2. `thread_id` 加 `x-client-request-id`
3. `session_id`

turn 开始时，将该 run key 绑定到选中的 auth file。同一 run key 的所有 WebSocket 和 POST retries 必须保持同一个 auth file。

对于 WSS traffic，auth headers 在 upgrade 时已经固定。代理不得在已 upgrade 的 WSS connection 上替换 auth。它只能在稍后的 request 或 WSS upgrade boundary 上改变 auth。

观察到的 `codex exec resume` turns 可以保持 `turn_id` 为空，同时保留相同 thread/session/window ids。因此 runtime binding key 应为：

1. 存在 `thread_id` 时使用 `thread_id`；
2. 没有 `thread_id` 时使用 `session_id`；
3. 使用 `x-client-request-id` 作为 fallback。

`x-codex-turn-metadata.turn_id` 在非空时有用，但不能是唯一 switch boundary，因为当前样例使用空 `turn_id`。

## 配额切换规则

当 in-flight response 被确认为 quota exhaustion 时：

- 将绑定账号标记为未来 eligible turns 不可用；
- 记录 quota event，包含 account id、run key、path、status 和 body fingerprint；
- 如果还没有 upstream business frame 到达 Codex，则隐藏 quota frame 并将账号标记为 exhausted；
- 只有当前 `response.create` 是 self-contained 时，才重连上游并 replay buffered client frames；
- 如果当前 turn 是 incremental 或无法证明 self-contained，则只有 replacement account 存在时才关闭 client WSS，让 Codex 带着自己的完整 context 重新连接；
- 如果当前 turn 无法 replay 且没有 replacement account，则将最终 `usage_limit_reached` frame 转发给 Codex；
- 如果正常 upstream streaming 已开始，不要跨账号 replay 该 active task；让同一 session 中下一个 eligible request 在 stream 结束后选择新的 auth file。

这会保留 conversation safety，同时避免常见 self-contained initial-quota failure 造成 client reconnect loops：失败的 probe 可以在 Codex 看到 business data 前移动到新账号，但 incremental 或 already-streaming task 不由代理伪造。

具体 state machine：

1. 对 eligible account-mode request 或 WSS upgrade，从 `thread_id` / `session_id` / `x-client-request-id` 分类 conversation key。
2. 如果 conversation 有绑定且可用的 account，则复用该 account。
3. 如果不存在 binding，则从 pool 选择下一个可用 account。
4. 构造 upstream request options 前，只替换 `Authorization` 和 `chatgpt-account-id`。
5. 对 WSS，在任何 upstream business frame 转发给 Codex 前进入 probe window。
6. 如果 probe frame 包含 `usage_limit_reached`，标记绑定账号 exhausted，只移除该 conversation binding，并抑制 quota frame。只有当前 `response.create` self-contained 时，才 replay buffered client frames 到 replacement upstream。对不可 replay 的 turns，只有仍有另一个账号时才关闭 client WSS；否则转发最终 quota。
7. 一旦非 quota upstream frame 已被转发，就切换到 normal piping，且不跨账号 replay active stream。
8. 对同一 conversation 的下一个 request 或 WSS upgrade，选择另一个可用 account，并保留 incoming conversation/session headers。

多个并发 conversations 相互独立，因为 binding map 以 conversation id 为 key，而不是一个全局 active session。

## WSS 配额重试规则

对于 WSS request 或已打开的 client WSS，有一个重要优化：当它开始新的 `response.create` turn，并在任何有用 upstream business frame 到达 Codex 前立刻命中 quota。这可能发生在另一个长时间任务耗尽旧账号最后 quota 的同时，一个新任务开始，或现有 client socket 上发送了新 turn。

对于 self-contained turn，代理使用 client-stable upstream retry：

1. 接受 client WSS upgrade，并保持 Codex client socket 打开。
2. 用选中账号连接 upstream。
3. 缓冲 upstream frames，直到第一个解码后的 upstream text frame 判断账号是否可用。
4. 缓冲 probe window 期间发送的 client frames。
5. 如果第一个 upstream business frame 是 `usage_limit_reached`，不要把该 quota frame 转发给 Codex。
6. 标记尝试过的账号 exhausted。
7. 如果最新 `response.create` 是 self-contained，只关闭该 upstream socket。
8. 选择下一个可用账号，并用相同 incoming conversation/session headers 重连 upstream，只替换 auth identity headers。
9. 将 buffered client frames replay 到 replacement upstream socket。
10. 一旦非 quota upstream frame 到达，将 buffered upstream bytes flush 给 Codex client，并切换到 normal bidirectional piping。

self-contained test 是有意保守的。只有当 `response.create` frame 没有 `previous_response_id` 且有非空 `input` array 时，它才能跨账号 replay。如果它引用 previous upstream response，或者代理无法证明当前 frame 携带了所需 prompt context，则代理抑制 quota frame，标记尝试账号 exhausted，并检查 pool。如果存在 replacement account，代理关闭 client WSS；Codex 会观察到 transport failure，打开新 WSS，并发送它认为需要的完整 context。如果没有 replacement account，代理转发最终 quota frame。

该规则有意狭窄。它只适用于任何 upstream business frame 转发给 client 之前。如果 long-running WSS task 已经正常开始 streaming 并稍后失败，代理不得隐藏或跨账号 replay 该 active task。

代理不会持久化完整结构化 conversation transcript。Raw captures 和 probe buffers 可以 replay Codex 在当前 probe window 已发送的 bytes，但它们不足以合成 earlier assistant responses 或重建 incremental `previous_response_id` chain。

HTTP fallback retry 有更严格的安全边界。请求 body 可能在观察到 HTTP quota response 前已经产生 upstream side effects，因此 HTTP retry 只能 best-effort，并且必须保持有界。state-changing `/backend-api/codex/responses` traffic 的首选路径是上面的 WSS initial-frame retry shield，因为 retry decision 前没有 upstream business frame 被转发给 Codex。

如果所有可用账号都在 probe 期间返回 `usage_limit_reached`，或没有 replacement account 可用，代理会转发最终 quota frame，因为 pool 中已经没有可供 reconnect 选择的可用账号。

## SQLite 账号事实

账号事实必须以 SQLite 为准，不以 daemon 内存池为准：

1. app-managed directory 中批量导入的 auth files 会同步到 SQLite `proxy_accounts`。
2. routing decision 前会读取已有 `proxy_accounts.status = exhausted` rows。
3. 每个 selected 或 retried account 都记录在 `proxy_routing_events`。
4. 每个 WSS quota exhaustion 都记录在 `proxy_quota_events`，存在时包含 plan、active-limit、used-percent、reset-at 和 message fields。
5. 清理 proxy records 会把 account exhaustion state 重置回 available。
6. routing 前读取 disabled accounts，并从已有 conversation bindings 中排除。
7. In-memory conversation bindings 只是短生命周期 routing context，会在 24 小时后 prune；
   它们不得作为账号数量、active account、usage、quota 或 disabled/exhausted 状态来源。

代理仍然不会在 SQLite 中持久化 raw auth secrets。

代理不得暴露自定义 account-directory setting。Runtime routing、batch import、export、
enable/disable、usage checks 和 cleanup 都在 app-managed auth-pool directory 和 SQLite
`proxy_accounts` 上操作，所以展示的 account facts 与实际可选账号一致。

## 令牌状态规则

HTTP 和 WSS forwarding paths 不刷新受管理的 ChatGPT tokens。它们分类 account outcomes，例如 quota exhaustion、token expiry 或 account unavailability，然后为之后 app-side maintenance 标记 account state。

Refresh 和 account recovery 属于 main app account-maintenance flow。它们不是 quota events，不会改写已 upgrade 的 WSS connection，也不会在 quota switch state machine 内运行。

## 用量查询规则

`/backend-api/wham/usage` 和相关 usage surfaces 必须返回代理将要使用账号的真实 upstream usage，而不是总是 100% 这类伪造常量。

routing rule：

1. 如果 request 有 conversation key，使用该 conversation 的 bound account。
2. 如果没有 conversation key，使用当前默认可用账号。
3. 如果当前默认账号已标记 exhausted，先选择下一个可用账号再转发 usage。
4. 如果所有账号都 exhausted，返回最后尝试账号的真实 upstream exhausted/100% state，或正常失败。

这让 Codex UI state 与实际接收下一个 request 的账号保持一致，同时避免伪低或伪高 quota values。

前置 quota guard 使用同一真实 usage source。`POST /backend-api/codex/responses` 和 WSS
`response.create` 在转发前检查候选账号；同一账号 1 分钟内复用最近一次查量结果。若
`primary_used_percent >= 95`，该账号按保护线标记为不可继续使用。HTTP 会在同一请求内尝试下一个账号；
WSS 会关闭 client socket，让 Codex 通过端口重连重新发送上下文。若所有账号都进入保护状态，HTTP 和
WSS 都返回本地 `usage_limit_reached` payload。

只有以下条件算作 quota exhaustion 或 quota-protection stop：

- upstream WSS text payload 解码为 JSON；
- payload 有 `type: "error"`；
- payload 有 `error.type: "usage_limit_reached"`；
- optional headers 可包含 `X-Codex-Primary-Used-Percent: "100"` 和 reset timestamps。
- 前置 usage check 得到真实 `primary_used_percent >= 95`，代理本地生成
  `usage_limit_reached` 作为保护线终止信号。

以下条件不算：

- 没有 structured quota payload 的 socket `close`；
- 本地 `EPIPE`；
- network 或 proxy failures 导致的 reconnects；
- Yakit/MITM HTML error pages；
- 非 quota 4xx/5xx transport failures。

## 用量限制样例

使用 Docker Codex CLI `0.130.0` 捕获，两个 base URLs 都指向 CodexFree：

```toml
chatgpt_base_url = "http://host.docker.internal:33333/backend-api"
openai_base_url = "http://host.docker.internal:33333/backend-api/codex"
```

Codex CLI output：

```text
You've hit your usage limit. Upgrade to Plus to continue using Codex
(https://chatgpt.com/explore/plus), or try again at May 20th, 2026 3:15 AM.
```

匹配的 proxy request：

- request id：`<uuid>`
- path：`GET /backend-api/codex/responses`
- session/thread id：`019e<thread-redacted>`
- HTTP response：`101 Switching Protocols`

quota signal 不是非 101 HTTP status。它在 WebSocket upgrade 后到达，所以 quota detection 必须检查 WebSocket messages，或使用包含 WebSocket frames 的 Yakit export。

最新解码样例捕获在 `/tmp/codexfree-ws-loop-usage.jsonl`，raw capture id 为 `<uuid>`。upstream frame 被压缩，但已成功解码为：

- `type: "error"`
- `error.type: "usage_limit_reached"`
- `status_code: 429`
- `headers.X-Codex-Active-Limit: "premium"`
- `headers.X-Codex-Plan-Type: "free"`
- `headers.X-Codex-Primary-Used-Percent: "100"`
- `headers.X-Codex-Primary-Window-Minutes: "10080"`
- `headers.X-Codex-Primary-Reset-At: "1779268417"`

代理应只从该 decoded application payload 标记 quota exhaustion。WebSocket close、`EPIPE`、HTTP 101、Yakit HTML error response 或 network reconnect 本身都不是 quota signal。

## 同一 Session 账号切换样例

捕获命令：

```text
codex exec "Reply exactly: same-session-1"
codex exec resume <same-thread-id> "Reply exactly: same-session-2"
codex exec resume <same-thread-id> "Reply exactly: same-session-3"
```

每个命令使用从 `test/*.auth.json` 复制来的不同 `~/.codex/auth.json`。所有请求都通过 CodexFree，且不使用 Yakit proxy variables。

结果：

- capture root：`test/raw-captures/same-session-account-switch`
- same thread id：`019e<thread-redacted>`
- step 1 returned：`same-session-1`
- step 2 returned：`same-session-2`
- step 3 returned：`same-session-3`

每 step WSS account identity：

| Step | Account file | `chatgpt-account-id` | Auth fingerprint |
|------|--------------|----------------------|------------------|
| 1 | `<email>` | `<uuid>` | `777eaf6ff1ad0ce6` |
| 2 | `<email>` | `<uuid>` | `d06178a409679a05` |
| 3 | `<email>` | `<uuid>` | `376c9f1e3dd4503a` |

每 step session identity：

| Field | Step 1 | Step 2 | Step 3 |
|-------|--------|--------|--------|
| `thread_id` | same | same | same |
| `session_id` | same | same | same |
| `x-client-request-id` | same | same | same |
| `x-codex-window-id` | same | same | same |
| `x-codex-turn-metadata` | same JSON, empty `turn_id` | same JSON, empty `turn_id` | same JSON, empty `turn_id` |
| `sec-websocket-key` | different | different | different |

结论：在同一个 Codex conversation 内，当切换发生在下一个 WSS upgrade boundary 且只替换 auth identity headers 时，账号切换与已观察协议兼容。

## 已验证

- 通过代理的成功 account-mode response 样例。
- 通过代理的四个独立 free-account `hi` 样例。
- 使用三个不同账号的三个 same-session resume 样例。
- WebSocket upgrade 通过代理返回 `101 Switching Protocols`。
- 转发后的 `.http` capture 显示 `Authorization`、`chatgpt-account-id`、`Host: chatgpt.com` 和 `/backend-api/codex/responses`。
- raw capture 现在每个 request 只写四个 `.http` 文件：Codex-to-proxy request、proxy-to-Codex response、proxy-to-ChatGPT request 和 ChatGPT-to-proxy response。
- `test/History-1778652315307.har` 验证了 `/backend-api/codex` base URL shape。`models` 返回 `200`，`responses` 返回 WebSocket `101`，auxiliary interfaces 与 raw `.http` capture 匹配，bodies 未改变，并使用选中的 auth/protocol headers。proxy boundary 两侧唯一有意的 request-header 差异是 `Host` 值。
- WebSocket frame capture 写入 `websocket-upstream-to-codex.frames.jsonl` 和 `websocket-codex-to-upstream.frames.jsonl`；upstream compressed text frames 会用 connection-level `permessage-deflate` state 解码。
- decoded upstream WSS frame observer 解析 `usage_limit_reached` messages，并把匹配的 request ledger row 更新为 `quota_exhausted`，status 为 `429`。
- account router 每次从 SQLite 读取 eligible account facts；内存只保存 conversation key 到当前
  turn/account 的短生命周期 binding，并在 quota exhaustion 后的下一个 WSS request 选择下一个
  available account。

## 仍然需要

- 更多真实世界 sub2api auth-file variants。
- 为 imported auth payloads 提供加密或平台保护存储。
- 为 persistent routing 和 quota-event tables 提供 UI drill-down。
- 如果未来阶段获批，提供单独显式 API-key compatibility listener。
