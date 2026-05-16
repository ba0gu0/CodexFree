# V1 Compatibility Adapter Design

## Status

Draft. This is the implementation design for T8. Do not implement `/v1` on the
normal account-login listener.

## Goal

Expose an OpenAI-compatible local API surface for tools that only know `/v1`,
while every ChatGPT upstream generation request still uses the account WebSocket
endpoint:

```text
local /v1/* -> CodexFree adapter -> WSS /backend-api/codex/responses
```

The adapter must not send generation traffic to upstream HTTP
`POST /backend-api/codex/responses`.
## Listener and Trust Boundary

- Disabled by default.
- Separate configured listener, default candidate `127.0.0.1:33334`.
- Requires an explicit local API key.
- The normal account proxy still rejects API-key shaped `/v1/*` traffic.
- Accepted routes:
  - `GET /v1/models`
  - `POST /v1/responses`
  - `GET /v1/responses` with WebSocket upgrade
  - `POST /v1/chat/completions`
## Packet Evidence

The raw captures under `test/raw-captures/**/websocket-*.frames.jsonl` show the
current Codex WSS protocol:

- Downstream-to-upstream business frame is a masked text frame whose JSON has
  `type: "response.create"`.
- Upstream response events are text frames in Responses API event shape:
  `response.created`, `response.in_progress`, `response.output_item.added`,
  `response.content_part.added`, `response.output_text.delta`,
  `response.output_text.done`, `response.content_part.done`,
  `response.output_item.done`, and `response.completed`.
- Tool calls arrive as `response.output_item.added` with
  `item.type: "function_call"`, followed by
  `response.function_call_arguments.delta` and
  `response.function_call_arguments.done`.
- Rate information can arrive as `codex.rate_limits`.
- Quota exhaustion arrives as a text event with `type: "error"` and
  `error.type: "usage_limit_reached"`, often compressed with
  `permessage-deflate`.
- Upstream may send ping frames; the bridge must answer pong or preserve normal
  WebSocket behavior.
- WSS request payload is not always the full conversation. Captures show both:
  full-ish requests with multi-item `input[]`, and incremental requests with
  `previous_response_id` plus only the current `input[]` item, such as one user
  message or one `function_call_output`. System instructions, tools, and
  `prompt_cache_key` are still repeated, but prior assistant/user turns can be
  represented by `previous_response_id` rather than resent as full history.

The upstream handshake observed in captures is:

```text
GET /backend-api/codex/responses
Connection: Upgrade
Upgrade: websocket
OpenAI-Beta: responses_websockets=2026-02-06
Sec-WebSocket-Extensions: permessage-deflate
```

## Codex WSS Context Evidence

The transparent Codex client is stateful outside the proxy. It rebuilds WSS
context from `~/.codex/sessions/**/*.jsonl`, not from CodexFree proxy state.

Observed local captures on 2026-05-16:

- Conversation `019e<thread-redacted>`, capture
  `<uuid>`: the first parsed
  `response.create` had no `previous_response_id`, `input.length = 8`, and
  contained 7 message items plus 1 compaction item. That exactly matched the
  session JSONL `compacted.payload.replacement_history`.
- The same WSS later sent incremental `response.create` frames with
  `previous_response_id` and only current user/tool-output items. Every
  `call_id` in those incremental frames was present in the Codex session JSONL
  as ordered `response_item` records.
- After quota on that WSS, Codex opened a new WSS
  `<uuid>` on a replacement account. Its first
  raw downstream text frame was a large `response.create` packet and was
  truncated by raw capture, but it started with the full instructions/tools
  envelope and was accepted by upstream. Later incremental frames in that WSS
  referenced response ids created inside that same new WSS.
- A controlled `codex exec` resume thread
  `019e<thread-redacted>` showed a more precise pattern: new
  WSS `<uuid>` first sent an empty bootstrap
  `response.create` with `input.length = 0`; upstream completed it as a fresh
  `resp_*`; the next `response.create` used that bootstrap id as
  `previous_response_id` and carried the reconstructed context:
  developer/environment messages, the prior user prompt, prior assistant output,
  the new environment message, and the resume prompt.

Conclusion for account switching:

- A `previous_response_id` frame is valid only against the upstream response id
  chain in the current WSS. It must not be replayed to another account.
- CodexFree currently does not persist enough canonical session history to
  synthesize a correct replacement context. Raw captures may be truncated, and
  proxy ledger rows do not contain ordered Codex `response_item` history.
- If a non-replayable frame immediately receives `usage_limit_reached` and the
  account pool has another account, suppress the quota frame and close the
  client WSS. Codex will treat it as a transport failure, open a new WSS, and
  rebuild the context itself.
- If the account pool has no replacement account, forward the final
  `usage_limit_reached` error to Codex.

Transparent proxy replay is allowed only for a self-contained
`response.create` frame with no `previous_response_id` and a non-empty
`input[]`, because that packet already carries the context needed by the next
upstream account.

## Reference Implementation Notes

`router-for-me/CLIProxyAPI` already has most conversion logic needed for this
feature. Treat it as implementation reference, not as a vendored dependency.

Reference files:

- `test/CLIProxyAPI/internal/translator/codex/openai/responses/codex_openai-responses_request.go`
  has `ConvertOpenAIResponsesRequestToCodex`.
- `test/CLIProxyAPI/internal/translator/codex/openai/responses/codex_openai-responses_response.go`
  has `ConvertCodexResponseToOpenAIResponses` and non-stream aggregation.
- `test/CLIProxyAPI/internal/translator/codex/openai/chat-completions/codex_openai_request.go`
  has `ConvertOpenAIRequestToCodex`.
- `test/CLIProxyAPI/internal/translator/codex/openai/chat-completions/codex_openai_response.go`
  has `ConvertCodexResponseToOpenAI` and non-stream aggregation.
- `test/CLIProxyAPI/internal/runtime/executor/codex_websockets_executor.go`
  has WSS URL construction, required WSS beta header, upstream dial, and
  `buildCodexWebsocketRequestBody`.

Reusable behavior:

- Responses requests normalize `input` string to a user message, force
  streaming, strip unsupported fields, convert system role to developer, and
  normalize builtin tool aliases.
- Chat Completions requests convert `messages[]` to Responses `input[]`, flatten
  function tools, convert tool outputs, handle multimodal content, and shorten
  long tool names with reverse mapping for responses.
- Codex Responses streaming output is already close to OpenAI Responses SSE, so
  the Responses response converter mostly passes `data: {...}` through.
- Chat Completions output needs stateful event conversion from Codex
  `response.*` events to `chat.completion.chunk` or final `chat.completion`
  JSON.

CodexFree-specific changes:

- Do not use CLIProxyAPI account/auth abstractions. Use CodexFree managed
  account selection, quota ledger, outbound proxy config, and raw capture.
- Do not share upstream WSS for HTTP/SSE requests. CLIProxyAPI can maintain
  execution sessions; CodexFree compatibility HTTP/SSE mode must be one inbound
  request to one short-lived upstream WSS exchange.
- Keep the normal `/backend-api` transparent proxy body rules unchanged.

## Official API Shape References

Use the official OpenAI API reference as the external contract for the local
compatibility surface:

- Responses create:
  `https://developers.openai.com/api/reference/resources/responses/methods/create`
- Responses streaming events:
  `https://developers.openai.com/api/reference/resources/responses`
- Chat Completions:
  `https://developers.openai.com/api/reference/resources/chat`

Key official Responses fields:

- `input`: optional string or array of input items. A string is equivalent to a
  user text input. An array can include message items, tool outputs, and
  multimodal content parts.
- `instructions`: system/developer message inserted into context. With
  `previous_response_id`, prior instructions are not carried over, so resend
  current instructions when available.
- `previous_response_id`: links a new response to a previous response for
  stateful continuation.
- `conversation`: official stateful conversation container. Do not map this to
  hidden proxy state in the first implementation.
- `stream`: when true, the client receives server-sent events.
- `include`: can request extra fields such as `reasoning.encrypted_content`.

Key official Chat Completions fields:

- `messages`: required list of conversation messages.
- Message roles include `developer`, `system`, `user`, `assistant`, `tool`, and
  legacy `function`.
- Assistant messages may include `tool_calls`.
- Tool messages carry `tool_call_id` to answer a prior assistant tool call.
- Streaming returns `chat.completion.chunk` objects whose `choices[].delta`
  carries incremental text, role, or tool-call data.

## Conversion Matrix

| Chat Completions | Responses / Codex WSS | Rule |
| --- | --- | --- |
| `model` | `model` | Preserve requested model, then apply configured model mapping. |
| `messages[].role=developer` | `input[].role=developer` | Preserve. |
| `messages[].role=system` | `input[].role=developer` | Convert for Codex upstream compatibility. |
| `messages[].role=user` | `input[] message role=user` | String content becomes `input_text`; image/file parts map to Responses parts. |
| assistant text | `input[] message role=assistant` | Text content becomes `output_text` to preserve prior assistant turns. |
| `assistant.tool_calls[]` | top-level `input[] function_call` | Map id to `call_id`, function name to `name`, arguments string to `arguments`. |
| `messages[].role=tool` | top-level `input[] function_call_output` | Map `tool_call_id` to `call_id`; map content to `output`. |
| `tools[].function` | `tools[]` | Flatten `function.name`, `description`, `parameters`, and `strict`. |
| `tool_choice` | `tool_choice` | String choices pass through; named function choice flattens to `{type:"function",name}`. |
| `response_format` | `text.format` | Map text/json schema settings to Responses text format. |
| `stream` | client response mode | Upstream WSS always streams; client mode controls SSE vs aggregate JSON. |
| `previous_response_id` | `previous_response_id` | Only present on Responses requests; preserve when supplied. |
| `conversation` | unsupported initially | Do not silently emulate official conversation state in proxy memory. |

| Codex event | Responses client | Chat Completions client |
| --- | --- | --- |
| `response.created` | SSE passthrough | Cache id/model/time; emit no chunk. |
| `response.output_text.delta` | SSE passthrough | Emit `delta.content`. |
| `response.reasoning_summary_text.delta` | SSE passthrough | Emit `delta.reasoning_content`. |
| `response.output_item.added` function call | SSE passthrough | Emit tool-call start chunk. |
| `response.function_call_arguments.delta` | SSE passthrough | Emit tool-call argument delta. |
| `response.completed` | Final event or aggregate response object | Final chunk or aggregate `chat.completion`. |
| `error` | Error event/body | Chat-compatible error before streaming; terminal event after streaming starts. |
## Packet Formats

### Local API Authentication

Every compatibility request must carry the operator-configured local API key:

```http
Authorization: Bearer cf-local-key
```

Reject missing or wrong keys before selecting any upstream account.

### Models Request

Client request:

```http
GET /v1/models HTTP/1.1
Host: 127.0.0.1:33334
Authorization: Bearer cf-local-key
```

Upstream account request:

```http
GET /backend-api/codex/models HTTP/1.1
Host: chatgpt.com
Authorization: Bearer <managed-account-token>
ChatGPT-Account-ID: <managed-account-id>
```

Client response:

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

### Responses HTTP/SSE Request

Client request:

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

Upstream WSS handshake:

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

Upstream WSS text frame:

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

Incremental upstream WSS text frame when the client provides
`previous_response_id`:

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

Client SSE response:

```text
data: {"type":"response.created","response":{"id":"resp_123","object":"response","status":"in_progress","model":"gpt-5.5"}}

data: {"type":"response.output_text.delta","delta":"hello","output_index":0,"content_index":0}

data: {"type":"response.completed","response":{"id":"resp_123","object":"response","status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hello"}]}]}}

data: [DONE]
```

Client non-stream response returns the nested `response.completed.response`
object:

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

### Responses WebSocket Request

Client WSS handshake:

```http
GET /v1/responses HTTP/1.1
Host: 127.0.0.1:33334
Connection: Upgrade
Upgrade: websocket
Sec-WebSocket-Version: 13
Sec-WebSocket-Key: <client-generated>
Authorization: Bearer cf-local-key
```

Client text frames use the same JSON shape as `/v1/responses` HTTP bodies. The
adapter normalizes each JSON frame to an upstream `response.create` frame and
forwards upstream response events back as client text frames.

### Chat Completions Request

Client request:

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

Converted upstream WSS text frame:

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

Chat Completions SSE chunk:

```text
data: {"id":"resp_123","object":"chat.completion.chunk","created":1778737937,"model":"gpt-5.5","choices":[{"index":0,"delta":{"role":"assistant","content":"hello"},"finish_reason":null,"native_finish_reason":null}]}

data: {"id":"resp_123","object":"chat.completion.chunk","created":1778737937,"model":"gpt-5.5","choices":[{"index":0,"delta":{},"finish_reason":"stop","native_finish_reason":"stop"}]}

data: [DONE]
```

Chat Completions tool-call chunk:

```text
data: {"id":"resp_123","object":"chat.completion.chunk","created":1778737937,"model":"gpt-5.5","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_123","type":"function","function":{"name":"lookup","arguments":""}}]},"finish_reason":null,"native_finish_reason":null}]}

data: {"id":"resp_123","object":"chat.completion.chunk","created":1778737937,"model":"gpt-5.5","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"q\":\"hello\"}"}}]},"finish_reason":null,"native_finish_reason":null}]}
```

### Terminal Quota Error

Upstream WSS text frame:

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

Client HTTP/SSE handling:

- If another account is available before any business event is emitted, retry on
  a new upstream WSS with the same converted request frame.
- If no account is available, return the terminal quota payload instead of
  `{"error":"no_available_account"}`.
- If business output has already started, finish the current client stream with
  the upstream error event and mark the account exhausted for the next request.

## Route Behavior

### GET /v1/models

Forward to the account models endpoint through managed account auth:

```text
GET /backend-api/codex/models
```

Return standard OpenAI list shape:

```json
{"object":"list","data":[{"id":"gpt-5.5","object":"model","created":0,"owned_by":"openai"}]}
```

The adapter may preserve the upstream model ids exactly. UI-only model rewriting
used by the account proxy must not leak into this route unless configured as an
explicit compatibility mapping.

### POST /v1/responses

Inbound can be non-streaming or SSE-style. Upstream is always WSS.

Connection lifecycle:

- Each HTTP/SSE request opens a new upstream WSS connection to
  `/backend-api/codex/responses`.
- The adapter sends exactly one `response.create` business message on that
  upstream WSS.
- The adapter closes the upstream WSS after `response.completed`, a terminal
  error, client abort, or timeout.
- HTTP/SSE mode must not keep a shared upstream WSS across different client
  requests because multiple external tools can share the same local API surface
  while carrying unrelated context.

Request conversion:

- Accept OpenAI Responses JSON.
- If `input` is a string, convert it to a user message:
  `[{type:"message", role:"user", content:[{type:"input_text", text}]}]`.
- Build a new WSS JSON object with `type: "response.create"`, then copy or
  normalize the accepted request fields into that object.
- Force `stream: true`, `store: false`, and `parallel_tool_calls: true`.
- Include `reasoning.encrypted_content` unless the request already asks for a
  wider compatible `include[]`.
- Drop upstream-incompatible fields: `max_output_tokens`,
  `max_completion_tokens`, `temperature`, `top_p`, `truncation`,
  `context_management`, and `user`.
- Convert input role `system` to `developer`.
- Normalize builtin tool aliases such as `web_search_preview` to `web_search`.
- Preserve compatible generation fields: `model`, `instructions`, `input`,
  `tools`, `tool_choice`, `reasoning`, `text`, `metadata`,
  `previous_response_id`, and `prompt_cache_key`.
- Add Codex client metadata only from adapter-owned values, not from an external
  client-supplied spoofable header.

Response conversion:

- For `stream: true`, write SSE chunks as `data: <upstream-event-json>\n\n`.
- End SSE with `data: [DONE]\n\n` after `response.completed` or terminal error.
- For `stream` absent or false, aggregate events until `response.completed` and
  return the nested `response` object as JSON.
- Forward `usage_limit_reached` as the same terminal quota body used by the
  account proxy when no replacement account is available.

Context strategy:

- If the `/v1/responses` request already includes `previous_response_id`, keep
  it and send only the provided incremental `input[]`.
- If the request does not include `previous_response_id`, treat the provided
  `input` as the complete client-supplied context for that request.
- Do not invent or persist hidden context for stateless `/v1/responses`
  requests. The adapter may maintain response id mappings only to support a
  client-provided `previous_response_id` or a configured session key.
- For SSE clients, the inbound HTTP body is one request. The adapter must not
  keep appending hidden prior turns unless the client explicitly sends
  `previous_response_id` or an accepted session key.
- Do not read `~/.codex` JSONL for `/v1` compatibility requests. That JSONL is
  Codex CLI/Desktop private client state and is only evidence for the
  transparent `/backend-api/codex/responses` proxy path.

### GET /v1/responses with WebSocket upgrade

This is a protocol bridge for clients that already speak WebSocket.

- Authenticate local API key before upgrade.
- Establish upstream WSS to `/backend-api/codex/responses`.
- Add managed account auth and required Codex WSS headers.
- Forward client text frames after applying the `/v1/responses` request
  normalization when the frame is JSON.
- Forward upstream text events back as WebSocket text frames.
- Keep current quota detection and account retry behavior from the account WSS
  proxy where possible.
- Unlike HTTP/SSE mode, this route may keep an upstream WSS open for the client
  connection lifetime or for a clearly scoped session key. Incremental
  `previous_response_id` turns are valid only inside that scoped connection or
  session.

### POST /v1/chat/completions

Inbound is old OpenAI Chat Completions. Upstream is still WSS Responses.

Connection lifecycle:

- Same as `POST /v1/responses`: one inbound HTTP/SSE request maps to one
  short-lived upstream WSS exchange.
- The Chat Completions `messages[]` payload is the complete client-supplied
  context for that request. The adapter must not merge hidden history from other
  requests.

Request conversion to Codex Responses:

- `model` maps to `model`.
- `stream` controls only the client response mode; upstream WSS still streams.
- Build one upstream `response.create` object with no hidden history and no
  generated `previous_response_id`.
- `messages[]` becomes Responses `input[]` in original order.
- `system` role becomes a `developer` message or `instructions`; prefer a
  developer message when preserving exact message order matters.
- `user` content becomes `message` items with `input_text`, `input_image`, or
  `input_file` content parts.
- Assistant text becomes `message` items with `output_text` content parts.
- Assistant `tool_calls[]` become top-level `function_call` items with
  `call_id`, `name`, and `arguments`.
- `tool` messages become top-level `function_call_output` items with matching
  `call_id` and stringified `output`.
- `image_url` and `file` content parts map to `input_image` and `input_file`.
- `tools[].function` flatten to Responses `tools[]` entries.
- `tool_choice` string passes through; function choice flattens to
  `{type:"function", name}`.
- `response_format` maps to `text.format`.
- Tool names longer than 64 chars must be shortened deterministically and
  reverse-mapped on response.
- Unsupported sampling fields are ignored or rejected consistently with
  `/v1/responses`; they must not be forwarded blindly to Codex WSS.

Response conversion to Chat Completions:

- `response.created` caches response id, model, and created timestamp.
- `response.output_text.delta` emits `chat.completion.chunk` with
  `choices[0].delta.content`.
- `response.reasoning_summary_text.delta` emits
  `choices[0].delta.reasoning_content`.
- `response.output_item.added` for `function_call` emits a tool call start
  chunk with id, function name, and empty arguments.
- `response.function_call_arguments.delta` emits tool call argument deltas.
- `response.function_call_arguments.done` emits full arguments only if no delta
  was received.
- `response.completed` emits a final chunk with `finish_reason` of `stop` or
  `tool_calls` and includes usage when present.
- Non-streaming mode aggregates the final `response.completed.response` into one
  `chat.completion` JSON response.

## Internal Modules

Recommended files:

- `src/main/proxy/v1-compat-service.ts`: separate listener lifecycle.
- `src/main/proxy/v1-compat-http.ts`: route auth, `/v1/models`, HTTP/SSE entry.
- `src/main/proxy/v1-compat-wss.ts`: HTTP-in/WSS-out bridge and WSS passthrough.
- `src/main/proxy/v1-transforms.ts`: pure JSON converters.
- `src/main/proxy/v1-transforms.test.ts`: conversion fixtures from captures.
- `src/main/proxy/v1-compat-service.test.ts`: listener, auth, routing, quota.

The WSS bridge should reuse existing account routing, raw frame capture,
quota-event parsing, and outbound proxy support instead of opening a second
untracked socket stack.

## Acceptance

- `bun run test` passes.
- Focused tests prove `/v1/responses` HTTP/SSE uses upstream WSS, not upstream
  HTTP POST.
- Focused tests prove `/v1/chat/completions` converts text, tools, tool
  outputs, images, and streaming chunks.
- Captured quota events produce the same terminal quota behavior as the account
  proxy.
- Normal `/backend-api` account-login behavior and request-body transparency do
  not change.
