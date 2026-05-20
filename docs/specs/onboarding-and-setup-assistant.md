# 首次引导与辅助配置界面设计

## 目标

本文用于交接 CodexFree 的首次使用引导、辅助配置界面和 Codex 登录边界设计。新会话可以直接基于本文实现。

要解决的问题：
- 新用户不知道先配置代理、Codex config、Codex 登录，还是先导入账号池。
- `~/.codex/auth.json` 容易被误解为 CodexFree 账号池文件，存在被误覆盖风险。
- 代理页、账户页、请求页有局部问题时缺少面向用户的解释和修复入口。
- 只做浮层 tour 不够，必须能检查真实状态并执行修复动作。

## 产品原则

- App 不自动覆盖、复制或替换用户的 `~/.codex/auth.json`。
- 本地 Codex 登录账号只用于让 Codex 客户端进入 ChatGPT 账号模式。
- CodexFree 代理实际使用 App 账号池，不消耗本地 Codex 登录账号额度。
- 没有自有 Codex/ChatGPT 登录账号的用户，不能被默认引导去把购买的 auth 文件写入
  `~/.codex/auth.json`。
- API-key 模式可以作为“无自有登录账号”的后续替代路径，但必须先完成抓包和协议确认。
- `config.toml` 可以由 App 写入或修复，但内容正确时不重复备份、不重复重写。
- 开机启动、Raw capture、配置监控等开关只改变配置，实际切换靠“保存并重启后生效”。
- 引导必须基于文件、数据库、daemon status、账号池的实时检测结果。

## 推荐信息架构

新增“配置助手”入口，建议放在系统页或代理页右上角；首次启动时可自动弹出。

界面分三层：
- 首次引导向导：面向新用户，按步骤推进。
- 配置助手面板：面向所有用户，随时检查当前配置并执行修复。
- 局部辅助提示：在代理页、账户页、请求页显示和当前问题相关的短提示。

第一版不建议引入重型 tour 依赖。现有 Coss/Base UI 的 Dialog、Sheet、Alert、Button、Tabs、Progress、Toast 足够实现。后续如果确实需要锚点高亮页面元素，再评估 Driver.js 或 Shepherd.js；它们只负责视觉指引，不负责配置逻辑。

## 首次引导触发

自动弹出条件：
- 本地没有完成过 onboarding 标记。
- Codex config 未指向当前代理。
- 没有任何可用账号池账号。
- 用户主动从菜单或系统页打开。

本地完成标记只能决定是否自动弹出，不能代表配置健康。每次打开助手都要重新检测真实状态。

## 向导流程

### 1. 工作方式说明

展示内容：
- CodexFree 在本机启动代理，例如 `http://127.0.0.1:<port>/backend-api`。
- Codex 客户端仍然需要用户自己完成 ChatGPT 登录，才能走账号模式。
- 本地 Codex 登录账号不会被 CodexFree 用来消耗额度。
- 代理转发时使用 CodexFree 导入的账号池。
- App 不会自动替换用户的 `auth.json`。
- 如果用户没有自己的 Codex 登录账号，第一版只能解释可选路径和风险，不自动替用户选择。

按钮：`开始配置`、`我已经配置过，进入检查`。

### 2. 代理服务检查

检测项：
- daemon 是否可连接。
- 当前运行模式：App 子进程、系统服务、未运行。
- 当前代理入口 host、port、`/backend-api` path。
- 当前上游模式：直连、HTTP、SOCKS4、SOCKS5。

可执行动作：启动代理、打开代理配置页、保存并重启后生效。

文案规则：
- 没有配置变更时，“保存并重启”置灰。
- 有任意代理配置变更时，按钮显示“配置已更改，保存并重启后生效”。
- 系统服务模式下，启动、停止、重启必须通过 launchctl/systemd/sc，不通过 admin API。

### 3. 写入 Codex config.toml

目标配置：
```toml
chatgpt_base_url = "http://127.0.0.1:<port>/backend-api"
openai_base_url = "http://127.0.0.1:<port>/backend-api/codex"
```

实现要求：
- 两行必须写在 TOML 顶层。
- 如果存在 `model_provider = ...`，删除它，不新增、不保留。
- 如果目标内容已经正确，不备份、不重写，只提示“Codex 配置已是最新”。
- 如果需要修改，先备份原文件，再写入。
- 不能把两行写进 `[profiles.xxx]` 或其他 table。

界面展示：当前检测结果、目标配置预览、写入配置按钮、打开 `~/.codex` 目录按钮。

检测结果至少区分：正确、缺失、端口不一致、写入到错误 table。

### 4. Codex auth.json 登录边界

必须明确说明：
- Codex 客户端需要自己的 `~/.codex/auth.json` 来证明用户已经登录 ChatGPT。
- 账号池授权文件技术上可能被放进 `~/.codex/auth.json` 让 Codex 以该账号运行，但这不是
  安全默认路径。
- 把账号池 auth 文件写成用户的 `~/.codex/auth.json`，可能导致 Codex Mobile 等能力不可用。
- 如果购买的 auth 文件属于他人账号，用户的本地 Codex 会变成该账号的 Codex 会话，存在被
  对方通过 Codex Mobile、远程控制或账号后台看到/控制的风险。
- App 不应该自动复制账号池授权文件到 `~/.codex/auth.json`。

推荐流程：
1. 检测 `~/.codex/auth.json` 是否存在。
2. 不存在时，引导用户通过官方 Codex 完成登录。
3. 用户想重新登录时，提供“重命名当前 auth.json 并重新登录”的入口。
4. 重命名动作必须二次确认，并显示新文件名，例如 `auth.backup-20260520-163000.json`。
5. 重命名后提示用户重启或重新打开 Codex，按官方流程登录。
6. 登录完成后回到 CodexFree 点击“重新检查”。

禁止行为：
- 自动覆盖 `~/.codex/auth.json`。
- 自动从账号池选择一个 auth 文件写入 `~/.codex/auth.json`。
- 用占位 auth 文件告诉用户“已经完成登录”。

可选辅助：打开 `~/.codex` 目录；显示 auth 文件是否存在、最后修改时间、格式是否像 Codex 登录文件。不要显示 access token、refresh token、cookie 或完整授权内容。

### 5. 没有自有登录账号时的路径

需要在助手中明确给出三种路径：

1. 推荐路径：用户用自己的 ChatGPT/Codex 账号完成官方登录，再导入购买的 auth 文件作为
   CodexFree 账号池。优点是 Codex Mobile、远程控制和本地 Codex 归属仍是自己的账号。
2. 风险路径：用户手动选择一个购买的 auth 文件作为 `~/.codex/auth.json`。App 不自动执行；
   如果未来提供入口，必须是高级选项，带强确认、风险说明和可恢复备份。
3. 后续路径：开启单独的 API-key compatibility 模式，让 Codex 用 API-key 方式访问
   CodexFree 的本地 OpenAI-compatible endpoint。该路径不需要 ChatGPT 账号登录，但通常也
   不具备 Codex Mobile 控制同一会话的能力。

当前实现要求：

- 第一版引导只支持推荐路径。
- 风险路径只写说明，不做一键替换。
- API-key compatibility 先保持未实现/未启用，等抓包确认 Codex API-key 模式请求形态后再做。

### 6. 账号模式与 API-key 模式差异

本地 `codex login --help` 已确认 Codex 支持 `--with-api-key`。但这和当前账号模式不是同一条
协议路径：

- 账号模式：Codex 使用 ChatGPT 登录态和 `~/.codex/auth.json`，请求走
  `/backend-api`、`/backend-api/codex`、WSS `/backend-api/codex/responses` 等路径。
  CodexFree 在这条路径上做透明代理，只替换上游账号池 auth，不改请求 body。
- API-key 模式：Codex 使用 API key，预期请求是 OpenAI-compatible `/v1/*` 形态，例如
  models、responses 或 chat completions。CodexFree 不能直接透明转发，必须做 adapter：本地
  API key 校验、请求转换、上游账号 WSS 调用、响应转换。
- 因为 API-key 模式的实际路径、headers、streaming 形态和错误行为需要抓包确认，不能只凭
  推测打开。后续实现必须先抓包，再更新 `docs/specs/v1-compatibility-adapter.md`，再编码。

### 7. 账号池导入

检测项：
- 已导入账号数、可用账号数、禁用账号数、额度耗尽账号数。
- 最近一次用量检查时间。

可执行动作：
- 导入授权文件或目录。
- 查询选中账号用量。
- 查询全部账号用量。
- 打开账户页。

关键文案：
- “账号池是 CodexFree 代理转发使用的账号来源。”
- “本地 Codex 登录账号不参与 CodexFree 路由，也不会被 CodexFree 消耗额度。”

### 8. 完成检查

完成条件：
- daemon 正在运行。
- `config.toml` 指向当前代理端口。
- `auth.json` 存在且看起来是 Codex 登录文件。
- 至少有一个可用账号池账号。
- 最近一次 models 请求或用量查询成功。

完成页展示：当前代理入口、当前运行模式、可用账号数、当前可用模型数、打开总览按钮、打开请求检查器按钮。失败时必须显示具体失败项，不要只显示“配置失败”。

## 配置助手面板

配置助手是可重复打开的状态面板，不只用于首次安装。建议分区：
- 代理服务：运行状态、端口、系统服务/子进程、启动/停止/重启。
- Codex 配置：config.toml 状态、写入状态、配置监控状态。
- Codex 登录：auth.json 是否存在，是否建议重新登录。
- 账号池：账号数量、可用账号、用量检查。
- 诊断：最近错误、打开日志、打开数据目录。

每个分区都应包含当前状态、影响说明、可执行动作和最近检查时间。

## 局部辅助提示

代理页：
- 配置变更未保存时显示“配置已更改，保存并重启后生效”。
- 系统服务已启动但 App 不能直接停止时，只提示“后台服务已启动，请自行检查”，不要显示 ps 查询结果。

账户页：
- 表格选中账号后批量查询，只查询选中账号。
- 未选中账号时才查询全局。
- 空状态引导导入账号池，不引导修改本地 `auth.json`。

请求页：
- 如果用户消息没有解析出来，提示可能是压缩 SSE 或 WSS 解析问题，并引导查看请求详情。
- 表格必须虚拟渲染，避免历史请求多时页面卡顿。

## UI 状态存储

建议新增或复用本地设置：
- `onboarding.completedAt`
- `onboarding.lastStep`
- `setupAssistant.lastCheckedAt`
- `setupAssistant.dismissedWarnings`

这些字段只记录 UI 状态，不能作为配置正确性的唯一依据。

## 验收标准

- 首次打开时，用户能按引导完成代理、config、auth 登录检查、账号池导入。
- App 不会自动覆盖或复制 `~/.codex/auth.json`。
- config.toml 正确时不会重复备份或重写。
- 没有自有账号时，助手清楚区分推荐路径、风险路径和未来 API-key 路径。
- API-key compatibility 未完成抓包前，不在 UI 中宣传为已可用能力。
- 端口变化后，引导和配置助手显示的代理入口与数据库和 daemon 状态一致。
- 系统服务和子进程模式的启动、停止、重启文案和行为一致，不误导用户。
- 没有账号池时，用户明确知道下一步是导入账号池，而不是修改本地 auth。
- 用 Computer Use 在最小窗口下检查：向导、配置助手、代理页提示都不遮挡、不溢出。

## 实现切片建议

1. 做状态检测模型和 i18n 文案，不做 UI。
2. 做配置助手 Sheet，接入真实检测和页面跳转。
3. 做首次引导 Dialog/Wizard，复用配置助手检测模型。
4. 做 `auth.json` 重命名登录辅助入口，必须加确认弹窗。
5. 增加“无自有账号”说明页，但不实现账号池 auth 一键写入 `auth.json`。
6. API-key compatibility 单独排期：先抓包，再更新协议设计，再实现。
7. 给代理页、账户页、请求页补局部辅助提示。
8. 用 Vitest 覆盖关键状态判断，用 Computer Use 验证真实窗口。
