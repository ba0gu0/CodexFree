# 下一步任务

## 任务队列

| ID | 状态 | 任务 | 依赖 |
|----|------|------|------|
| T1a | 已完成 | 实现透明代理服务和脱敏观察 ledger | 技术栈决策 |
| T1b | 已完成 | 从 HAR 或代理日志补全 Codex 账号模式 packet contract | T1a 或 Yakit exports |
| T2 | 已完成 | 定义 Codex、CPA 和 sub2api 的 auth 文件规范化 | 样例文件 |
| T3 | 已完成 | 设计代理请求分类和 API-key 拒绝逻辑 | T1b |
| T4 | 已完成 | 实现 quota-exhaustion 检测和 auth switching 状态机 | T1b |
| T5 | 已完成 | 定义 accounts、usage 和 events 的 SQLite schema | T2、T4 |
| T6 | 已完成 | 设计 Electron 管理 UI 信息架构 | T2、T5 |
| T7 | 已完成 | 创建 Bun Electron Vite React project manifest | 技术栈决策 |
| T8 | 草稿 | 添加明确的 API-key OpenAI-compatible adapter mode | T1b、T4 |
| T9 | 已完成 | 把 proxy 拆分为由 app 控制的 standalone daemon | T4、T5 |
| T10 | 进行中 | 让真实 Docker Codex 流量下的 proxy logs 可供操作员阅读 | T4 |
| T11 | 进行中 | 依据 daemon/admin API 打磨剩余页面 layout 和 interactions | T6、T9 |
| T12 | 已完成 | 按最新 proxy traffic field contract 优化全 app 数据展示 | T10、T11 |
| T13 | 已完成 | 实现首次引导与配置助手首版 | T11、onboarding spec |
| T14 | 已完成 | 编写中英文 README | 当前项目状态文档 |
| T15 | 已完成 | 补齐 GitHub 开源正式发布边界 | T14、packaging docs |

## 并行工作线

### 工作线 A：Proxy Daemon Core

这条线可以在独立于 UI 工作的单独线程中运行。

负责范围：

- `src/main/proxy/**`；
- daemon/CLI entrypoint；
- local admin API 或 IPC；
- SQLite ledger 和 account-state 读写；
- WSS 和 HTTP quota handling；
- terminal logs；
- Docker Codex validation。

即时任务：

1. 已完成：`bun run daemon` 现在启动 daemon entrypoint，并使用共享的
   `codexfree.sqlite` ledger。
2. 已完成：daemon admin API 受 token 保护，并暴露 status、config、accounts、usage
   updates、requests、request summaries、usage summaries、log events、protocol messages、
   account disable/delete/reset 和 clear。它不暴露 `/admin/start`、`/admin/stop` 或
   `/admin/restart`。Config saves 会持久化到 SQLite；desktop UI 通过 App process owner
   应用它们，而不是通过 admin lifecycle endpoints。`/admin/reload` 保留为供
   daemon/admin clients 使用的本地工具 endpoint。Account-management actions 写 SQLite；
   daemon 在后续 admin query、routing decision 和维护任务边界重读 SQLite，不维护权威
   in-memory account-pool state，也不关闭现有 WSS sessions。
3. 已完成：普通 daemon runs 会把 log events 写入 SQLite，不产生 request spam；`--debug`
   会从同一 event stream 打印可读行。
4. 已完成：Electron main 不再嵌入 proxy service。打包构建包含 daemon JS bundle，并通过
   Electron 的 Node runtime 运行；开发启动使用相同的 `bun run daemon` 路径。Main-process
   lifecycle controls 会 start/stop/restart app-owned child process 或配置的 OS service
   owner，而 summary refreshes 可以读取 aggregate SQLite data，不会重新启动已经停止的
   daemon。
5. 继续依据真实 Docker Codex 流量重做 `bun run daemon` logs：
   - daemon startup；
   - 从 SQLite 加载的 active account；
   - quota remaining 和 reset time；
   - HTTP request purpose 和 response result；
   - WSS connection lifecycle；
   - turn summary 中的 user request、AI reply、token usage 和 tool counts；
   - quota detection；
   - account switch 或 no replacement account。
6. 修复 HTTP fallback `POST /backend-api/codex/responses` quota handling，使它遵循与 WSS
   quota handling 相同的 account-state rules。
7. 保持普通 account-login proxy paths 位于 `/backend-api` 下；保持 `/v1` API-key
   compatibility 独立且明确。
8. 已完成：已经打开的 client WSS connections 会重新进入 per-turn `response.create` probe。
   Immediate quota 会被抑制；self-contained turns 会 replay 到替代 upstream account，而
   incremental turns 只有在另一个账号存在、Codex 可以重连时才关闭 client WSS。如果 pool
   没有替代账号，就转发最终 quota。
9. 已完成：当前 packet 和 relay-analysis findings 已记录在
   `docs/proxy-traffic-analysis.md`。未来 UI 工作在添加新的 request、usage、overview 或
   account fields 前，应把该文档作为数据源参考。

验证：

- `bun run lint`；
- `bun run typecheck`；
- focused proxy tests；
- 通过 `chatgpt_base_url = ".../backend-api"` 和
  `openai_base_url = ".../backend-api/codex"` 执行
  `docker exec codex ... codex exec ...`；
- terminal log review，证明整个流程可理解。

### 工作线 B：Desktop App Console

这条线应避免修改 proxy hot-path code，除非它需要新的 admin status field。

负责范围：

- `src/renderer/**`；
- `src/preload/**`；
- Electron shell 和 admin client glue；
- app navigation 和 account/request/usage views。

即时任务：

1. Main-process control 已完成：Electron main 有 daemon admin client，且没有 embedded proxy
   service。Runtime startup 会先从 SQLite `proxy_settings` probe 配置的 daemon management
   host/port/token，只有该 endpoint 不可达时才启动 daemon。Start/stop/restart 由 app child
   process 或 OS service manager 拥有，而不是由 daemon admin HTTP lifecycle endpoints 拥有。
2. 显示 startup/config helper values：
   - `chatgpt_base_url = "http://127.0.0.1:<port>/backend-api"`；
   - `openai_base_url = "http://127.0.0.1:<port>/backend-api/codex"`。
3. Overview 已完成：显示 known account email、quota、reset time、available count、
   exhausted count、categorized recent events，以及不会围绕 `=` 换行的 copyable proxy
   config rows。
4. 在 daemon 演进过程中，保持 account import、batch usage checks、enable/disable/reset 和
   request ledger screens 可用。
5. 已完成：在 Proxy 页面暴露 management host/port/token，并添加 macOS LaunchAgent toggle，
   让 boot startup 有清晰的 service owner。
6. 把 `docs/proxy-traffic-analysis.md` 作为下一轮 Requests 和 Usage 页面优化 pass 的 UI
   数据源 contract，特别是 token source、cached-token display、request purpose filtering
   和 quota fields。
7. 作为全 app data-display pass 执行 T12。真实来源是 `docs/proxy-traffic-analysis.md`；
   不要从旧 table columns 或 synthetic labels 设计。该 pass 必须更新 Overview、Accounts、
   Proxy/requests context、Requests 和 Usage，使可见 metrics 映射到最新 persisted fields，
   并在可能存在重复 token views 时说明它们的来源。

T12 验收：

- Overview 显示按 `request_purpose` 的 request distribution、active account email 或 label、
  plan、used percent、reset time 和 categorized recent events。
- Accounts 优先使用 `proxy_accounts.email`，显示 usage plan/percent/reset 和 last usage
  error，并从 quota events 而不是只从 last request row 读取 exhaustion state。
- Requests 默认 columns 包含 time、status、purpose、method/path、account、model、token
  breakdown、duration 和 bytes；request details 将 HTTP metadata 与 WSS/protocol messages
  分离。
- Usage 按 account、model、thread、turn、source 和 day 分组。没有 usage 的 requests 计入
  request/error statistics，但不计入 token totals。
- Token displays 保持 `cached_input_tokens` 分离，并暴露 `token_usage_source`，避免
  protocol、SSE 和 analytics-event data 被静默混合。
- `/backend-api/wham/remote/*` rows 标记为 original Codex-account traffic，`/v1/*` 或非
  `/backend-api` probes 放入 API-key compatibility/probe bucket。
- 验证包含 `bun run lint`、`bun run typecheck:web`、`bun run typecheck:node`、
  `bun run build`，以及在最小 `1160x720` window 下对受影响页面进行 live Electron inspection。

T12 实现切片：

1. Contract surface：
   - 扩展 `src/preload/proxy-api.ts` DTOs，覆盖 `ProxyRequestLedger.recent()` 和
     `recentProtocolMessages()` 返回的所有现有 fields；
   - 保持 DTO names 与 ledger camelCase fields 对齐；
   - 在 admin/client serialization 当前固定 exposed shape 的位置添加 focused tests。
2. Shared data model：
   - 添加 renderer helpers，用于 request purpose labels、model fallback、token-breakdown
     formatting、source labels、byte totals，以及 original Codex-account paths 的 account
     display；
   - 把 helpers 放在 `src/renderer/src/data/` 或 page model files 中，不要放进大 JSX blocks。
3. Overview：
   - 用 purpose distribution 替换 generic recent request count；
   - 在可用时显示 active account plan/used/reset details；
   - 保持 recent log categories 基于 typed `event_type`。
4. Accounts：
   - 把 email 作为 primary display name；
   - 在 table/inspector 中暴露 plan、primary/secondary usage、reset time、last check 和
     last usage error；
   - 从 quota/log events 显示 quota history，而不是只从 latest request 推断。
5. Requests：
   - 围绕 time、status、purpose、method/path、account、model、tokens、duration 和 bytes
     重建 default columns；
   - 添加 purpose、account、model、thread、turn、source 和 outcome 的 filters/search；
   - 添加 detail layout，分离 HTTP metadata、token/source facts、Codex thread/turn/runtime
     fields，以及 request 的 protocol messages。
6. Usage：
   - 用按 account、model、thread、turn、source 和 day 的 token-aware groups 替换
     traffic-only analysis；
   - 把 request/error/latency statistics 与 token totals 分开；
   - 在任何未来 merged-by-turn view 之前先显示 source-separated totals。
7. Verification and documentation：
   - 更新所有新 labels 的 i18n copy；
   - 运行要求的命令；
   - 在 light 和 dark modes 下以 `1160x720` 检查 live Electron pages；
   - 在本文件中记录 verification evidence 和剩余 risks。

T12 当前实现证据：

- 已完成：renderer DTOs 现在暴露 `ProxyRequestLedger.recent()` 和
  `recentProtocolMessages()` 返回的最新 request/protocol fields。
- 已完成：shared display helpers 现在覆盖 request purpose、model fallback、token breakdown、
  source labels、byte totals 和 original Codex-account paths。
- 已完成：Requests 现在显示 time、status、purpose、method/path、account、model、token
  breakdown、duration 和 bytes，并把 request detail 拆成 HTTP、token/source、Codex context
  和 protocol messages。
- 已完成：Usage 现在按 source、model、account、day 和 thread/turn 对真实 token usage 分组，
  同时把 request/error/traffic statistics 与 token totals 分开。
- 已完成：Overview 现在包含 recent request purpose distribution，Accounts 暴露 reset/check/error
  details，同时把 quota history 过滤为 typed quota events。
- 已完成：Accounts 的“待复核”summary card 和 `invalid` 状态筛选统一使用人工复核错误口径；
  尚未查量但无错误的账号，以及 `usage check failed: 402` 账号，不会被误计入待复核。
- 已完成：Accounts 的清理动作扩展为 401/402 清理，按 SQLite `last_usage_error` 识别账号，
  删除 matching `proxy_accounts` rows 和托管 auth files，并让 status/counts 从 SQLite facts
  重读，不再从 daemon 内存或 auth 文件目录推导。
- 已完成：Accounts 最近检查列改为固定两行摘要，所有窗口尺寸下都显示关键信息和检查时间；
  完整错误保留在 tooltip 和详情面板。
- 已完成：User-feedback polish pass 添加 full-database request 和 usage summary cards、所有页面
  manual refresh buttons、refresh-on-navigation、top-center concise notices、触发按钮上的
  account usage progress、per-row usage refresh controls、sticky sortable list headers，以及
  基于 OS-owner 的 daemon lifecycle controls，没有 admin lifecycle endpoints。
- 已完成：Visual consistency pass 重新平衡 page headers、修复 top metric card height、防止
  action-bar wrapping，并弱化 dashboard sidebars，让 dashboard、accounts、proxy、requests 和
  usage 重新读成同一个 app。
- 已完成：Follow-up layout pass 抬高 app/page header bands，bottom-align page actions，压缩
  summary cards 到更紧凑的 shared height，并把 Accounts page header 减少到 primary actions。
- Passed：`rtk bun run lint`。
- Passed：`rtk bun run typecheck:web`。
- Passed：`rtk bun run typecheck:node`。
- Passed：`rtk bun run typecheck`。
- Passed：`rtk bun run test`。
- Passed：`rtk bun run build`。
- Passed：`rtk bun run test -- src/main/auth/cleanup.test.ts src/main/proxy/ledger.test.ts src/main/proxy/service.test.ts src/renderer/src/pages/accounts-model.test.ts`。
- Passed：`rtk bun run build:unpack`。
- Passed：使用 Computer Use 进行 live dev-app inspection。当前验证应继续通过 Computer Use，
  且不能依赖 system screenshots。
- Confirmed：Dashboard 使用 full-database request totals 和 purpose groups，把 batch usage
  action 移出 top toolbar，并在 service text 下方渲染复杂 background-service waveform。
- Confirmed：Requests 在 `1160x720` 下显示所有 default columns，包括 account 和 bytes；
  zero-byte request traffic 渲染为 `0 B / 0 B`，而不是 "unlimited"。
- Confirmed：Usage 显示 token totals，并按 source、model、account、day 和 thread/turn 分组。
- Confirmed：Accounts 在 light 和 dark modes 下显示 email-first account names、
  plan/usage/reset/check fields，以及 typed quota-event history sections。
- Confirmed：真实 `/backend-api/wham/usage` 响应已重新抽样。free 只有
  `rate_limit.primary_window` 且 `secondary_window` 为 `null`；team 的
  `primary_window` 是 18000 秒 5 小时窗口，`secondary_window` 是 604800 秒周窗口。Accounts、
  Inspector、Dashboard 和 quota guard 已统一使用双窗口模型，team 不再只显示被错标的
  “周额度”，任一窗口达到 95% 保护线都会退出可用池。
- Confirmed：额度检查 402 现在按 quota unavailable 处理，主窗口默认补为 100%，保留
  `last_usage_error = "usage check failed: 402"` 作为最近检查摘要和 401/402 清理依据，并进入
  耗尽保护；402 不进入“待复核”统计。
- Confirmed：常规 SSE/WSS 观察日志已收敛为 turn summary 优先。正常 user、assistant、usage 和
  tool 参数/结果不再写入 `proxy_protocol_messages`；协议明细只保留错误/限流排障事件。Requests
  UI 以交互汇总数和 turn detail 为主，隐藏历史 tool protocol 碎片，`raw capture` 调试能力保持不变。
- Confirmed：成功转发的 request ledger 只记录 Codex responses、compact responses 和 wham usage
  这类核心事件；`models` 只做托管 header 预检但不写成功请求行，analytics/plugins/apps/connectors
  等辅助接口只转发，不替换托管 header，也不写普通 request row。
- Confirmed：Windows packaged app 的 Proxy 页面白屏根因是端口字段使用 native
  `input[type="number"]` 触发原生 renderer crash。监听端口和管理端口已改为 text input
  编辑态，输入时只保留数字，保存前校验 `1000-65535`，再以 number 写入
  `saveProxyPageConfig`。
- Passed：`rtk bun run lint`、`rtk bun run typecheck`、`rtk bun run test`
  （43 files、188 tests）和 `rtk git diff --check`。

T13 当前实现证据：

- 已完成：主进程新增 setup assistant 检测模型，检查 daemon、目标代理入口、Codex
  `config.toml`、本地 `auth.json`、账号池数量和最近成功 usage 记录；历史 models rows 只用于模型数量
  展示，不再作为新的成功信号。
- 已完成：`config.toml` 检测区分 current、missing、missing values、port mismatch、wrong
  table、顶层 model_provider cleanup 和 mismatch；写入仍复用安全 writer，正确时不重复备份。
  writer 只管理顶层 `chatgpt_base_url`、`openai_base_url` 和 `model_provider`，不写入
  `model_provider = "openai"`，不修改 `[model_providers.<name>]` 定义。写入前会把当前
  `config.toml` 备份为 `config-codexfree-YYYYMMDD-HHMMSS.toml`，并备份现有
  `auth.json`。Proxy 页面新增 auth/config 备份恢复和会话 provider 同步；新备份名使用本地时间
  `auth-codexfree-YYYYMMDD-HHMMSS.json` / `config-codexfree-YYYYMMDD-HHMMSS.toml`，
  旧版 `YYYYMMDDTHHMMSS-codexfree-*` 不再进入可恢复列表；
  恢复 auth/config 备份时不再备份当前文件，避免恢复操作反复生成备份项。会话同步按当前配置修复
  `state_*.sqlite` 与 session JSONL，并先写入 app data 备份。会话同步的目录遍历、JSONL
  读写和 JSONL 备份已改为异步文件系统操作，并在 SQLite/JSONL 批处理之间让出事件循环，
  避免 Electron 界面被长时间阻塞。
- 已完成：`auth.json` 检测区分 missing、Codex login-like、placeholder、API-key mode 和
  unrecognized，不显示 token；重新登录辅助只做二次确认后的 rename，不写替代文件，且缺少
  auth 文件时按钮置灰。引导现在先导入账号池，再检查 Codex 登录；用户可以显式选择一个已导入
  可用账号写入 `~/.codex/auth.json`，写入前备份现有文件，并通过 SQLite 优先选择其他可用账号
  作为当前代理账号。
- 已完成：renderer 顶部新增“助手”入口，配置助手 Sheet 与首次引导 Dialog 复用同一状态模型；
  Sheet 展示检查时间，并提供 raw capture 和工作目录诊断入口。异常状态项会显示“去处理”，
  点击后打开引导并跳到对应步骤；“打开引导”每次从工作方式开始。
- 已完成：首次引导补齐目标 config 预览，重写工作方式说明，账号池步骤前置，把查量动作改为
  “查询所有用户用量信息”。查量用于刷新状态和剔除异常账号，不再阻断继续进入 Codex 登录检查。
- 已完成：账户空状态和请求无 turn summary 提示改为面向用户的下一步说明，不引导修改本地
  `auth.json`，并说明可能的 SSE/WSS 解析原因。
- Passed：`rtk bun run lint`、`rtk bun run typecheck`、`rtk bun run test`、`rtk bun run build`。
- Confirmed：Computer Use 在 dev Electron 最小窗口检查了“助手”入口、配置助手 Sheet、首次引导
  Dialog 的工作方式、代理、Codex config 和 Codex 登录步骤；未见遮挡或文本溢出。

T14 当前实现证据：

- 已完成：`README.md` 改为默认中文入口，覆盖项目定位、工作原理、当前功能、快速使用、
  安全边界、本地开发、项目结构和当前限制。
- 已完成：新增 `README_EN.md`，与中文 README 保持同等结构，并从中文 README 提供英文入口。
- Passed：`rtk bun run lint`。

T15 当前实现证据：

- 已完成：根目录新增 MIT `LICENSE`，并在 `package.json` 声明 `"license": "MIT"`。
- 已完成：根目录新增 `SECURITY.md`，明确漏洞报告不得附带真实 auth 文件、token、cookie、
  raw capture 或本地 SQLite 数据库。
- 已完成：中英文 README 说明开源正式发布状态、MIT 许可证、安全报告入口、非官方产品边界、
  只使用自有或获授权账号，以及本地 `test` 参考材料、抓包、数据库和构建产物不能手动上传。
- 已完成：中英文 README 的 Codex `config.toml` 说明已经收敛到只移除顶层 `model_provider`；
  不删除 `[model_providers.<name>]`，也不写入 `model_provider = "openai"`。
- 已完成：中英文 README 补充 `cc switch` 和其他 Codex 配置切换工具的并发写入提醒；
  不建议与 CodexFree 同时修改或频繁切换同一个 `config.toml`。
- 已完成：macOS release 明确不签名、不公证；这是当前成本约束下的发布策略，不是
  发布阻塞项。
- 已完成：`electron-builder.yml` 移除未使用的 Camera、Microphone、Documents 和 Downloads
  权限说明，保留 `identity: null` 和 `notarize: false`。
- 已完成：GitHub 仓库 `ba0gu0/CodexFree` 已通过 `gh repo create` 创建并绑定为 `origin`。
- 已完成：新增手动触发的 GitHub Actions release workflow。`prepare` job 从当前提交的
  `package.json.version` 读取版本并打 `v{version}` tag；macOS job 构建完整安装包；
  macOS/Windows/Linux jobs 使用 Velopack `osx-x64`、`osx-arm64`、`win-x64`、`win-arm64`、
  `linux-x64` 和 `linux-arm64` channels 生成 installer、full/delta packages 和 release
  feeds；`publish` job 归一化文件名后汇总并发布 GitHub Release。
- 已完成：release workflow 增加发布资产完整性校验。每次 release 必须包含 6 个安装包：
  macOS x64/arm64 DMG、Windows x64/arm64 setup exe、Linux x64/arm64 AppImage；还必须
  包含 6 个 `CodexFree-<version>-<platform>-<arch>-update.nupkg` 完整更新包和六个
  `releases.{channel}.json`。prerelease 发布下载上一版时会传 `--pre`；如果上一版同 channel
  feed 里存在 `Type: Full` 但没有生成 delta 包，workflow 会失败。发布后校验会拒绝
  `com.baoguo.codexfree-*`、`.blockmap`、`Portable.zip` 和 `*-full.nupkg` 旧命名。
- 已完成：App 内更新从 `electron-updater` 切换到 Velopack/GitHub release status。
  macOS/Windows/Linux 都支持 Velopack 检查、下载和应用更新。macOS 仍是不签名、不公证
  产物，用户需要按需在本机允许打开或自行签名。
  Dashboard 当前版本显示统一使用 update status `currentVersion`。
- 已完成：`electron-builder.yml` 显式设置 `publish: null`，避免基于 GitHub metadata
  重新生成旧 updater 配置；macOS 完整包仍由 `electron-builder` 输出，各平台 Velopack
  release feeds 由 `vpk pack` 处理，GitHub Release assets 由 workflow 用归一化后的文件名上传。
- Passed：`rtk bun run lint`。
- Passed：`rtk bun run typecheck`。
- Passed：`rtk bun run test`。
- Passed：`rtk bun run build`。
- Passed：`rtk bun run build:mac`。
- Passed：`rtk go run github.com/rhysd/actionlint/cmd/actionlint@latest -color=false
  .github/workflows/release.yml`。
- Confirmed：packaged macOS app bundle 不包含旧 `app-update.yml`；Velopack native `.node`
  文件已进入 `app.asar.unpacked/node_modules/velopack/lib/native/`。
- 未本地执行：macOS/Windows/Linux `vpk pack`。本地一次性安装 `vpk` help 超时；Velopack
  packaging 由 GitHub Actions job 执行。

验证：

- `bun run lint`；
- `bun run typecheck`；
- renderer build；
- manual app launch；
- app 可以检查/控制一个已经运行的 daemon。

Renderer refactor 状态：

- Coss-first 和 shadcn-fallback component policy 仍是目标。
- `src/renderer/src/components/ui/` 可以包含 source-owned component building blocks，但它不是
  app UI implementation。
- `src/renderer/src/App.tsx` 现在拥有 V3 shell 和 page routing。
- Dashboard、Accounts、Proxy、Requests 和 Usage 已实现并连接。Dashboard、Accounts、Proxy、
  Requests 和 Usage 现在共享 V3 desktop-console information architecture；未来工作应聚焦
  窄范围 interaction polish 和缺失 backend-backed fields，而不是再次做 broad shell rewrite。
  Destructive local actions 现在在 clearing records 或 writing placeholder `auth.json` 前使用
  confirmation dialogs。所选 UI language 会同步到 native import/export dialogs，同时 language
  和 theme choices 会本地持久化。Daemon management configuration 是 Proxy 页面的一部分，
  不是单独 settings page。overview 打开并约束在 `1160x720` minimum desktop window：没有
  top-level page scroll，按比例的三列 app structure，以及内部滚动的 Recent Activity table，
  没有 horizontal scrollbar 或 fixed row slice。remaining-page polish pass 让 Accounts、
  Proxy、Requests 和 Usage 通过 compact headers、semantic light/dark borders、virtualized
  data tables，以及没有重复 copy/context blocks 的更干净 Proxy 页面与 overview 对齐。当前
  overview detail pass 移除 top recent-event summary，把 utility system button 改为 theme
  cycle，移除 account-health progress bar，按 event type 分类 recent logs，把
  `/backend-api/wham/remote/*` 标记为 original Codex account，并使用 email metadata 而不是
  synthetic account ids。Proxy 页面端口配置不得回退到 native `input[type="number"]`；
  Windows packaged Electron 下该控件路径已确认会导致 renderer crash。
- `docs/CodexFree-v2.pen`、`docs/CodexFree-v3.pen` 和 preview images 仍是设计参考，本身不能
  作为完成证明。

当前验证：

- `bun run lint`；
- `bun run typecheck:web`；
- `bun run typecheck:node`；
- `bun run typecheck`；
- `bun run build`；
- `bun run build:unpack`。
- 当前 refactor 的 Electron shell 验证：
  - dashboard overview 在默认 desktop window 中匹配 V3 desktop mockup details；
  - account、proxy、request 和 usage navigation 正常；
  - proxy、request 和 usage 页面在 live Electron window 中渲染当前 polished console layouts；
  - accounts、proxy、requests 和 usage 在 light 和 dark modes 下匹配 overview card/table
    visual language；
  - request clearing 和 placeholder `auth.json` writing 会打开 confirmation dialogs，并且可以
    在不派发 destructive action 的情况下取消；
  - 最小 `1160x720` window 下，overview 保持 shell fixed，只有 Recent Activity table 垂直滚动；
  - managed directory open action 成功。
- 当前 daemon/proxy core 验证：
  - `bun run test` 通过 24 个 test files 和 89 个 tests；
  - `bun run typecheck:node` 通过；
  - `bun run daemon -- --help` 通过；
  - local daemon smoke 确认默认写入 log events，仅在 `--debug` 下打印。

## 即时下一步

T1a 已完成。服务从 standalone daemon 启动，支持 configurable listen host、listen port、
upstream base URL、outbound proxy mode、redacted logs、SQLite request ledger fields，以及
明确的 temp-directory raw capture。它不修改 request bodies，也不替换 upstream auth。

验证：`bun run lint`、`bun run typecheck`、`bun run test`、`bun run build`、
`bun run build:unpack`、transparent proxy integration test、通过 `127.0.0.1:33333` 的
local curl、通过 `10.211.55.2:33333` 的 Docker Node fetch，以及现有 `codex` container 中的
`codex exec`。

环境说明：默认 port 现在是 `33333`，默认 host 是 `127.0.0.1`。现有 `codex` container 有
`codex-cli 0.130.0`；Docker 验证需要显式 `--host 0.0.0.0` override，之后才能把它的 config
指向 Mac proxy。Docker 应使用 `host.docker.internal`；本地主机 Codex 应使用 `127.0.0.1`，
从 VM/LAN client 访问时使用电脑 IP。

T1b 已针对普通账号模式流量完成。HAR 分析确认 direct upstream paths 位于
`https://chatgpt.com/backend-api` 下。现在验证了两种本地路由形态：

- `openai_base_url = "http://host.docker.internal:33333/backend-api/codex"` 让 Docker
  Codex-to-proxy model traffic 保持在 `/backend-api/codex/models` 和
  `/backend-api/codex/responses`，同时 `chatgpt_base_url =
  "http://host.docker.internal:33333/backend-api"` 让 auxiliary ChatGPT backend traffic 保持在
  `/backend-api/*`。
- `/v1/models` 和 `/v1/responses` 属于未来 API-key compatibility surface。`/v1/models`
  必须把 upstream account models 转换成标准 OpenAI model-list response shape。
- `openai_base_url = "http://127.0.0.1:33333/backend-api/codex"` 让 host Codex-to-proxy
  model traffic 保持在 `/backend-api/codex/models` 和 `/backend-api/codex/responses`，同时
  `chatgpt_base_url = "http://127.0.0.1:33333/backend-api"` 让 auxiliary ChatGPT backend
  traffic 保持在 `/backend-api/*`。

在两个已验证形态中，proxy 都会把 `Host` 重写为 `chatgpt.com`，并保留 request bodies。

提供的 flat auth template 已规范化为 Codex 0.130 native `auth.json` shape。规范化之后，通过
早期 `/v1` 实验的 `codex exec` 返回 `converted-auth-proxy-ok`；该结果只是历史证据，不应作为
账号登录默认路径使用。

第二个 HAR `test/History-1778652315307.har` 验证了 `/backend-api/codex` base URL shape。
`codex exec` 返回 `chatgpt-base-url-ok`；raw captures 显示
`GET /backend-api/codex/models` status `200`，WebSocket
`GET /backend-api/codex/responses` status `101`。Auxiliary interfaces（`analytics-events`、
`connectors`、`wham/apps` 和 `plugins/featured`）在 HAR 和 raw capture 之间 body 与选定
auth/protocol headers 保持不变；当前默认转发会保留原始 auth headers，且成功辅助接口不写
request ledger。

即时下一步：继续把 API-key compatibility mode 保持为单独的 T8 phase。account-login proxy
path 现在已可配合 imported managed accounts、real usage checks、persisted account state 和
明确 auth-pool takeover 使用。

T2 已针对当前支持的 import surface 完成。Normalization module 接受 native Codex
`auth.json`、CPA-style records，以及包含 ChatGPT account tokens 的 sub2api-style records。它
返回 canonical Codex account-login auth shape，并把 safe metadata 与包含 token 的 raw object
分离。

最新 T2 导入修复支持递归目录、CPA/flat JSON 数组或包装集合、`token_data` 包装记录，以及从
id token claims 解析 `chatgpt_account_id` 和 `chatgpt_plan_type`。Usage 查询和 request ledger
也会从 `plan_type`、`chatgpt_plan_type`、`account_type`、nested account/subscription plan
字段识别 team/pro。Team/pro 账号池现在区分本地账号 ID 和上游 `tokens.account_id`，因此多个
email 共享同一个上游 account id 时不会互相覆盖；转发 header 和 usage check 仍使用真实上游
account id。

当前 T2 验证：`rtk bun run lint`、`rtk bun run typecheck`、`rtk bun run test`，以及聚焦
`rtk bun run test src/main/auth/normalize.test.ts src/main/auth/import.test.ts
src/main/auth/usage-check.test.ts src/main/proxy/account-pool.test.ts
src/main/proxy/http-analysis.test.ts`。真实 `/Users/baoguo/Downloads/cpa` 后段文件 smoke：
22 个输入导入 22、跳过 0、错误 0、存储 21；其中 11 个共享同一上游 account id 的 team 文件全部保留，
1 个重复 edu 邮箱按本地 ID 去重。历史验证还包含 `bun run build`。

延后的 T2 加固：

- 随着样例出现添加更多真实世界 sub2api variants；
- 在后续 security phase 用 encrypted 或 platform-protected storage 替代 plaintext
  app-managed auth-file storage。

T3 已完成。代理现在会在转发前按 account-mode path 和 headers 分类请求。已知 Codex account
backend paths 只有在携带 account auth headers 时才允许；`Bearer sk-` API-key mode requests
和 unknown backend paths 会在本地被拒绝，并以 `rejected` 写入 ledger，不会到达上游。这适用
于普通 HTTP requests 和 WebSocket Upgrade requests。

当前 T3 验证：`bun run lint`、`bun run typecheck`、`bun run test` 和 `bun run build`。

T4 已推进，因为真实 usage-limit samples 已经从 WebSocket packet stream 抓取并解码。loop run
`/tmp/codexfree-ws-loop-usage.jsonl` 命中：

```text
You've hit your usage limit. Upgrade to Plus to continue using Codex
(https://chatgpt.com/explore/plus), or try again at May 20th, 2026 3:15 AM.
```

匹配的 raw capture id 是 `<uuid>`，其中
`GET /backend-api/codex/responses` 返回 HTTP `101`。解码后的
`websocket-upstream-to-codex.frames.jsonl` payload 包含 `usage_limit_reached`、
`status_code: 429`、`X-Codex-Plan-Type: free`、`X-Codex-Active-Limit: premium` 和
`X-Codex-Primary-Used-Percent: 100`。

已实现的 T4 切片：现在会解析 decoded upstream WSS text frames 中的
`usage_limit_reached`，并把匹配的 upgraded requests 在 ledger 中更新为
`quota_exhausted`，status 为 `429`。这不会 replay 或修改 in-flight turn。

当前 T4 验证：`bun run lint:fix`、`bun run test`、`bun run typecheck` 和 `bun run build`。

即时下一步：更新 account availability，并实现 next-boundary auth replacement，不改变 request
bodies，也不 replay failed turn。

已实现的 T4 account-pool 切片：account-pool routing 从 app-managed import directory 加载
规范化 auth files 到内存 router。用户不能选择自定义 runtime auth directory。router 把每个
conversation key 绑定到选中账号，只替换 upstream `Authorization` 和 `chatgpt-account-id`，
在 decoded WSS `usage_limit_reached` 时把绑定账号标记为 exhausted，并在下一次 request 或 WSS
upgrade boundary 选择下一个 available account。多个 conversations 由独立 conversation
bindings 处理。

已实现的 WSS quota retry shielding：当新打开的 upstream WSS 在任何 upstream business frame
被转发给 Codex 前返回 `usage_limit_reached`，proxy 会缓冲 client socket、隐藏 quota frame、
标记尝试账号 exhausted、用下一个 available account 重连 upstream、replay buffered client
frames，然后恢复 normal piping。这避免了当另一个长任务耗尽前一个账号最终 quota 时，新的
Codex task 在仍有其他账号可用的情况下显示 quota exhausted。

Usage query policy 也已固定：`/backend-api/wham/usage` 应使用当前绑定/默认可用账号转发，并
返回该账号真实 upstream usage。proxy 不能伪造固定 100% 或虚假的低 usage value。

四个 free-account `hi` samples 已抓取到 `test/raw-captures/account-hi`。packet comparison 显示：

- account-varying fields：`Authorization`、`chatgpt-account-id`；
- session-varying fields：`thread_id`、`session_id`、`x-client-request-id`、
  `x-codex-window-id`、`x-codex-turn-metadata`；
- transport-varying fields：`sec-websocket-key`；
- stable protocol fields：`/backend-api/codex/models`、`/backend-api/codex/responses`、
  `openai-beta: responses_websockets=2026-02-06`、model/responses 的 request bodies。

Same-session account switching 也已抓取到 `test/raw-captures/same-session-account-switch`。
三个 auth files 使用相同的 `codex exec resume` thread id
`019e<thread-redacted>`。response WSS account id 随 auth file 改变，而
`thread_id`、`session_id`、`x-client-request-id`、`x-codex-window-id` 和
`x-codex-turn-metadata` 保持稳定。这确认 account switching 可以在同一 conversation 内的下一个
WSS upgrade boundary 发生。

当前 T4 验证：`bun run lint`、`bun run test`、`bun run typecheck`、`bun run build`，以及
Codex CLI `0.130.0` 的 Docker validation。

已完成的 T4 core work：

- 把 account availability 持久化到 SQLite `proxy_accounts`；
- 把 route decisions 持久化到 `proxy_routing_events`；
- 把 quota exhaustion details 持久化到 `proxy_quota_events`；
- service restart 后在路由前重新加载 persisted exhausted accounts；
- 在 forwarding 期间标记 token/account failures，但不在 proxy path 内 refresh；
- 保持 concurrent conversation bindings 分离，并在存在 unbound account 时避免抢占另一个 active
  conversation 已绑定的账号；
- 屏蔽 initial WSS `usage_limit_reached` frames，并用下一个 available account 重试；
- 只有在所有 managed accounts 都 exhausted 时才透传 quota error；
- 验证使用 selected account 进行真实 `/backend-api/wham/usage` forwarding。

Docker validation evidence：

- Container inbound account：
  `<uuid>`。
- Local auth-pool outbound account：
  `<uuid>`。
- Raw captures 显示 `/backend-api/codex/models`、WebSocket `/backend-api/codex/responses`
  和 `/backend-api/wham/usage` 上发生 account replacement。
- chat task 返回 `authpool-docker-ok`；manual usage query 返回 HTTP 200 和真实 upstream body。

T4 已针对 account-login proxy path 完成。最新切片添加了：

- app-managed account import，不自动启用 takeover；
- runtime routing 使用与 batch import 相同的 app-managed directory；
- imported accounts 的 batch usage checks；
- per-account disable/enable control；
- exhausted-account reset control；
- exported auth-file backup path；
- in-memory conversation bindings 的 24 小时 retention pruning；这些 bindings 只是短生命周期
  转发上下文，不是账号事实来源；
- available、exhausted 和 disabled account counts 从 SQLite 读取后 reporting。

来自 `test/History-1778683339690.har` 和 raw captures 的最新证据进一步细化 T4：

- Codex 在 session/turn starts 后建立 WSS `/backend-api/codex/responses` channel。
- proxy 必须为已经升级的 WSS connection 保留 auth headers。
- 只有解码后的 upstream WSS payload 中 `error.type = "usage_limit_reached"` 才把绑定账号标记为
  exhausted。
- Network disconnects、`EPIPE`、local proxy failures 或 Yakit HTML errors 不能触发 auth
  replacement。
- quota exhaustion 后，同一 session 可以在下一个 request boundary 获得新账号资格；failed
  in-flight WSS turn 不会 replay。

T8 有意保持独立。它通过添加 off-by-default API-key compatibility mode 来改变之前的 hard
boundary。在该模式下，CodexFree 会在配置的 port/key 上接受标准 OpenAI-style `/v1/models`、
`/v1/responses` 和 legacy `/v1/chat/completions` requests。`/v1/models` 必须把 account
models payload 转换成标准 OpenAI response shape。`/v1/responses` 必须支持 HTTP/SSE 和
WebSocket client surfaces，同时每个 generation request 到 ChatGPT 都通过短生命周期 account
WSS `/backend-api/codex/responses` call。`chat/completions` 必须把 requests 转换成 Codex
Responses frames，并把 Codex response events 转换回 OpenAI Chat Completions chunks 或 final
JSON。详细转换设计在 `docs/specs/v1-compatibility-adapter.md`。这不同于 account-login
transparent proxy，需要单独 tests 和 operator controls。

## 整体 Proxy 能力计划

account-login proxy core 后仍需要：

- Account storage hardening：encrypted 或 platform-protected auth payload storage。
- Validation tools：一键 raw capture cleanup 和 account/header changes 的 packet diff summaries。
  当前 daemon path 的 Docker smoke output 现在已记录在 `docs/current-state.md`。
- Token refresh integration 已完成：daemon 账号维护任务在转发热路径外刷新带
  `refresh_token` 的托管账号；access-token-only 账号标记为不可刷新，过期后由真实 401
  禁用。
- API-key compatibility mode：单独的 disabled-by-default listener、明确的 local API key、可见的
  ban/detection warning，以及从 OpenAI-style `/v1/*` requests 到短生命周期 account WSS
  exchanges 的 adapter。

T7 已完成。验证：`rtk bun run lint`、`rtk bun run typecheck`、`rtk bun run test`、
`rtk bun run build`、`rtk bun run build:unpack`、用 Computer Use 检查 dev UI，并确认打包的
GitHub update metadata 和 sanitized update-check failure logging。

最新 proxy-response 切片已针对两个 client-visible account surfaces 完成：

- `/backend-api/wham/usage` 仍通过 selected managed auth file 转发，并从真实 upstream response
  更新 quota state，然后把真实 upstream usage shape 返回给 Codex，不做 client-visible field
  rewriting。之前的 `user_id`/`account_id` rewrite helper 仍在代码中，但未激活。
- `/backend-api/wham/remote` 及其子路径现在绕过 managed auth replacement，因此 HTTP 和 WSS
  流量中，上游会收到原始 Codex `Authorization` 和 `chatgpt-account-id` headers。
- Terminal WSS quota handling 现在只在仍有另一个账号可用时抑制 immediate probe quota frames。
  如果没有替代账号，最终 `usage_limit_reached` frame 会返回给 Codex。
- `/backend-api/codex/models` 保持上游返回的 model list 原样。
- 验证通过：
  `bun run test -- src/main/proxy/service.test.ts`、
  `bunx biome check src/main/proxy/service.ts src/main/proxy/service.test.ts`，
  以及 `bun run typecheck:node`。

daemon log-model rewrite 已针对当前 account-login proxy 完成：

- `proxy_requests` 记录一个完成的 network request，并携带 route-specific HTTP results 的
  structured `summary_json`。
- `proxy_protocol_messages` 记录解析后的 SSE/WSS protocol events，包括 user requests、assistant
  replies、usage、errors、tool calls 和 tool results，并带有 `item_id`、`call_id`、
  `response_id`、`previous_response_id` 和 `parent_response_id` correlation fields。
- `proxy_turn_summaries` 聚合从 user request 到 assistant completion 的一轮，包括 token usage
  和 tool counts。
- Normal request progress logs 不再填充 `proxy_log_events`；该表现在保留给 system、error、
  auth、account-switch 和 quota events。
- Requests UI 会在 requests、protocol messages 和 events 旁加载 turn summaries；account
  history links 仍然会把 account id 传入 request search box。
- 验证通过：`rtk bun run lint`、`rtk bun run typecheck`、`rtk bun run test` 和
  `rtk bun run build`。
- Live Docker Codex validation 使用 isolated data dir `/tmp/codexfree-live-i757ob` 通过：
  direct interactive `codex` 产生 HTTP request rows、WSS user/assistant/usage protocol rows、
  turn summaries 和 tool call/result rows。后续 `/backend-api/wham/usage` request 确认该 row
  存储 proxied account 和 remaining-quota summary（`primaryUsedPercent=4`、
  `primaryRemainingPercent=96`）。

## 就绪规则

- Draft tasks 在依赖提供前不能实现。
- 任何改变 request forwarding、auth handling 或 persistence 的任务，如果发现新风险，都必须更新
  `docs/security-checklist.md`。
- Temporary raw capture 只能在明确 debug setting 后启用，并且必须写到 repository 外 app data
  `raw-captures` 目录。
- 当任务变为 Done 时，在这里记录 verification evidence。
- 不启用 independent task cards；本文件是 task queue authority。
