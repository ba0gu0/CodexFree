# 当前状态

## 阶段

账号登录代理核心阶段。当前仓库已补齐 GitHub 开源 alpha 发布所需的基础边界：
MIT 许可证、安全报告规则、README 发布说明、GitHub Actions 手动 release 工作流，以及
未签名/未公证 macOS 产物的明确告知。

目录在初始化时为空。Electron/Vite 项目现在已经使用确认后的技术栈完成初始化，
包含 package manifest、lint、typecheck、testing、i18n、数据库 schema seed、本地
unpack 构建路径，以及第一个透明代理服务。

## 已确认的产品方向

CodexFree 是一个基于 Electron 的桌面系统，用于管理 Codex 账号 auth 文件，并运行
一个兼容 Codex 账号登录流量的本地代理。

核心行为：

- Codex 账号登录模式配置为：
  - `chatgpt_base_url = "http://127.0.0.1:33333/backend-api"`。
  - `openai_base_url =
    "http://127.0.0.1:33333/backend-api/codex"`。
- 为 Codex 生成一个本地占位 `~/.codex/auth.json`。
- 代理不会校验这个占位 token。
- 代理转发 Codex 请求时不修改 request body。
- 代理把本地 Codex `/backend-api/codex/*` 流量转发到
  `https://chatgpt.com/backend-api/codex` 下的 ChatGPT 账号模式上游路径。
- `/v1/*` 预留给未来明确的 API-key 兼容面，而不是文档化的账号登录代理配置。
- 账号池路由是常规转发模式。代理只在核心账号请求上从托管账号文件替换上游
  `Authorization` 和 `chatgpt-account-id`：`/backend-api/codex/models`、
  `/backend-api/codex/responses`、`/backend-api/codex/responses/compact` 和
  `/backend-api/wham/usage`。
- 透明 MVP 会记录脱敏后的核心请求元数据，并且可以选择把原始本地调试抓包写入系统临时目录。
- 原始抓包现在包含升级后的 `/backend-api/codex/responses` 流量对应的 WebSocket
  frame JSONL 文件。
- 常规请求观察现在优先写入 `proxy_turn_summaries`：user、assistant、usage 和工具调用只聚合为
  turn 文本、token 和工具计数。`proxy_protocol_messages` 只保留错误、限流等排障事件，避免正常
  对话和工具参数/结果碎片持续写入 SQLite。显式 `raw capture` 仍保持完整抓包调试用途。
- 成功转发的 request ledger 只保留核心事件：`/backend-api/codex/responses`、
  `/backend-api/codex/responses/compact` 和 `/backend-api/wham/usage`。models 请求仍会用托管
  header 访问上游，但成功结果不入库；analytics、plugins、apps、connectors 等辅助接口只转发，
  不做托管 header 替换，也不写普通请求行。
- `docs/proxy-traffic-analysis.md` 现在记录当前 GET/POST 抓包清单、token usage
  提取来源、request/protocol ledger 字段，以及 UI 用量建议。把它作为跨会话参考，
  用于 request、usage、overview 和 account 页面数据源优化。
- 对账号模式代理来说，auth-pool 接管始终开启。导入账号从单一 app 托管目录加载；
  不存在用于禁用账号池的 UI 或 CLI 开关。
- 代理现在会解析解码后的上游 WebSocket 文本 frame，并把匹配的
  `usage_limit_reached` 请求在 request ledger 中标记为 `quota_exhausted`。
- Auth-pool 路由现在使用单一 app 托管导入目录。用户不能把运行时指向任意 auth
  目录。代理加载规范化后的导入 auth 文件，只在核心账号请求上替换上游
  `Authorization` 和 `chatgpt-account-id`，按 conversation key 绑定账号，并在 WSS
  配额事件之后的下一个请求边界切换。
- 新的 WSS 请求如果立即命中 `usage_limit_reached`，可以在不把 quota frame 转发给
  Codex 的情况下重试上游。只有当缓冲的 `response.create` frame 是自包含的，client
  socket 才会保持打开：没有 `previous_response_id`，并且 `input` 数组非空。如果该
  frame 依赖之前的上游 response 状态，代理会抑制 quota frame、标记账号已耗尽，
  然后检查是否还有其他可用账号。如果存在其他账号，它会关闭 client WSS，让 Codex
  重连并重新发送自己的完整上下文。如果没有替代账号，它会把最终
  `usage_limit_reached` frame 转发给 Codex。
- 已经打开的 client WSS 连接在收到新的 `response.create` frame 时，会重新进入每轮
  probe 窗口。如果 quota 在任何非 quota 上游 frame 之前到达，就应用相同的自包含
  replay 规则；否则 stream 已经正常开始，之后的 quota 仍然是终止性的 session 结果。
- `POST /backend-api/codex/responses` 和 WSS `response.create` 现在有前置 quota guard。
  同一账号 1 分钟内复用最近一次查量结果；结果过期时只检查候选账号。`primary_used_percent`
  达到 95% 会按保护线退出可用池，避免继续打到真实 `usage_limit_reached`。WSS 有替代账号时
  关闭 client socket 触发 Codex 端口重连；所有账号都进入保护状态时，本地返回
  `usage_limit_reached`。
- quota guard 的远程查量结果会通过 `proxy_accounts` 更新账号 plan、用量百分比和 reset
  时间。真实上游 `usage_limit_reached` 或本地 95% 保护线标记账号耗尽时，也会在同一事务中
  更新账号用量字段，避免账号已耗尽但 UI 仍显示旧额度。
- 额度检查返回 402 时不再写入 `last_usage_error`。它会被归类为 quota unavailable，按主窗口
  100% 更新账号并进入耗尽保护；启动 ledger schema 时会清理旧的
  `usage check failed: 402` 待复核状态、相关 quota warn event 和 `/backend-api/wham/usage`
  402 request row。
- Daemon 现在有 quota reset 刷新任务，每 30 分钟检查一次账号池，只刷新
  `rate_limit_resets_at` 已过 5 分钟且当前 reset 窗口尚未刷新过的非禁用账号。刷新成功会写入
  `last_quota_refreshed_at` 和 `last_quota_refreshed_reset_at`，并记录 quota event，避免同一
  reset 窗口重复刷新。reset 刷新遇到 402 时只更新账号额度状态并标记该 reset 窗口已检查，不再写
  skipped warn event。
- 代理不会持久化完整的结构化 conversation transcript 来做跨账号重建。原始
  WebSocket 抓包和内存 probe buffer 是调试/重试辅助，不是持久 message-history 模型。
- Usage 查询会使用当前绑定/默认可用账号转发，并返回真实的上游 usage。代理不会伪造
  固定 100% 的 usage 响应。
- 2026-06-08 使用 `/Users/baoguo/Downloads/cpa` 中的真实 free/team auth 文件重新确认
  `/backend-api/wham/usage` 当前响应：额度信息不在 `x-codex-*` 响应头里，而在 JSON
  body 的 `rate_limit` 下。free 账号只有 `primary_window`，当前样本窗口为 2592000 秒且
  `secondary_window` 为 `null`；team 账号有两个窗口，`primary_window.limit_window_seconds`
  为 18000（5 小时额度），`secondary_window.limit_window_seconds` 为 604800（周额度）。
  CodexFree 现在把 team、plus、pro 以及任何带 secondary quota window 的账号按双窗口处理；
  账号列表、详情面板和 dashboard 不再把 team 的 primary window 错标成周额度。quota guard
  和 SQLite 账号状态保护线也会同时检查 primary/secondary，任一窗口达到 95% 都会退出可用池。
- `/backend-api/wham/remote` 及其子路径是透明例外：代理会保留原始 Codex
  `Authorization` 和 `chatgpt-account-id` headers，而不是从 HTTP 和 WSS upgrade
  流量的托管 auth pool 中替换。
- 账号可用性现在持久化在 SQLite 中。代理把加载的 auth 文件同步到
  `proxy_accounts`，把路由决策记录到 `proxy_routing_events`，并把 quota exhaustion
  详情记录到 `proxy_quota_events`。重启后的服务在路由新请求之前会重新加载持久化的
  exhausted 账号。
- 导入账号管理现在支持从 Electron 管理界面进行批量导入、批量 usage 检查、导出、
  401 清理、单账号禁用/启用，以及 exhaustion reset。导入、usage 检查和运行时路由
  都使用同一个 app 托管 auth-pool 目录。
- 账号页的“待复核”统计和状态筛选使用同一口径：只有需要人工处理的 `last_usage_error`
  进入待复核；单纯尚未查量的账号和旧的 `usage check failed: 402` 不会显示为待复核，避免
  统计卡片和筛选结果不一致。
- 导入后会按 account id 覆盖旧授权文件，并只对本次新增/覆盖的账号自动查量；daemon
  同步仍读取托管目录中的全部有效账号，避免只导入一部分时误删旧账号状态。
- 导入账号现在以 `access_token` 为唯一硬必填字段。缺少 account id 的记录会先用该
  token 查询 `/backend-api/wham/usage`，从上游 usage 响应回填 account id 和 email；
  缺少 `refresh_token` 的账号会标记为不可刷新，仍可进入账号池，后续真实 401 会禁用。
- 导入账号元数据现在把 email 和 refreshable 状态持久化到 SQLite `proxy_accounts`，
  并在 usage 检查返回或解码出 email 地址时回填 auth 文件。操作员日志行持久化 typed `event_type`，因此
  UI 可以区分常规请求、账号切换、网络问题、quota 问题、auth 问题和系统变更。
- Electron 启动现在从 SQLite `proxy_settings` 读取 daemon 管理 host、port 和 admin
  token，先尝试配置的 admin endpoint，只有该 endpoint 不可达时才启动 daemon。
- Daemon 生命周期由 Electron app 进程或操作系统 service manager 拥有，而不是由
  daemon admin HTTP endpoints 拥有。admin 面不再暴露 `/admin/start`、`/admin/stop`
  或 `/admin/restart`；app start/stop/restart 控件使用配置的 LaunchAgent、systemd
  user service、Windows service，或 app 拥有的 child process，并在 daemon 是在 app
  外部启动时报告诊断。
- 代理配置只在 SQLite `proxy_settings` 中持久化。从桌面 UI 保存 config 时先写
  SQLite，然后 App process manager 通过配置的 owner 重启 daemon：App child process、
  LaunchAgent、systemd user service 或 Windows service。直接编辑数据库不会改变正在
  运行的 daemon，直到 App owner 重启它，或本地 admin client 调用保留的
  `/admin/reload` 工具 endpoint。
- 账号管理动作写 SQLite，然后只刷新 daemon 的内存 account-pool cache。它们不会重启
  proxy service，也不会关闭现有 WSS sessions。
- 账号管理页的“设为当前账号”动作通过 daemon admin
  `POST /admin/accounts/switch` 执行。daemon 会把目标可用账号写为 active account，
  并关闭现有 upgraded WSS sessions，让后续请求按新的当前账号路由。
- 内存 conversation bindings 会在 24 小时后裁剪，避免旧 session 永久占用账号。
- 代理转发热路径不会刷新托管 ChatGPT token。daemon 账号维护任务会在启动时和每小时
  扫描可刷新账号，根据 access token `exp` 或 `last_refresh` 判断是否需要调用
  refresh-token flow，成功后写回托管 auth 文件并刷新内存账号池。不可刷新账号过期后由
  真实 401 标记为 disabled。
- 进行中的 WebSocket streams 保持原始 auth。代理不能在已经升级的 WSS 连接上重写 auth。
- 只有上游 WSS stream 返回结构化 `usage_limit_reached` quota error 后，session 才有
  资格替换 auth。网络断开、本地 `EPIPE`、代理重启和 Yakit/MITM 失败都不算 quota
  exhaustion。
- API-key 模式请求会被拒绝，除非未来启用明确的兼容开关。该模式与 Codex 账号登录转发
  分离。

## 已确认的工具链

- 规模：Medium。
- 运行时：Bun。
- 语言：strict TypeScript。
- 桌面框架：Electron with Vite。
- 前端：React 19。
- UI：Tailwind CSS、shadcn-style Coss UI、Base UI primitives、`lucide-react`。
- 数据库：SQLite with Drizzle ORM。
- 测试：优先 Vitest；之后可以为 UI 和 Electron flows 添加 Playwright。
- Proxy runtime：`bun run daemon` 会把 `src/main/daemon/cli.ts` bundle 到
  `out/daemon/cli.cjs`，并通过 Electron 的 Node runtime 使用
  `ELECTRON_RUN_AS_NODE=1` 运行。打包构建使用 `app.asar` 内相同的 `cli.cjs` 路径；
  Electron main 通过受本地 token 保护的 admin API 控制它。
- Native module runtime：本地 daemon、打包 daemon 和 Vitest 都对齐到 Electron 的
  Node ABI。`postinstall` 会在 `electron-builder install-app-deps` 之前显式运行
  `bun node_modules/electron/install.js`，确保 Electron binary 存在，并且
  `better-sqlite3` 等 native modules 会为 Electron 重建。
- 文档模块：保留当前 docs，启用 ADR，不启用独立 task cards。
- Renderer 已经重构到 V3 desktop shell，新顶层导航、dashboard、account、proxy、
  request 和 data-analysis 页面都通过 daemon/admin API 接线。dashboard overview 已完成
  V3 细节 pass：header 顺序、三列 shell、status strip、proxy 和 account-pool cards、
  recent activity table、right inspector 现在都遵循 `docs/CodexFree-v3.pen` overview
  mockup。account、proxy、request 和 data-analysis 页面现在共享同一个 desktop-console
  处理方式，包含 summary strips、便于扫描的 tables、contextual side panels，以及
  masked/local-only operational details。Daemon management settings 位于 Proxy 页面内，
  而不是单独的 settings 页面。request-ledger clearing 和 placeholder `auth.json` writing
  这类破坏性本地操作现在需要 confirmation dialogs。所选 UI 语言会同步到 native
  import/export dialogs，并且 language 和 theme preferences 会本地持久化。desktop
  window 打开尺寸与最小尺寸相同，都是 `1160x720`；overview shell 在该尺寸下固定高度，
  保持 V3 三列结构和按比例的 side rails，并把 Recent Activity 滚动限制在 table body，
  不出现横向滚动或固定行数切片。最新 overview pass 还移除了 top-strip recent-event
  tile，把 system utility button 改为 `system -> dark -> light` theme cycle，显示分类的
  recent events 而不是 alarm text，移除 account-health progress bar，格式化 proxy config
  rows 时不会在 `=` 处换行，并使用 account email metadata 而不是合成的
  `codex:<account-id>` labels。`/backend-api/wham/remote/*` rows 被明确标记为原始
  Codex 账号，因为该 route 会保留用户配置的上游 auth。最新 remaining-page polish pass
  让 Accounts、Proxy、Requests 和 Usage 与 overview 风格对齐：compact headers、语义化
  light/dark borders、固定高度 desktop content、virtualized multi-row tables，并且 Proxy
  页面没有重复的 proxy-copy 或 related-context blocks。最新 data-display pass 让 renderer
  DTOs、derived models、Overview、Accounts、Requests 和 Usage 与
  `docs/proxy-traffic-analysis.md` 对齐：request purpose、model、content metadata、Codex
  thread/turn/runtime 字段、usage source、cached input tokens、token breakdowns 和
  protocol-message 字段现在会在相关位置可见。Requests 在 `1160x720` 下保持
  time/status/purpose/method-path/account/model/tokens/duration/bytes 可见，Usage 按
  source、model、account、day 和 thread/turn 对真实 token records 分组，不估算缺失的
  usage。最新 interaction pass 还为 list views 添加 sticky sortable headers，移除 request
  page auto-polling，改为 manual refresh 加 refresh-on-navigation，并让 account usage
  checks 保持在显式按钮上，progress 渲染在发起操作的按钮上。

## 已完成初始化

- 把 `@quick-start/electron` React TypeScript scaffold 合并到项目根目录，并移除嵌套的
  `my-app` 目录。
- 用 Biome 替换 ESLint 和 Prettier。
- 添加 Paraglide JS，使用 `zh-CN` base locale 和 `en` fallback messages。
- 添加 Tailwind CSS v4、Coss/shadcn-compatible `components.json`、Base UI selection
  record 和 `lucide-react`。
- 添加 TanStack Query、TanStack Form、Valibot、Drizzle ORM、SQLite driver 和
  `electron-log`。
- 切换到 Velopack 发布路线。`electron-builder` 负责生成 Electron app 和 macOS 完整
  安装包；macOS/Windows/Linux 的 installer、portable、delta packages、
  `releases.{channel}.json` 和 GitHub Release 上传由 Velopack 处理。
- 添加 metadata-only SQLite schema seed，并为 account records 中 auth-secret exclusion
  添加 Vitest 覆盖。
- 在 V3 shell refactor 后验证 Electron renderer。desktop window 现在能加载重新设计后的
  shell、在 views 之间切换，并执行打开托管目录等 live actions。
- 按照 `docs/CodexFree-v3.pen` 完成 V3 dashboard overview detail pass，包括默认 desktop
  window 三列 layout、干净的 tab switching，以及与设计匹配的 dashboard column padding。
- 添加 `proxy-agent`，支持 outbound direct、HTTP、HTTPS、SOCKS4 和 SOCKS5 proxy modes。
- 添加透明转发服务，支持可配置 listen host、listen port、upstream base URL、outbound
  proxy mode、脱敏 logs 和 SQLite request ledger fields。
- 添加 pre-forward request classification，因此只有已知 Codex 账号模式 backend paths 会被
  转发，而 API-key mode 和 unknown paths 会在本地被拒绝。
- 默认 listen target 是 `127.0.0.1:33333`。Docker 或 LAN 验证必须通过显式 host override
  选择加入，例如 `--host 0.0.0.0`。
- 添加明确的 raw-capture debug switch，会把四个 protocol-shaped `.http` packet files 写到
  repository 外 app data 的 `raw-captures` 目录。
- 只有当 `maxRequestBodyBytes` 大于 0 时才限制 proxy request bodies；默认值 `0` 表示无限制。
- 为升级后的 responses 流量添加 WebSocket frame capture，包括用于读取上游 error messages 的
  `permessage-deflate` 解码。
- 添加 proxy IPC 和 daemon control surfaces，覆盖 host、port、upstream、outbound proxy、
  raw capture、service status、raw capture directory、daemon lifecycle、full-database
  request/usage summaries，以及 recent request observations。renderer UI 已接入这些 controls。
- 添加第一个 auth-file normalization module，支持 Codex native auth files 和 flat
  Codex/CPA-compatible token records。
- 添加第一个内存 account pool router，支持 per-conversation binding、quota exhaustion
  marking，以及 next-boundary replacement。
- Renderer 已进入 V3 desktop-console 模式。Dashboard、Accounts、Proxy、Requests 和 Usage
  页面已经实现并连接；`docs/CodexFree-v2.pen` 和 preview assets 只是设计参考。
- 首次引导与配置助手首版已实现。新增入口位于顶部导航“助手”，由用户手动打开，不会在
  账号不足、代理停止、Codex config 未修复或 `auth.json` 未配置时自动弹窗。助手会基于真实 daemon
  status、`config.toml`、`~/.codex/auth.json`、账号池和最近成功请求/用量结果生成状态。
  配置助手 Sheet 可重复打开；每个状态项展示本次检查时间，面板提供代理、Codex config、
  Codex 登录、账号池和诊断目录动作。首次引导 Dialog 复用同一检测模型，按工作方式、代理、
  Codex config、Codex 登录、账号池和完成检查推进；Codex config 步骤展示目标配置预览，
  账号池步骤推荐查询所有可用账号用量但不阻断继续流程，完成检查展示可用模型数。配置助手中异常状态项会
  显示“去处理”并跳到对应引导步骤；“打开引导”每次从工作方式开始，不恢复上次步骤。`auth.json`
  只支持二次确认后的重命名重新登录辅助；缺少 auth 文件时重命名按钮置灰，API-key 模式会提示
  重命名后重新走 ChatGPT 账号登录。Codex 登录步骤先展示“自有账号登录”和“使用已导入账号”
  两条路径；没有可用导入账号时只禁用导入账号路径，不阻断向导继续。引导顺序已调整为先导入
  账号池，再检查 Codex 登录；
  如果用户没有自有登录账号，可以显式选择一个已导入账号写入本地 `auth.json`。写入前会备份
  现有文件，并通过 SQLite 标记该账号为本地登录账号，同时优先选择其他可用账号作为当前代理账号，
  避免先消耗本地登录账号额度。工作方式说明明确区分本地 Codex 登录、CodexFree 代理转发、
  账号池授权和未来 API-key compatibility。UI 状态使用 `onboarding.completedAt` 和
  `setupAssistant.lastCheckedAt` 本地键，不能作为健康状态依据。
- Codex config 写入现在只管理顶层 `chatgpt_base_url`、`openai_base_url` 和
  `model_provider`。切换到 CodexFree 代理模式时会把当前 `config.toml` 备份为
  `config-codexfree-YYYYMMDD-HHMMSS.toml`，删除顶层 `model_provider`，但不会写入
  `model_provider = "openai"`，也不会修改 `[model_providers.<name>]` 定义。Proxy 页面支持从
  CodexFree 创建的 `auth.json` / `config.toml` 备份中选择一个恢复，以及按当前 `config.toml`
  同步 Codex 历史会话
  provider。新备份文件名使用本地时间 `auth-codexfree-YYYYMMDD-HHMMSS.json` 和
  `config-codexfree-YYYYMMDD-HHMMSS.toml`；旧版
  `YYYYMMDDTHHMMSS-codexfree-*` 备份不再进入可恢复列表。恢复 auth/config 备份时直接覆盖当前
  `auth.json` / `config.toml`，不会再创建新的同类备份，避免恢复操作来回制造备份项。
  会话同步会先备份 app data 下的修复目录，只改
  `state_*.sqlite` 的 `threads.model_provider` 和 session JSONL 的 `session_meta`
  `payload.model_provider`。会话同步的目录遍历、JSONL 读写和 JSONL 备份使用异步文件系统
  操作，并在 SQLite/JSONL 批处理间让出事件循环，避免在 Electron main process 中长时间
  卡住界面。README 已提醒 `cc switch` 或其他 Codex 配置切换工具不要与
  CodexFree 同时写入或频繁切换同一个
  `config.toml`，避免互相覆盖。
- README 已更新为默认中文入口，并新增英文 `README_EN.md`。两份 README 覆盖 CodexFree
  的定位、工作原理、账号池使用流程、`auth.json` 和 `config.toml` 配置边界、安全注意事项、
  本地开发命令、项目结构和当前限制。
- 开源 alpha 发布边界已补齐：`package.json` 声明 MIT license，仓库根目录新增
  `LICENSE` 和 `SECURITY.md`，中英文 README 均说明 CodexFree 不是 OpenAI/ChatGPT/Codex
  官方产品、只应使用自有或获授权账号、不要上传本地 `test` 参考材料或 raw captures。
  macOS release 明确不签名、不公证，这是当前成本约束下的发布策略，不作为阻塞项。
- macOS 打包配置移除了 Camera、Microphone、Documents 和 Downloads 等未使用权限声明；
  `identity: null` 和 `notarize: false` 保持不变。

## 已知缺失输入

- 除 flat Codex-token-compatible records 外，还需要更多真实世界 sub2api variants。
- 安全加密或平台保护的 auth storage。
- 如果未来改为正式商业分发，需要重新评估 Developer ID 签名、notarization、更新通道和密钥托管；
  当前 GitHub alpha 发布不做签名/公证。
- 早期验证无法绑定 port `55555`；常规本地开发现在使用 `127.0.0.1:33333`，而 Docker
  验证可以临时把 host override 到 `0.0.0.0`。
- 现有 `codex` Docker container 已安装 `codex-cli 0.130.0`，并且可以通过
  `host.docker.internal` 访问 Mac proxy。Host-side Codex 可以使用 `127.0.0.1`；LAN 或
  VM clients 只替换 host 为该电脑 IP 地址，同时保持 `/backend-api` paths 不变。

## 当前验证

- `bun run lint`
- `bun run typecheck:web`
- `bun run typecheck:node`
- `bun run typecheck`
- `bun run test`
- `bun run build`
- `bun run build:unpack`
- setup assistant slice 验证：
  - `rtk bun run lint`
  - `rtk bun run typecheck`
  - `rtk bun run test`
  - `rtk bun run build`
  - Computer Use 检查 dev Electron 最小窗口：顶部“助手”入口、配置助手 Sheet、首次引导
    Dialog 的工作方式、代理、Codex config 和 Codex 登录步骤均可见，没有明显遮挡或溢出。
- GitHub 开源 alpha 发布边界验证：
  - `rtk bun run lint`
  - `rtk bun run typecheck`
  - `rtk bun run test`
  - `rtk bun run build`
- V3 shell 的手动 Electron 验证：
  - dashboard 在默认 desktop window 中渲染三列 mockup layout；
  - `账户` 和 `代理` tabs 可以正确切换；
  - `代理`、`请求`、`用量` 和 `系统` 页面渲染 polished desktop console layouts；
  - request-ledger clearing 和 placeholder `auth.json` writing 在派发 daemon action 前显示
    confirmation dialogs；
  - `1160x720` 最小 Electron window 会保持 dashboard chrome 固定，只有 Recent Activity
    table 垂直滚动；
  - Accounts、Proxy、Requests 和 Usage 在 shared border/theme pass 后已在 live Electron
    window 中检查，现在 light 和 dark modes 下都匹配 overview card 和 table treatment；
  - dashboard proxy config snippet 保持三行，隐藏 horizontal scrollbar，同时保留横向滚动；
  - managed auth directory opening 成功并返回 app notice；
  - account metric cards 不再把 auth directory path 垂直换行。
- Transparent proxy integration test 会转发 request bodies，并记录脱敏 ledger metadata。
- 通过 `http://127.0.0.1:33333/backend-api/codex` 的手动本地 curl 到达透明服务，并保留
  request body。
- 通过 `http://host.docker.internal:33333/backend-api/codex` 的手动 Docker Node fetch 到达
  Mac service。
- `docker exec codex codex -V` 返回 `codex-cli 0.130.0`。
- `test/History-1778577142774.har` 确认标准 Codex 账号模式上游 host 是 `chatgpt.com`，
  主要 model surfaces 是 `/backend-api/codex/models` 和 `/backend-api/codex/responses`。
- 早期从 `codex` container 发起的 `codex exec` 使用 `/v1` OpenAI-compatible local paths
  测试过。该路径族现在属于 API-key compatibility scope，而不是账号登录代理默认行为。
- 提供的 flat auth template 必须先规范化为 Codex CLI native `auth.json` shape，之后 Codex
  才会发出 `authorization` 和 `chatgpt-account-id` headers。
- 早期通过 `/v1` 的 `codex exec` 只因为 `/v1` 临时作为 OpenAI-compatible mapping 处理才
  成功完成。现在应把它视为 API-key compatibility scope，而不是 account-login default
  behavior。
- `codex exec` 也使用首选配置验证过：
  `chatgpt_base_url = "http://host.docker.internal:33333/backend-api"` 和
  `openai_base_url =
  "http://host.docker.internal:33333/backend-api/codex"`；这会让 Codex-to-proxy model
  traffic 保持在 `/backend-api/codex/models` 和 `/backend-api/codex/responses`。
- `test/History-1778652315307.har` 加 temp raw captures 确认 `models`、`responses`、
  `analytics-events`、`connectors`、`wham/apps` 和 `plugins/featured` 的上游形态。当前 request
  ledger 只保留核心转发事件；这些 auxiliary interfaces 仍可在显式 raw capture 中查看。
- 对从该 HAR 分析出的所有非主要 auxiliary interfaces，CodexFree 在 raw capture 中保留
  request lines、bodies、原始 auth/protocol headers 和 response packets；普通转发不再替换托管
  account headers。唯一有意的基础转发差异仍是 `Host: 10.211.55.2:33333` 变为
  `Host: chatgpt.com`。
- Raw capture 现在每个请求准确写入四个 protocol-shaped packet files：
  `codex-inbound-request.http`、`codex-downstream-response.http`、
  `chatgpt-outbound-request.http` 和 `chatgpt-upstream-response.http`。
- Auth normalization tests 覆盖 native Codex `auth.json`、flat token records、CPA filename
  inference，以及 malformed-file errors，且 error messages 不包含 secret values。
- Auth import 现在递归读取导入目录，并支持单个 CPA/flat JSON 内的数组或包装集合。缺少
  `account_id` 的 Codex/CPA 记录会先从 id token 的
  `https://api.openai.com/auth.chatgpt_account_id` 解析；账户类型会优先使用同一 claims 中的
  `chatgpt_plan_type`，再用 usage 响应中的 `plan_type`、`chatgpt_plan_type`、
  `account_type` 或 nested account/subscription plan 字段补齐，因此 team/pro 账号可以被识别。
  对 team/pro 这类多个用户可能共享同一上游 `chatgpt_account_id` 的文件，CodexFree 会使用
  上游 account id 加用户身份派生本地账号池 ID，避免导入时互相覆盖；转发和 usage 查询仍使用原始
  `tokens.account_id` 作为上游 `chatgpt-account-id`。
- request ledger 现在把 `chatgpt-account-id` 存储为 account metadata，把 `thread_id` /
  `session_id` / `x-client-request-id` 存储为 conversation metadata。
- 真实 usage-limit samples 已经通过 CodexFree 抓取。可见 HTTP 层仍返回 WebSocket `101`；
  quota error 是从 `websocket-upstream-to-codex.frames.jsonl` 解码出来的。
- 解码后的 usage-limit WebSocket frame 包含 `type: "error"`、`error.type:
  "usage_limit_reached"`、`status_code: 429`、`X-Codex-Plan-Type: free`、
  `X-Codex-Active-Limit: premium` 和 `X-Codex-Primary-Used-Percent: 100`。
- `test/History-1778683339690.har` 和 raw captures 确认 Codex 在开始 session/turn 后会打开
  WSS `/backend-api/codex/responses` channel，后续 turn traffic 可以通过 WSS 承载。Quota
  exhaustion 是 WSS application message，本身不是 transport close reason。
- Unit coverage 现在验证解码后的 WSS `usage_limit_reached` events 会被解析，并把 proxied
  WSS request outcome 更新为 `quota_exhausted`。
- 四个 free-account `hi` runs 已抓取到 `test/raw-captures/account-hi`。跨账号来看，只有
  `Authorization` 和 `chatgpt-account-id` 是必须替换的账号身份字段。`thread_id`、
  `session_id`、`x-client-request-id`、`x-codex-window-id`、`x-codex-turn-metadata` 和
  `sec-websocket-key` 是 session/request boundary fields，不能从 auth files 复制。
- same-session account-switch sample 已抓取到
  `test/raw-captures/same-session-account-switch`。三个不同 auth files 通过 `codex exec resume`
  用于同一个 thread id `019e<thread-redacted>`；三个 turns 都完成，且
  conversation/session/window headers 保持不变，只有 `Authorization` 和
  `chatgpt-account-id` 变化。
- Account-pool unit coverage 验证共享 conversation 的第一个 WSS request 使用 account A，
  从解码后的 `usage_limit_reached` frame 标记 A 已耗尽，并在下一个 WSS request 使用
  account B。
- WSS retry unit coverage 验证当另一个账号可用时，初始上游 quota frame 不会转发给 client；
  replacement account 的正常 response frame 会被转发。
- Docker validation 在 Codex CLI `0.130.0` 上使用 container inbound account
  `<uuid>` 和三账号本地 pool。Raw captures 显示
  `/backend-api/codex/models`、WSS `/backend-api/codex/responses` 和
  `/backend-api/wham/usage` outbound requests 被重写到 pool account
  `<uuid>`，同时保留 request paths。
- 验证命令通过：`bun run lint`、`bun run test`、`bun run typecheck` 和 `bun run build`。
- Electron runtime validation 应包含 `./node_modules/.bin/electron --version`，以及通过
  Electron 运行的 `better-sqlite3` 对 `:memory:` 的查询。`postinstall` 之后，host Bun/Node
  SQLite 查询可能失败，因为 native module 有意为 Electron ABI 重建。
- 当前 daemon-core validation 通过：
  `bun test src/main/daemon/admin.test.ts src/main/daemon/cli.test.ts
  src/main/daemon/client.test.ts src/main/proxy/event-log.test.ts` 和
  `bun run typecheck:node`。
- 完整项目 Vitest validation 使用 repository test runner 通过：`bun run test` 报告 24 个
  files 和 89 个 tests passed。`service.test.ts` 特别是在 Vitest 下通过；direct `bun test`
  不是这些 Node raw socket/WebSocket upgrade tests 的受支持 runner。
- Local daemon smoke 在 `127.0.0.1:45555/backend-api` 和 admin
  `127.0.0.1:45556/admin` 通过：default mode 只把 request events 写到 SQLite，而
  `--debug` 打印可读行，例如 `HTTP响应: 401 /backend-api/codex/models (模型列表) ...`。
- 最新 security-hardening validation 通过：`bun run lint`、`bun run typecheck`、
  `bun run test`（18 files、64 tests）、`bun run build` 和 `git diff --check`。
- 现有 `codex` container 上的 Docker smoke 使用 `codex-cli 0.130.0` 对
  `host.docker.internal` 通过；后续 smoke 应使用首选 `/backend-api` 和
  `/backend-api/codex` config。
- 当前 split validation 通过 repository runner：`rtk bun run lint`、`rtk bun run typecheck`、
  `rtk bun run test`、`rtk bun run build` 和 `rtk bun run build:unpack`。unpacked macOS app
  在 `out/daemon/cli.cjs` 包含 bundled daemon entry。
- 当前 macOS packaging 已限定 Electron locales 为 `en` 和 `zh_CN`，并把 renderer-only
  dependencies 移出 runtime dependencies。`rtk bun run build:mac` 在不清理 `dist` 的情况下通过；
  产物约为 arm64 dmg `96M`、x64 dmg `97M`，两侧 `app.asar` 约 `7.9M`。详细记录见
  `docs/packaging-size-optimization.md`。
- Dev app runtime 已用 Computer Use 检查。dashboard 渲染 full-database historical request
  count、purpose distribution、proxy config，以及 animated background-service card。
- App 更新入口已接入 Velopack/GitHub release status。macOS/Windows/Linux 都使用
  Velopack `UpdateManager` 检查、下载并应用更新。macOS 产物仍然不签名、不公证；用户
  需要按需在本机允许打开或自行签名。Dashboard 显示的当前版本来自同一份 update status
  `currentVersion`，不再单独维护 `app:version` IPC。
- GitHub 仓库 `ba0gu0/CodexFree` 已创建并绑定为 `origin`。发布流程改为手动触发的
  GitHub Actions release workflow：workflow 从当前提交的 `package.json.version` 读取发布
  版本，创建 `v{version}` tag、构建 macOS 完整安装包，并为 macOS/Windows/Linux 生成
  Velopack packages 和 release feeds。发布前必须先在普通代码提交里更新并提交
  `package.json` 版本。
- 最新 release/update wiring 验证通过：`rtk bun run lint`、`rtk bun run typecheck`、
  `rtk bun run test`、`rtk bun run build`、`rtk bun run build:mac`。packaged macOS app
  bundle 不包含旧 `app-update.yml`，Velopack native `.node` 文件位于
  `app.asar.unpacked/node_modules/velopack/lib/native/`。
- `/backend-api/wham/usage` client responses 现在在内部 usage parsing 后按上游返回原样透传。
  保留的 `user_id`/`account_id` rewrite helper 仍在代码中，但未激活；上游转发和 ledger
  updates 仍使用选中的托管账号。
- `/backend-api/codex/models` client responses 现在按上游返回原样透传。未来 `/v1/models`
  API-key compatibility 必须把该 payload 转换为标准 OpenAI model-list response shape。
- 本 slice 的验证通过：
  `bun run test -- src/main/proxy/service.test.ts`、
  `bunx biome check src/main/proxy/service.ts src/main/proxy/service.test.ts`，
  以及 `bun run typecheck:node`。Direct full `bun test
  src/main/proxy/service.test.ts` 仍会命中上面描述的既有 raw socket/WebSocket failures；
  对这些 tests 使用 Vitest runner。
- 最新 daemon log-model slice 已完成。`proxy_requests` 仍然是 request-level ledger，并且现在
  存储 `summary_json`；`proxy_turn_summaries` 聚合从 user request 到 assistant completion 的一轮，
  包含 tool 和 token counts。`proxy_protocol_messages` 只持久化 error/rate-limit 等排障事件；
  常规 user、assistant、usage 和 tool 参数/结果不再作为 protocol detail rows 写入 SQLite。
  普通 `HTTP forward`、`HTTP result` 和 `WSS lifecycle` progress logs 不再持久化到
  `proxy_log_events`；quota、auth、account switching、system 和 error events 仍然会持久化。
  request UI 现在以 turn summaries 为主，并只把错误/限流协议事件作为关联明细显示。
- log-model slice 的当前验证通过：`rtk bun run lint`、`rtk bun run typecheck`、
  `rtk bun run test`（41 files、174 tests）和 `rtk git diff --check`。
- Live Docker Codex smoke 也在 isolated data dir `/tmp/codexfree-live-i757ob`、proxy `45570`
  和 admin `45571` 下通过。该历史 smoke 曾产生 HTTP catalog/usage requests、WSS protocol
  messages、assistant replies、usage summaries，以及 shell tool call/result rows；当前普通
  ledger 已收敛为核心 request rows、turn summaries 和错误/限流 protocol details。最新
  `/backend-api/wham/usage` row 记录了 proxied managed account
  以及 `primaryUsedPercent=4` 和 `primaryRemainingPercent=96`；普通 HTTP/WSS progress logs
  没有进入 `proxy_log_events`。

## 活跃风险

- `bun run daemon` 现在启动 standalone daemon entrypoint，并使用共享的
  `codexfree.sqlite` ledger。Normal mode 把结构化 events 写入 SQLite，不打印每个请求；
  `--debug` 会把同样的 events 打印为可读 operator trace。
- daemon 暴露受 token 保护的 admin endpoints，覆盖 status、config、accounts、usage
  updates、requests、request summaries、usage summaries、log events、parsed WSS protocol
  messages、delete/disable/reset account actions 和 clear-records。它有意不暴露 daemon
  lifecycle endpoints。
- proxy ledger 现在把 operator log events 存储在 `proxy_log_events`，把 turn-level user、
  assistant、tool counts 和 token usage 存储在 `proxy_turn_summaries`，并且只把错误/限流类
  protocol details 存储在 `proxy_protocol_messages`。Electron preload 暴露这些 surfaces 供
  app views 使用。
- Admin write endpoints 现在会把成功 mutations 记录到 ledger audit log。
- Request、routing、quota、protocol 和 log ledger tables 会按默认 30 天 retention window
  自动裁剪。
- Electron main process 已拆分为 runtime、IPC handlers、window bootstrap 和 Velopack/GitHub
  updater bootstrap。它不再嵌入 proxy service。它通过受 token 保护的 daemon admin API 读取
  live daemon data，并在需要时从 SQLite 读取 summary aggregates，因此 stopped-daemon UI
  refresh 不会重新启动 daemon。
- Quota-exhausted response classification 现在有 packet-level WebSocket frame evidence、
  automatic WSS parsing、persistent account state，以及 next-boundary account replacement。
- Daemon control config 已通过 Proxy 页面接线。Operators 可以编辑 management
  host/port/token，启用或禁用 OS-specific startup service ownership，并使用 app controls
  start/stop/restart 实际 process owner，而不是调用 admin lifecycle endpoints。
- API-key OpenAI-compatible forwarding 与当前默认 account-only boundary 冲突。它只能作为
  明确的 off-by-default mode 添加，并需要单独 protocol adapter。
- 如果 request boundaries 推断错误，quota switching 可能带来账号或 conversation 风险。
- Auth import/export 必须规范化多种格式，且不能把 secrets 泄露到 logs 或 UI telemetry。

## 回写规则

每次实现任务后，更新本文件和 `docs/next-tasks.md`，写入实际结果、验证命令和剩余 blockers。
