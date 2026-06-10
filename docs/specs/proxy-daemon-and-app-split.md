# 代理 Daemon 与 App 拆分

## 决策

CodexFree 应该把 forwarding service 从 Electron main process 中拆出来。proxy 变成独立的本地 daemon/CLI process，而 desktop app 变成 management console。

下一阶段推荐实现：

- proxy 保持在 Node.js / strict TypeScript 中；
- 在 `src/main/proxy` 下提取 reusable proxy core modules；
- 增加一个 standalone daemon entry，在不打开 Electron 的情况下启动 proxy；
- 让 Electron 通过 local admin API 或 local IPC channel 控制 daemon；
- 保持 SQLite 和 app-managed auth-pool directory 作为共享事实来源。

此阶段不要把 proxy 重写为 Go 或 Rust。当前困难问题是 Codex protocol routing、WSS state、account selection、quota handling、packet logging 和 UI control。语言重写会拖慢协议工作，并重复已有 TypeScript models/tests。只有在协议稳定且存在可测量 runtime bottleneck 后，才重新考虑 Go 或 Rust。

## 运行时形态

```text
Codex CLI
  -> 127.0.0.1:33333/backend-api
  -> codexfree-proxy daemon
  -> SQLite ledger + auth-pool directory
  -> chatgpt.com/backend-api

CodexFree Desktop App
  -> local admin API / IPC
  -> status/config/logs
  -> daemon lifecycle through App-owned child process or OS service manager
  -> SQLite ledger + auth-pool directory
```

Electron app 不应直接拥有 long-running forwarding socket。启动时，它应该：

1. 读取 saved config；
2. 检查 daemon 是否已经运行；
3. 显示 daemon status、listen address、active account、quota 和 recent events；
4. 只有在 operator 请求或 auto-start 启用时才 start 或 restart daemon。

## 守护进程职责

daemon 执行：

- listen host 和 port；
- `/backend-api` 下的 account-login proxy routes；
- 单独 `/v1` listener 或 port 下的可选未来 compatibility routes；
- outbound proxy settings；
- 由 SQLite account facts 驱动的 auth-pool header replacement；
- 由 SQLite account facts 驱动的 active account selection；
- quota exhaustion handling；
- WSS frame parsing 和简洁 event logging；
- request 和 protocol ledger writes；
- 启用时的 raw capture files。

daemon 启动、admin query、routing decision、usage check、token refresh 和 quota maintenance
边界都必须从 SQLite 读取账号与配置事实。daemon 不拥有权威 account/config state；它在普通开发或
生产运行中不得回退到 in-memory account status，因为那会丢失 app 已收集的 exhausted、
disabled、active 和 usage data。

允许存在的 daemon 内存数据只限于执行上下文：当前 socket、WSS probe buffer、transport
bookkeeping、短生命周期 conversation/turn binding 和调试抓包 buffer。这些数据不得作为 UI
账号数量、账号状态、active account、usage 或配置的事实来源。

## 应用职责

desktop app 拥有：

- account import/export；
- batch usage checks；
- enable/disable/reset account controls；
- config editing；
- 通过实际 process owner 执行 daemon start/stop/restart controls；
- live status display；
- request、WSS 和 quota event views；
- raw capture cleanup；
- Codex config helper text。

proxy work 独立开发时，app 应仍能运行。除非 UI 需要新的 status 或 admin API field，否则 UI work 不应要求修改 daemon hot path。

## 管理面

daemon 应暴露 local-only admin surface。首版推荐：

- bind 到 `127.0.0.1`；
- 使用存储在 app data directory 中的 random local admin token；
- 暴露 JSON endpoints 或 IPC methods：
  - `GET /admin/status`；
  - `GET /admin/config`；
  - `PUT /admin/config`；
  - `POST /admin/reload`；
  - `GET /admin/accounts`；
  - `POST /admin/accounts/sync`；
  - `POST /admin/accounts/usage`；
  - `POST /admin/accounts/reset-exhausted`；
  - `POST /admin/accounts/disable`；
  - `POST /admin/accounts/delete`；
  - `GET /admin/request-summary`；
  - `GET /admin/usage-summary`；
  - `GET /admin/requests`；
  - `GET /admin/log-events`；
  - `GET /admin/protocol-messages`；
  - `POST /admin/clear-records`。

admin surface 不得暴露 `/admin/start`、`/admin/stop` 或 `/admin/restart` 这类 daemon lifecycle endpoints。启动、停止和重启 daemon 必须由 desktop app 通过当前 process owner 处理：App-spawned child process、macOS LaunchAgent、Linux `systemctl --user` 或 Windows Service Control Manager。这能防止 UI 显示“stopped”时实际 daemon process 仍占用 listen ports。

Configuration persistence 和 application 有意分离：`PUT /admin/config` 只把配置保存到 SQLite。`POST /admin/reload` 保留为本地 daemon/admin utility，让 daemon 再次读取 SQLite 并原地 restart proxy service。desktop UI 不使用 admin endpoints 管理 process lifecycle。UI save 写入 SQLite，然后要求 app process manager 通过 configured owner 重启 daemon：App child process、macOS LaunchAgent、Linux `systemctl --user` 或 Windows `sc`。

database 是唯一 configuration source。已经运行的 listener 对 host/port 等绑定型配置会保持当前
process 已应用的值，直到 app process owner 重启 daemon，或 local admin client 显式调用 reload。
raw capture、listen host/port、upstream URL、outbound proxy、auth-pool directory、body limits
和 config monitoring 等 runtime settings 都遵循“SQLite 读取 + lifecycle 边界应用”的规则。

Account-management actions 不是 proxy configuration changes。usage updates、enable/disable、
reset exhausted、import sync 和 delete 等 admin actions 写 database；daemon 之后在 admin query、
routing decision 和维护任务边界重新读取 database。不要实现或描述“刷新 daemon 的 in-memory
account-pool cache”作为正确性要求。它们不得 restart proxy service，也不得关闭已有 upgraded
WSS sessions。

## 打包后守护进程启动

开发环境 daemon startup 使用与 packaged app 相同的 Electron Node runtime shape。daemon 先被 bundle，然后用 `ELECTRON_RUN_AS_NODE=1` 执行：

```bash
bun run daemon -- --host 0.0.0.0 --port 33333 --debug
```

该命令运行 `bun run daemon:bundle`，然后用本地 Electron binary 启动 `out/daemon/cli.cjs`。这保持本地 daemon behavior 与 packaged runtime 和 native module ABI 对齐。

Packaged builds 必须在 Electron packaging 前 bundle 一次 daemon：

```bash
bun run daemon:bundle
```

bundle output 是 `out/daemon/cli.cjs`。`electron-builder` 将该文件打进 `app.asar`；它不会自己编译 `cli.ts`。

runtime 时，已安装 app 使用已安装 Electron binary 作为 Node runtime 启动 daemon：

```bash
ELECTRON_RUN_AS_NODE=1 /Applications/CodexFree.app/Contents/MacOS/CodexFree \
  /Applications/CodexFree.app/Contents/Resources/app.asar/out/daemon/cli.cjs \
  --data-dir "$HOME/Library/Application Support/codexfree"
```

Electron main 通过 `src/main/runtime.ts` 自动执行该 spawn。spawn 必须使用 `process.execPath`，传入 packaged `cli.cjs`，并设置 `ELECTRON_RUN_AS_NODE=1`：

```ts
spawn(process.execPath, [daemonScriptPath(), '--data-dir', dataDir], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  detached: false,
  stdio: 'ignore'
})
```

operators 通常不会手动运行该命令。如果稍后添加 macOS LaunchAgent，应使用相同 command shape：

```xml
<key>ProgramArguments</key>
<array>
  <string>/Applications/CodexFree.app/Contents/MacOS/CodexFree</string>
  <string>/Applications/CodexFree.app/Contents/Resources/app.asar/out/daemon/cli.cjs</string>
  <string>--data-dir</string>
  <string>/Users/<user>/Library/Application Support/codexfree</string>
</array>
<key>EnvironmentVariables</key>
<dict>
  <key>ELECTRON_RUN_AS_NODE</key>
  <string>1</string>
</dict>
```

## 原生模块 ABI

daemon 和 tests 有意使用 Electron 的 Node runtime 运行。因此 native modules 需要 Electron ABI builds，而不是 host Bun/Node ABI。

package scripts 明确保持这一点：

```json
"postinstall": "bun node_modules/electron/install.js && electron-builder install-app-deps",
"test": "ELECTRON_RUN_AS_NODE=1 NODE_NO_WARNINGS=1 electron node_modules/vitest/vitest.mjs run",
"daemon": "bun run daemon:bundle && ELECTRON_RUN_AS_NODE=1 NODE_NO_WARNINGS=1 electron out/daemon/cli.cjs"
```

`bun node_modules/electron/install.js` 是必需的，因为 Bun 可能让 `electron` package directory 存在，但 Electron binary 不完整（缺少 `path.txt`、`dist/version` 或 `Electron.app`）。随后 `electron-builder install-app-deps` 会为已安装 Electron version rebuild native dependencies，例如 `better-sqlite3`。

验证命令：

```bash
rtk bash -lc './node_modules/.bin/electron --version'
rtk bash -lc 'ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron -p "process.versions.modules"'
rtk bash -lc 'ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron -e "const Database=require(\"better-sqlite3\"); const db=new Database(\":memory:\"); db.prepare(\"select 1\").get(); db.close(); console.log(\"electron sqlite ok\")"'
```

如果 `postinstall` 后 Bun 或 host Node 不能执行 `better-sqlite3`，这对于 Electron ABI install 是预期的。受支持的本地 daemon runtime 是带 `ELECTRON_RUN_AS_NODE=1` 的 Electron。

## 日志要求

`bun run daemon` 必须打印描述发生了什么的 event logs，而不是 raw protocol names。日志应让 operator 能重建流程：

- daemon 已启动；
- active account 已从 SQLite 加载；
- account quota summary；
- HTTP request purpose 和 result；
- WSS client 已连接；
- upstream WSS 已连接；
- user request 已开始；
- tool call 已开始 / parameters 已生成 / 已完成；
- AI reply summary；
- quota 已检测；
- account 已标记 exhausted；
- replacement account 已选择；
- HTTP fallback quota 已重试或失败。

Raw protocol frames 和 full bodies 只能进入 raw capture files 或 SQLite request ledger，不能进入普通 terminal log。

## 并行工作线

### 工作线 A：Proxy Daemon Core

拥有文件：

- `src/main/proxy/**`；
- daemon entrypoint；
- proxy tests；
- docs/specs/proxy-daemon-and-app-split.md；
- docs/specs/account-routing-and-quota-switching.md。

当前重点：

- 让 CLI 和 app 使用同一个 SQLite ledger；
- 用真实 Docker traffic 改进 terminal log event quality；
- 修复 HTTP fallback `/backend-api/codex/responses` quota retry；
- 稳定 WSS lifecycle 和 reconnect behavior；
- 保持 account selection 每次由 SQLite 中的 persisted account facts 驱动。

验证：

- `bun run lint`；
- `bun run typecheck`；
- proxy unit tests；
- Docker Codex 通过 `chatgpt_base_url` 和 `openai_base_url` 运行；
- 来自真实 Codex task 的 terminal log review。

### 工作线 B：Desktop App Console

拥有文件：

- `src/renderer/**`；
- `src/preload/**`；
- Electron IPC/admin client glue；
- docs/specs/desktop-ui.md。

当前重点：

- 展示 daemon process/reachability status；账号、配置、usage 和 quota facts 从 SQLite 展示；
- 导入账号并批量查询 usage；
- 展示 active account、quota、reset time、exhausted count；
- 暴露由实际 daemon process owner 支撑的 start/stop/restart controls；
- 展示 request 和 WSS event ledger；
- daemon code 变化时保持 UI 可用。

验证：

- `bun run lint`；
- `bun run typecheck`；
- renderer build；
- manual app launch；
- UI 可以控制已经运行的 daemon。

## 本阶段非目标

- 用 Go 或 Rust 重写 proxy core。
- 将 API-key compatibility 合并进 account-login listener。
- 构建 remote management interface。
- 在普通 logs 中记录 raw tokens 或 full auth files。
