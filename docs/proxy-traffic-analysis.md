# 中转流量分析与 App 数据源参考

## 目的

本文整理本轮基于 `test/raw-captures`、Yakit 抓包和中转实现得到的结论，供后续 App
界面优化使用。重点是：请求界面、用量分析界面、总览界面和账户界面可以从中转服务收集哪些字段，以及这些字段的统计口径。

## 总体口径

- 不估算 token。只有响应或上报事件中存在真实 `usage` / token 字段时才记录。
- cached token 必须单独记录为 `cached_input_tokens`，不能合并进普通 input 展示。
- WSS、HTTP SSE、analytics-events 都可能包含 token，但来源不同，UI 必须用 `token_usage_source` 区分。
- Authorization、Cookie、Set-Cookie、refresh token、access token、id token 等敏感信息只允许保存指纹或脱敏摘要。
- 请求体保持透明转发，中转分析只读取样本和结构化字段，不修改请求体。
- `/backend-api/wham/remote/*` 是原始 Codex 账号通道，保留原始上游认证，不用账号池认证替换。
- `/v1/*`、`/responses`、`/models` 等属于未来 API-key 兼容面或探测流量，不是默认账号登录代理主路径。

## 抓包接口清单

从 `test/raw-captures/**/*.http` 中识别到的 GET/POST 入口：

| 方法 | 路径 | 作用 | 建议 `request_purpose` | 重点字段 |
|---|---|---|---|---|
| GET | `/backend-api/codex/responses` | Codex 主 WSS 101 通道 | `codex_wss` | account、thread、turn、WSS frame、quota、protocol token |
| POST | `/backend-api/codex/responses` | Codex HTTP SSE 响应通道 | `codex_response_sse` | request model/input、SSE `response.completed` usage |
| POST | `/backend-api/codex/analytics-events/events` | Codex 客户端事件上报 | `analytics_events` | runtime、model、thread、turn、status、真实 turn token |
| GET | `/backend-api/codex/models` | Codex 模型列表 | `models` | model slugs、item count、capability 摘要 |
| POST | `/backend-api/wham/apps` | ChatGPT apps/connectors JSON-RPC | `wham_apps` | `rpc_method`、`rpc_id`、response item count |
| GET | `/backend-api/wham/usage` | 账号额度查询 | `account_usage` | plan、used percent、reset time、model |
| GET | `/backend-api/connectors/directory/list` | 连接器目录 | `connector_directory` | item count、连接器类别统计 |
| GET | `/backend-api/plugins/featured` | 插件推荐目录 | `plugin_featured` | item count、插件类别统计 |
| GET | `/backend-api/ps/plugins/installed` | 已安装插件查询 | `plugin_installed` | item count、默认活动预览过滤 |
| GET | `/v1/responses` | 兼容面探测或未来 API-key 模式 | `api_key_compat` | method/path/status/reject reason |
| GET | `/responses` | 非 `/backend-api` 响应探测 | `api_key_compat` | method/path/status/reject reason |
| GET | `/v1/chat/completions` | legacy chat completions 探测 | `api_key_compat` | method/path/status/reject reason |
| POST | `/v1/models` | 兼容面模型探测 | `api_key_compat` | method/path/status/reject reason |
| POST | `/models` | 非 `/backend-api` 模型探测 | `models` 或 `api_key_compat` | method/path/status/reject reason |

## Token 采集来源

### WSS `/backend-api/codex/responses`

AI 响应帧中会出现：

- `type = "response.completed"`。
- token 在 `response.usage` 下。
- 字段包括 `input_tokens`、`input_tokens_details.cached_tokens`、`output_tokens`、`output_tokens_details.reasoning_tokens`、`total_tokens`。
- `usage = null` 或不存在时不记录 token。

落库字段：

- `input_tokens`
- `cached_input_tokens`
- `output_tokens`
- `reasoning_tokens`
- `total_tokens`
- `token_usage_source = protocol` 或协议消息表中的同名字段

### POST SSE `/backend-api/codex/responses`

HTTP SSE 响应体中存在 `event:` / `data:` 行。抓包确认 `response.completed` 的 `data`
JSON 内也会包含 `response.usage`，字段结构与 WSS 一致。

解析口径：

- 按行扫描 `data:`。
- 忽略空 data 和 `[DONE]`。
- 解析 JSON 后读取 `response.usage` 或顶层 `usage`。
- 同一个 SSE 流内以最后一个带 usage 的事件为准。

落库字段：

- 同 WSS token 字段。
- `token_usage_source = sse`。

### analytics-events

`/backend-api/codex/analytics-events/events` 的 `events[].event_params` 中可出现 Codex
客户端真实汇总字段：

- `input_tokens`
- `cached_input_tokens`
- `output_tokens`
- `reasoning_output_tokens`
- `total_tokens`
- `duration_ms`
- `status`
- `turn_error`
- tool/search/image/subagent 调用计数字段

解析口径：

- 这些字段是客户端上报结果，不是代理估算。
- 与 WSS/SSE usage 可能描述同一 turn，UI 做总量分析时需要按 `thread_id + turn_id + source`
  设计去重或分组策略。
- 当前中转请求表记录 token 与 `token_usage_source = analytics_event`，后续可扩展专门的 turn summary 表。

## 请求表字段建议

`proxy_requests` 适合作为请求列表、总览和用量分析的基础数据源：

| 字段 | 来源 | 用途 |
|---|---|---|
| `request_purpose` | path/method 分类 | 请求界面筛选、总览请求类型分布 |
| `request_content_type` / `response_content_type` | HTTP headers | 调试压缩、SSE、JSON 类型 |
| `request_body_encoding` | `content-encoding` | 标记 `zstd` 等压缩体，不强行 JSON 解析 |
| `request_model` / `response_model` | request/response JSON、analytics | 模型维度统计 |
| `request_input_item_count` | request `input[]` | 单次请求上下文规模提示 |
| `response_item_count` | models/apps/connectors/plugins 响应 | 目录接口展示数量 |
| `rpc_method` / `rpc_id` | JSON-RPC request | `wham_apps` 细分展示 |
| `analytics_event_types` | analytics events | 事件类型筛选 |
| `codex_session_id` / `codex_thread_id` / `codex_turn_id` | `x-codex-turn-metadata` 或 analytics | 会话、请求、用量关联 |
| `codex_turn_started_at` | turn metadata | turn 时间线 |
| `codex_version` / `codex_runtime_os` / `codex_runtime_arch` | UA / analytics runtime | 客户端环境诊断 |
| `response_plan_type` | usage body/header | 账户计划展示 |
| `response_primary_used_percent` | usage body/header | 额度使用率 |
| `response_rate_limit_reset_at` | usage body/header | 额度恢复时间 |
| `response_active_limit` | usage body/header | 当前 active limit |
| `input_tokens` / `cached_input_tokens` / `output_tokens` / `reasoning_tokens` / `total_tokens` | WSS/SSE/analytics | 用量分析 |
| `token_usage_source` | parser | 去重、来源可信度说明 |

## 协议消息字段建议

`proxy_protocol_messages` 适合做请求详情页的消息流、WSS 调试面板和实时日志：

| 字段 | 用途 |
|---|---|
| `direction` | `codex-to-upstream` / `upstream-to-codex` |
| `kind` | user、assistant、tool、error、usage、rate_limit、heartbeat |
| `protocol_type` | 原始 frame type 或带 reasoning effort 的请求类型 |
| `sequence_number` | WSS 序号 |
| `response_id` / `previous_response_id` | 响应链路与续写关系 |
| `model` | 当前模型 |
| `input_item_count` / `tool_count` | 请求结构规模 |
| token 字段 | 单条 completed 消息真实 usage |
| `payload_bytes` / `truncated` | 大 payload 调试和采样说明 |

## 界面使用建议

### 总览界面

- 显示最近请求按 `request_purpose` 分类的数量。
- 显示当前 active account、plan、used percent、reset time。
- 显示最近 quota/auth/network/system 日志分类，而不是混杂文本。
- 对 `/backend-api/wham/remote/*` 标记为“原始 Codex 账号”。

### 账户界面

- 以 `proxy_accounts.email` 作为首选展示名，缺失时再显示 label/account id。
- 使用 usage 查询结果更新 plan、used percent、reset time、last usage error。
- quota exhaustion 事件来自 `proxy_quota_events`，不要只看最后一个请求状态。

### 请求界面

- 默认列建议：time、status、purpose、method/path、account、model、tokens、duration、bytes。
- 详情页按 request row 展示 HTTP 字段，按 protocol messages 展示 WSS 消息流。
- token 列应显示 `input / cached / output / reasoning / total`，cached 单独一列或单独小标签。
- `token_usage_source` 必须可见，避免把 analytics 与 WSS/SSE 混成重复计费。

### 用量分析界面

- 聚合维度建议：account、model、thread、turn、source、day。
- 首版可直接使用 `proxy_requests` 和 `proxy_protocol_messages`，后续若要去重更严谨，再增加 turn summary 表。
- `analytics_event` 适合展示 Codex 客户端视角的 turn 完成情况；`sse` / `protocol` 适合展示代理看到的上游响应 usage。
- 没有 usage 的请求参与请求量和错误率统计，不参与 token 总量统计。

## 额度耗尽行为结论

Yakit 抓包确认：第一条消息可以正常完成，随后触发 `usage_limit_reached` 后 Codex 会显示额度不足；再次发送消息时 Codex 会新建一个 101 WSS 请求。

因此当中转服务发现 `usage_limit_reached` 且账号池没有可替换账号时：

- 只转发最终 `usage_limit_reached` 给客户端。
- 不主动提前断开客户端连接。
- 等客户端按 Codex 自身逻辑关闭连接并在下一条消息建立新的 101 请求。

有可替换账号时，仍遵循现有 WSS 探测/重放规则：自包含 `response.create` 可在代理侧重放；依赖前序 `previous_response_id` 的请求不做 durable transcript 重建。

## 后续可扩展项

- 为 analytics-events 增加专门的 `turn_summaries` 表，按 `thread_id + turn_id` 汇总客户端视角 token、工具调用和耗时。
- 为目录接口增加 category distribution，支撑连接器/插件页面的分类统计。
- 为 request detail 增加 raw capture 跳转，但继续保持敏感头脱敏。
- 为用量分析增加 source 去重策略：默认按 source 分开展示，只有用户明确选择“按 turn 合并”时才做合并。
