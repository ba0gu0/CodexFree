# V1 兼容适配器设计

## 状态

Draft。这是 T8 的实现设计。不要在普通 account-login listener 上实现 `/v1`。

## 目标

为只认识 `/v1` 的工具暴露一个 OpenAI-compatible local API surface，同时每个 ChatGPT upstream generation request 仍使用账号 WebSocket endpoint：

```text
local /v1/* -> CodexFree adapter -> WSS /backend-api/codex/responses
```

adapter 不得把 generation traffic 发送到 upstream HTTP `POST /backend-api/codex/responses`。

## 监听器和信任边界

- 默认关闭。
- 单独配置的 listener，默认候选为 `127.0.0.1:33334`。
- 需要显式 local API key。
- 普通 account proxy 仍然拒绝 API-key 形态的 `/v1/*` 流量。
- 接受的 routes：
  - `GET /v1/models`
  - `POST /v1/responses`
  - 带 WebSocket upgrade 的 `GET /v1/responses`
  - `POST /v1/chat/completions`

## 包证据

`test/raw-captures/**/websocket-*.frames.jsonl` 下的 raw captures 显示当前 Codex WSS protocol：

- Downstream-to-upstream business frame 是 masked text frame，其 JSON 有 `type: "response.create"`。
- Upstream response events 是 Responses API event shape 的 text frames：`response.created`、`response.in_progress`、`response.output_item.added`、`response.content_part.added`、`response.output_text.delta`、`response.output_text.done`、`response.content_part.done`、`response.output_item.done` 和 `response.completed`。
- Tool calls 以 `response.output_item.added` 到达，且 `item.type: "function_call"`，随后是 `response.function_call_arguments.delta` 和 `response.function_call_arguments.done`。
- Rate information 可能以 `codex.rate_limits` 到达。
- Quota exhaustion 以 text event 到达，`type: "error"` 且 `error.type: "usage_limit_reached"`，通常用 `permessage-deflate` 压缩。
- Upstream 可能发送 ping frames；bridge 必须回复 pong 或保留普通 WebSocket behavior。
- WSS request payload 不总是完整 conversation。captures 同时显示：带多 item `input[]` 的近似完整请求，以及带 `previous_response_id` 且只包含当前 `input[]` item 的 incremental requests，例如一条 user message 或一个 `function_call_output`。System instructions、tools 和 `prompt_cache_key` 仍会重复，但 prior assistant/user turns 可以用 `previous_response_id` 表示，而不是作为完整历史重新发送。

captures 中观察到的 upstream handshake 是：

```text
GET /backend-api/codex/responses
Connection: Upgrade
Upgrade: websocket
OpenAI-Beta: responses_websockets=2026-02-06
Sec-WebSocket-Extensions: permessage-deflate
```

## Codex WSS 上下文证据

透明 Codex client 在代理之外是有状态的。它从 `~/.codex/sessions/**/*.jsonl` 重建 WSS context，而不是从 CodexFree proxy state 重建。

2026-05-16 观察到的本地 captures：

- Conversation `019e<thread-redacted>`，capture `<uuid>`：第一个解析出的 `response.create` 没有 `previous_response_id`，`input.length = 8`，包含 7 个 message items 和 1 个 compaction item。这与 session JSONL `compacted.payload.replacement_history` 精确匹配。
- 同一 WSS 后续发送了带 `previous_response_id` 且只包含当前 user/tool-output items 的 incremental `response.create` frames。这些 incremental frames 中的每个 `call_id` 都在 Codex session JSONL 中作为有序 `response_item` records 存在。
- 该 WSS quota 后，Codex 在 replacement account 上打开了新 WSS `<uuid>`。它的第一个 raw downstream text frame 是一个大型 `response.create` packet，并被 raw capture 截断，但它以完整 instructions/tools envelope 开头，并被 upstream 接受。该 WSS 中后续 incremental frames 引用了同一个新 WSS 内创建的 response ids。
- 受控 `codex exec` resume thread `019e<thread-redacted>` 显示了更精确的模式：新 WSS `<uuid>` 先发送一个空 bootstrap `response.create`，`input.length = 0`；upstream 将它完成为 fresh `resp_*`；下一个 `response.create` 使用该 bootstrap id 作为 `previous_response_id`，并携带重建 context：developer/environment messages、prior user prompt、prior assistant output、新 environment message 和 resume prompt。

账号切换结论：

- `previous_response_id` frame 只对当前 WSS 中的 upstream response id chain 有效。不得 replay 到另一个账号。
- CodexFree 当前没有持久化足够的 canonical session history 来合成正确 replacement context。Raw captures 可能被截断，proxy ledger rows 也不包含有序 Codex `response_item` history。
- 如果 non-replayable frame 立即收到 `usage_limit_reached` 且 account pool 有另一个账号，则抑制 quota frame 并关闭 client WSS。Codex 会将其视为 transport failure，打开新 WSS，并自己重建 context。
- 如果 account pool 没有 replacement account，则把最终 `usage_limit_reached` error 转发给 Codex。

Transparent proxy replay 只允许用于没有 `previous_response_id` 且有非空 `input[]` 的 self-contained `response.create` frame，因为该 packet 已经携带下一个 upstream account 所需 context。

## 参考实现说明

`router-for-me/CLIProxyAPI` 已有该功能所需的大部分转换逻辑。把它作为实现参考，不要作为 vendored dependency。

参考文件：

- `test/CLIProxyAPI/internal/translator/codex/openai/responses/codex_openai-responses_request.go` 有 `ConvertOpenAIResponsesRequestToCodex`。
- `test/CLIProxyAPI/internal/translator/codex/openai/responses/codex_openai-responses_response.go` 有 `ConvertCodexResponseToOpenAIResponses` 和 non-stream aggregation。
- `test/CLIProxyAPI/internal/translator/codex/openai/chat-completions/codex_openai_request.go` 有 `ConvertOpenAIRequestToCodex`。
- `test/CLIProxyAPI/internal/translator/codex/openai/chat-completions/codex_openai_response.go` 有 `ConvertCodexResponseToOpenAI` 和 non-stream aggregation。
- `test/CLIProxyAPI/internal/runtime/executor/codex_websockets_executor.go` 有 WSS URL construction、required WSS beta header、upstream dial 和 `buildCodexWebsocketRequestBody`。

可复用行为：

- Responses requests 会把 `input` string 规范化为 user message，强制 streaming，剥离 unsupported fields，把 system role 转为 developer，并规范化 builtin tool aliases。
- Chat Completions requests 会把 `messages[]` 转为 Responses `input[]`，扁平化 function tools，转换 tool outputs，处理 multimodal content，并用 reverse mapping 缩短长 tool names 以便响应。
- Codex Responses streaming output 已经接近 OpenAI Responses SSE，因此 Responses response converter 基本会透传 `data: {...}`。
- Chat Completions output 需要把 Codex `response.*` events 有状态转换为 `chat.completion.chunk` 或最终 `chat.completion` JSON。

CodexFree-specific changes：

- 不使用 CLIProxyAPI account/auth abstractions。使用 CodexFree managed account selection、quota ledger、outbound proxy config 和 raw capture。
- 不为 HTTP/SSE requests 共享 upstream WSS。CLIProxyAPI 可以维护 execution sessions；CodexFree compatibility HTTP/SSE mode 必须是一个 inbound request 对一个 short-lived upstream WSS exchange。
- 保持普通 `/backend-api` transparent proxy body rules 不变。

## 官方 API 形态参考

使用官方 OpenAI API reference 作为本地 compatibility surface 的外部契约：

- Responses create: `https://developers.openai.com/api/reference/resources/responses/methods/create`
- Responses streaming events: `https://developers.openai.com/api/reference/resources/responses`
- Chat Completions: `https://developers.openai.com/api/reference/resources/chat`

关键官方 Responses 字段：

- `input`：可选 string 或 input items 数组。string 等同于 user text input。数组可以包含 message items、tool outputs 和 multimodal content parts。
- `instructions`：插入 context 的 system/developer message。带 `previous_response_id` 时，prior instructions 不会被携带，所以可用时重新发送 current instructions。
- `previous_response_id`：把新 response 连接到 previous response，用于 stateful continuation。
- `conversation`：官方 stateful conversation container。首版不要把它映射为 hidden proxy state。
- `stream`：为 true 时，client 接收 server-sent events。
- `include`：可以请求额外字段，例如 `reasoning.encrypted_content`。

关键官方 Chat Completions 字段：

- `messages`：必需 conversation messages 列表。
- Message roles 包括 `developer`、`system`、`user`、`assistant`、`tool` 和 legacy `function`。
- Assistant messages 可以包含 `tool_calls`。
- Tool messages 携带 `tool_call_id` 来回答 prior assistant tool call。
- Streaming 返回 `chat.completion.chunk` objects，其 `choices[].delta` 携带 incremental text、role 或 tool-call data。

## 转换矩阵

| Chat Completions | Responses / Codex WSS | 规则 |
| --- | --- | --- |
| `model` | `model` | 保留 requested model，然后应用 configured model mapping。 |
| `messages[].role=developer` | `input[].role=developer` | 保留。 |
| `messages[].role=system` | `input[].role=developer` | 为 Codex upstream compatibility 转换。 |
| `messages[].role=user` | `input[] message role=user` | String content 变为 `input_text`；image/file parts 映射到 Responses parts。 |
| assistant text | `input[] message role=assistant` | Text content 变为 `output_text` 以保留 prior assistant turns。 |
| `assistant.tool_calls[]` | top-level `input[] function_call` | 将 id 映射到 `call_id`，function name 映射到 `name`，arguments string 映射到 `arguments`。 |
| `messages[].role=tool` | top-level `input[] function_call_output` | 将 `tool_call_id` 映射到 `call_id`；将 content 映射到 `output`。 |
| `tools[].function` | `tools[]` | 扁平化 `function.name`、`description`、`parameters` 和 `strict`。 |
| `tool_choice` | `tool_choice` | String choices 透传；named function choice 扁平化为 `{type:"function",name}`。 |
| `response_format` | `text.format` | 将 text/json schema settings 映射到 Responses text format。 |
| `stream` | client response mode | Upstream WSS 始终 streaming；client mode 控制 SSE vs aggregate JSON。 |
| `previous_response_id` | `previous_response_id` | 只存在于 Responses requests；提供时保留。 |
| `conversation` | initially unsupported | 不在 proxy memory 中静默模拟 official conversation state。 |

| Codex event | Responses client | Chat Completions client |
| --- | --- | --- |
| `response.created` | SSE passthrough | 缓存 id/model/time；不发 chunk。 |
| `response.output_text.delta` | SSE passthrough | 发出 `delta.content`。 |
| `response.reasoning_summary_text.delta` | SSE passthrough | 发出 `delta.reasoning_content`。 |
| `response.output_item.added` function call | SSE passthrough | 发出 tool-call start chunk。 |
| `response.function_call_arguments.delta` | SSE passthrough | 发出 tool-call argument delta。 |
| `response.completed` | Final event 或 aggregate response object | Final chunk 或 aggregate `chat.completion`。 |
| `error` | Error event/body | streaming 前的 Chat-compatible error；streaming 开始后的 terminal event。 |

## 包格式

### 本地 API 认证

每个 compatibility request 都必须携带 operator-configured local API key：

```http
Authorization: Bearer cf-local-key
```

在选择任何 upstream account 前拒绝缺失或错误 key。

### Models 请求

Client request：

```http
GET /v1/models HTTP/1.1
Host: 127.0.0.1:33334
Authorization: Bearer cf-local-key
```

Upstream account request：

```http
GET /backend-api/codex/models HTTP/1.1
Host: chatgpt.com
Authorization: Bearer <managed-account-token>
ChatGPT-Account-ID: <managed-account-id>
```

Client response：

```json
{
  "object": "list",
  "data": [
    {
      "id": "gpt-5.5",
      "object": "model",
      "created": 0,
      "owned_by": "openai"
    }
  ]
}
```

### Responses HTTP/SSE 请求

Client request：

```http
POST /v1/responses HTTP/1.1
Host: 127.0.0.1:33334
Authorization: Bearer cf-local-key
Content-Type: application/json
Accept: text/event-stream

{
  "model": "gpt-5.5",
  "stream": true,
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [{ "type": "input_text", "text": "hello" }]
    }
  ]
}
```

Upstream WSS handshake：

```http
GET /backend-api/codex/responses HTTP/1.1
Host: chatgpt.com
Connection: Upgrade
Upgrade: websocket
Sec-WebSocket-Version: 13
Sec-WebSocket-Key: <generated>
Sec-WebSocket-Extensions: permessage-deflate
OpenAI-Beta: responses_websockets=2026-02-06
Authorization: Bearer <managed-account-token>
ChatGPT-Account-ID: <managed-account-id>
Originator: codex-tui
```

Upstream WSS text frame：

```json
{
  "type": "response.create",
  "model": "gpt-5.5",
  "stream": true,
  "store": false,
  "parallel_tool_calls": true,
  "include": ["reasoning.encrypted_content"],
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [{ "type": "input_text", "text": "hello" }]
    }
  ]
}
```

client 提供 `previous_response_id` 时的 incremental upstream WSS text frame：

```json
{
  "type": "response.create",
  "model": "gpt-5.5",
  "previous_response_id": "resp_previous",
  "stream": true,
  "store": false,
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [{ "type": "input_text", "text": "next question" }]
    }
  ]
}
```

Client SSE response：

```text
data: {"type":"response.created","response":{"id":"resp_123","object":"response","status":"in_progress","model":"gpt-5.5"}}

data: {"type":"response.output_text.delta","delta":"hello","output_index":0,"content_index":0}

data: {"type":"response.completed","response":{"id":"resp_123","object":"response","status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hello"}]}]}}

data: [DONE]
```

Client non-stream response 返回嵌套的 `response.completed.response` object：

```json
{
  "id": "resp_123",
  "object": "response",
  "status": "completed",
  "model": "gpt-5.5",
  "output": [
    {
      "type": "message",
      "role": "assistant",
      "content": [{ "type": "output_text", "text": "hello" }]
    }
  ]
}
```

### Responses WebSocket 请求

Client WSS handshake：

```http
GET /v1/responses HTTP/1.1
Host: 127.0.0.1:33334
Connection: Upgrade
Upgrade: websocket
Sec-WebSocket-Version: 13
Sec-WebSocket-Key: <client-generated>
Authorization: Bearer cf-local-key
```

Client text frames 使用与 `/v1/responses` HTTP bodies 相同的 JSON shape。adapter 将每个 JSON frame 规范化为 upstream `response.create` frame，并把 upstream response events 作为 client text frames 转发回来。

### Chat Completions 请求

Client request：

```json
{
  "model": "gpt-5.5",
  "stream": true,
  "messages": [
    { "role": "system", "content": "You are concise." },
    { "role": "user", "content": "hello" }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "lookup",
        "description": "Lookup data",
        "parameters": { "type": "object", "properties": {} }
      }
    }
  ]
}
```

Converted upstream WSS text frame：

```json
{
  "type": "response.create",
  "model": "gpt-5.5",
  "stream": true,
  "store": false,
  "parallel_tool_calls": true,
  "reasoning": { "effort": "medium", "summary": "auto" },
  "include": ["reasoning.encrypted_content"],
  "input": [
    {
      "type": "message",
      "role": "developer",
      "content": [{ "type": "input_text", "text": "You are concise." }]
    },
    {
      "type": "message",
      "role": "user",
      "content": [{ "type": "input_text", "text": "hello" }]
    }
  ],
  "tools": [
    {
      "type": "function",
      "name": "lookup",
      "description": "Lookup data",
      "parameters": { "type": "object", "properties": {} }
    }
  ]
}
```

Chat Completions SSE chunk：

```text
data: {"id":"resp_123","object":"chat.completion.chunk","created":1778737937,"model":"gpt-5.5","choices":[{"index":0,"delta":{"role":"assistant","content":"hello"},"finish_reason":null,"native_finish_reason":null}]}

data: {"id":"resp_123","object":"chat.completion.chunk","created":1778737937,"model":"gpt-5.5","choices":[{"index":0,"delta":{},"finish_reason":"stop","native_finish_reason":"stop"}]}

data: [DONE]
```

Chat Completions tool-call chunk：

```text
data: {"id":"resp_123","object":"chat.completion.chunk","created":1778737937,"model":"gpt-5.5","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_123","type":"function","function":{"name":"lookup","arguments":""}}]},"finish_reason":null,"native_finish_reason":null}]}

data: {"id":"resp_123","object":"chat.completion.chunk","created":1778737937,"model":"gpt-5.5","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"q\":\"hello\"}"}}]},"finish_reason":null,"native_finish_reason":null}]}
```

### 终止配额错误

Upstream WSS text frame：

```json
{
  "type": "error",
  "status_code": 429,
  "error": {
    "type": "usage_limit_reached",
    "message": "The usage limit has been reached",
    "plan_type": "free",
    "resets_at": 1779285181
  }
}
```

Client HTTP/SSE handling：

- 如果在发出任何 business event 前另一个账号可用，则用相同 converted request frame 在新的 upstream WSS 上 retry。
- 如果没有账号可用，返回 terminal quota payload，而不是 `{"error":"no_available_account"}`。
- 如果 business output 已经开始，则用 upstream error event 结束当前 client stream，并将账号标记为下一次 request 的 exhausted。

## 路由行为

### GET /v1/models

通过 managed account auth 转发到 account models endpoint：

```text
GET /backend-api/codex/models
```

返回标准 OpenAI list shape：

```json
{"object":"list","data":[{"id":"gpt-5.5","object":"model","created":0,"owned_by":"openai"}]}
```

adapter 可以精确保留 upstream model ids。account proxy 使用的 UI-only model rewriting 不得泄露到该 route，除非配置为显式 compatibility mapping。

### POST /v1/responses

Inbound 可以是 non-streaming 或 SSE-style。Upstream 始终是 WSS。

Connection lifecycle：

- 每个 HTTP/SSE request 都打开一个新的 upstream WSS connection 到 `/backend-api/codex/responses`。
- adapter 在该 upstream WSS 上准确发送一个 `response.create` business message。
- adapter 在 `response.completed`、terminal error、client abort 或 timeout 后关闭 upstream WSS。
- HTTP/SSE mode 不得在不同 client requests 间保持 shared upstream WSS，因为多个外部工具可能共享同一个 local API surface，但携带无关 context。

Request conversion：

- 接受 OpenAI Responses JSON。
- 如果 `input` 是 string，把它转换为 user message：`[{type:"message", role:"user", content:[{type:"input_text", text}]}]`。
- 构建一个新的 WSS JSON object，带 `type: "response.create"`，然后把已接受 request fields 复制或规范化到该 object。
- 强制 `stream: true`、`store: false` 和 `parallel_tool_calls: true`。
- 除非 request 已请求更宽的兼容 `include[]`，否则包含 `reasoning.encrypted_content`。
- 丢弃 upstream-incompatible fields：`max_output_tokens`、`max_completion_tokens`、`temperature`、`top_p`、`truncation`、`context_management` 和 `user`。
- 将 input role `system` 转为 `developer`。
- 规范化 builtin tool aliases，例如 `web_search_preview` 到 `web_search`。
- 保留兼容 generation fields：`model`、`instructions`、`input`、`tools`、`tool_choice`、`reasoning`、`text`、`metadata`、`previous_response_id` 和 `prompt_cache_key`。
- 只从 adapter-owned values 添加 Codex client metadata，不从外部 client-supplied spoofable header 添加。

Response conversion：

- 对 `stream: true`，写入 SSE chunks：`data: <upstream-event-json>\n\n`。
- 在 `response.completed` 或 terminal error 后用 `data: [DONE]\n\n` 结束 SSE。
- 对不存在或 false 的 `stream`，聚合 events 直到 `response.completed`，并把嵌套 `response` object 作为 JSON 返回。
- 没有 replacement account 可用时，将 `usage_limit_reached` 作为与 account proxy 相同的 terminal quota body 转发。

Context strategy：

- 如果 `/v1/responses` request 已包含 `previous_response_id`，保留它并只发送提供的 incremental `input[]`。
- 如果 request 不包含 `previous_response_id`，把提供的 `input` 视为该 request 的完整 client-supplied context。
- 不为 stateless `/v1/responses` requests 发明或持久化 hidden context。adapter 可以仅为了支持 client-provided `previous_response_id` 或 configured session key 而维护 response id mappings。
- 对 SSE clients，inbound HTTP body 是一个 request。除非 client 显式发送 `previous_response_id` 或 accepted session key，否则 adapter 不得继续追加 hidden prior turns。
- 不为 `/v1` compatibility requests 读取 `~/.codex` JSONL。该 JSONL 是 Codex CLI/Desktop private client state，只是 transparent `/backend-api/codex/responses` proxy path 的证据。

### 带 WebSocket upgrade 的 GET /v1/responses

这是为已经使用 WebSocket 的 clients 提供的 protocol bridge。

- upgrade 前认证 local API key。
- 建立到 `/backend-api/codex/responses` 的 upstream WSS。
- 添加 managed account auth 和 required Codex WSS headers。
- 当 frame 是 JSON 时，在应用 `/v1/responses` request normalization 后转发 client text frames。
- 将 upstream text events 作为 WebSocket text frames 转发回来。
- 尽可能保留 account WSS proxy 当前的 quota detection 和 account retry behavior。
- 与 HTTP/SSE mode 不同，该 route 可以在 client connection lifetime 或清晰 scoped session key 内保持 upstream WSS 打开。Incremental `previous_response_id` turns 只在该 scoped connection 或 session 内有效。

### POST /v1/chat/completions

Inbound 是旧 OpenAI Chat Completions。Upstream 仍然是 WSS Responses。

Connection lifecycle：

- 与 `POST /v1/responses` 相同：一个 inbound HTTP/SSE request 映射到一个 short-lived upstream WSS exchange。
- Chat Completions `messages[]` payload 是该 request 的完整 client-supplied context。adapter 不得合并来自其他 requests 的 hidden history。

Request conversion to Codex Responses：

- `model` 映射到 `model`。
- `stream` 只控制 client response mode；upstream WSS 仍然 streaming。
- 构建一个 upstream `response.create` object，不带 hidden history，也不生成 `previous_response_id`。
- `messages[]` 按原始顺序变为 Responses `input[]`。
- `system` role 变成 `developer` message 或 `instructions`；当保留精确 message order 很重要时，优先 developer message。
- `user` content 变成带 `input_text`、`input_image` 或 `input_file` content parts 的 `message` items。
- Assistant text 变成带 `output_text` content parts 的 `message` items。
- Assistant `tool_calls[]` 变成 top-level `function_call` items，包含 `call_id`、`name` 和 `arguments`。
- `tool` messages 变成 top-level `function_call_output` items，带匹配的 `call_id` 和 stringified `output`。
- `image_url` 和 `file` content parts 映射到 `input_image` 和 `input_file`。
- `tools[].function` 扁平化为 Responses `tools[]` entries。
- `tool_choice` string 透传；function choice 扁平化为 `{type:"function", name}`。
- `response_format` 映射到 `text.format`。
- 超过 64 字符的 tool names 必须确定性缩短，并在 response 上 reverse-map。
- Unsupported sampling fields 以与 `/v1/responses` 一致的方式忽略或拒绝；不得盲目转发到 Codex WSS。

Response conversion to Chat Completions：

- `response.created` 缓存 response id、model 和 created timestamp。
- `response.output_text.delta` 发出带 `choices[0].delta.content` 的 `chat.completion.chunk`。
- `response.reasoning_summary_text.delta` 发出 `choices[0].delta.reasoning_content`。
- `function_call` 的 `response.output_item.added` 发出 tool call start chunk，包含 id、function name 和 empty arguments。
- `response.function_call_arguments.delta` 发出 tool call argument deltas。
- `response.function_call_arguments.done` 只有在没有收到 delta 时才发出 full arguments。
- `response.completed` 发出 final chunk，`finish_reason` 为 `stop` 或 `tool_calls`，并在存在时包含 usage。
- Non-streaming mode 将最终 `response.completed.response` 聚合为一个 `chat.completion` JSON response。

## 内部模块

推荐文件：

- `src/main/proxy/v1-compat-service.ts`：单独 listener lifecycle。
- `src/main/proxy/v1-compat-http.ts`：route auth、`/v1/models`、HTTP/SSE entry。
- `src/main/proxy/v1-compat-wss.ts`：HTTP-in/WSS-out bridge 和 WSS passthrough。
- `src/main/proxy/v1-transforms.ts`：pure JSON converters。
- `src/main/proxy/v1-transforms.test.ts`：来自 captures 的 conversion fixtures。
- `src/main/proxy/v1-compat-service.test.ts`：listener、auth、routing、quota。

WSS bridge 应复用现有 account routing、raw frame capture、quota-event parsing 和 outbound proxy support，而不是打开第二套未追踪 socket stack。

## 验收

- `bun run test` 通过。
- focused tests 证明 `/v1/responses` HTTP/SSE 使用 upstream WSS，而不是 upstream HTTP POST。
- focused tests 证明 `/v1/chat/completions` 转换 text、tools、tool outputs、images 和 streaming chunks。
- 捕获的 quota events 产生与 account proxy 相同的 terminal quota behavior。
- 普通 `/backend-api` account-login behavior 和 request-body transparency 不改变。
