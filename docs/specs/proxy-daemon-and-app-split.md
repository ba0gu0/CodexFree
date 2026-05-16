# Proxy Daemon And App Split

## Decision

CodexFree should split the forwarding service from the Electron main process.
The proxy becomes a standalone local daemon/CLI process, while the desktop app
becomes a management console.

Recommended implementation for the next phase:

- keep the proxy in Node.js / strict TypeScript;
- extract reusable proxy core modules under `src/main/proxy`;
- add a standalone daemon entry that starts the proxy without opening Electron;
- let Electron control the daemon through a local admin API or local IPC channel;
- keep SQLite and the app-managed auth-pool directory as the shared source of
  truth.

Do not rewrite the proxy in Go or Rust at this stage. The current hard problems
are Codex protocol routing, WSS state, account selection, quota handling,
packet logging, and UI control. A language rewrite would slow protocol work and
duplicate the existing TypeScript models/tests. Go or Rust can be revisited only
after the protocol is stable and there is a measured runtime bottleneck.

## Runtime Shape

```text
Codex CLI
  -> 127.0.0.1:33333/backend-api
  -> codexfree-proxy daemon
  -> SQLite ledger + auth-pool directory
  -> chatgpt.com/backend-api

CodexFree Desktop App
  -> local admin API / IPC
  -> start/stop/status/config/logs
  -> SQLite ledger + auth-pool directory
```

The Electron app should not own the long-running forwarding socket directly.
On startup, it should:

1. read saved config;
2. check whether the daemon is already running;
3. show daemon status, listen address, active account, quota, and recent events;
4. start or restart the daemon only when the operator asks or when auto-start is
   enabled.

## Daemon Responsibilities

The daemon owns:

- listen host and port;
- account-login proxy routes under `/backend-api`;
- optional future compatibility routes under a separate `/v1` listener or port;
- outbound proxy settings;
- auth-pool takeover;
- active account selection;
- quota exhaustion handling;
- WSS frame parsing and concise event logging;
- request and protocol ledger writes;
- raw capture files when enabled.

The daemon must read persisted SQLite account state on startup. It must not fall
back to in-memory account status in normal development or production runs,
because that loses exhausted, disabled, active, and usage data already collected
by the app.

## App Responsibilities

The desktop app owns:

- account import/export;
- batch usage checks;
- enable/disable/reset account controls;
- config editing;
- daemon start/stop/restart controls;
- live status display;
- request, WSS, and quota event views;
- raw capture cleanup;
- Codex config helper text.

The app should be able to run while proxy work is being developed separately.
UI work must not require changing the daemon hot path unless the UI needs a new
status or admin API field.

## Admin Surface

The daemon should expose a local-only admin surface. Preferred first version:

- bind to `127.0.0.1`;
- use a random local admin token stored in the app data directory;
- expose JSON endpoints or IPC methods for:
  - `GET /admin/status`;
  - `POST /admin/start`;
  - `POST /admin/stop`;
  - `POST /admin/restart`;
  - `GET /admin/config`;
  - `PUT /admin/config`;
  - `GET /admin/accounts`;
  - `POST /admin/accounts/sync`;
  - `POST /admin/accounts/usage`;
  - `POST /admin/accounts/reset-exhausted`;
  - `POST /admin/accounts/disable`;
  - `POST /admin/accounts/delete`;
  - `GET /admin/requests`;
  - `GET /admin/log-events`;
  - `GET /admin/protocol-messages`;
  - `POST /admin/clear-records`.

## Packaged Daemon Startup

Development daemon startup uses the same Electron Node runtime shape as the
packaged app. The daemon is bundled first, then executed with
`ELECTRON_RUN_AS_NODE=1`:

```bash
bun run daemon -- --host 0.0.0.0 --port 33333 --debug
```

That command runs `bun run daemon:bundle` and then starts `out/daemon/cli.cjs`
with the local Electron binary. This keeps local daemon behavior aligned with
the packaged runtime and native module ABI.

Packaged builds must bundle the daemon once before Electron packaging:

```bash
bun run daemon:bundle
```

The bundle output is `out/daemon/cli.cjs`. `electron-builder` packages that file
inside `app.asar`; it does not compile `cli.ts` by itself.

At runtime, the installed app starts the daemon with the installed Electron
binary as a Node runtime:

```bash
ELECTRON_RUN_AS_NODE=1 /Applications/CodexFree.app/Contents/MacOS/CodexFree \
  /Applications/CodexFree.app/Contents/Resources/app.asar/out/daemon/cli.cjs \
  --data-dir "$HOME/Library/Application Support/codexfree"
```

Electron main performs this spawn automatically through `src/main/runtime.ts`.
The spawn must use `process.execPath`, pass the packaged `cli.cjs`, and set
`ELECTRON_RUN_AS_NODE=1`:

```ts
spawn(process.execPath, [daemonScriptPath(), '--data-dir', dataDir], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  detached: false,
  stdio: 'ignore'
})
```

Operators normally do not run the command by hand. A macOS LaunchAgent, if
added later, should use the same command shape:

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

## Native Module ABI

The daemon and tests intentionally run with Electron's Node runtime. Native
modules therefore need Electron ABI builds, not the host Bun/Node ABI.

The package scripts keep this explicit:

```json
"postinstall": "bun node_modules/electron/install.js && electron-builder install-app-deps",
"test": "ELECTRON_RUN_AS_NODE=1 NODE_NO_WARNINGS=1 electron node_modules/vitest/vitest.mjs run",
"daemon": "bun run daemon:bundle && ELECTRON_RUN_AS_NODE=1 NODE_NO_WARNINGS=1 electron out/daemon/cli.cjs"
```

`bun node_modules/electron/install.js` is required because Bun can leave the
`electron` package directory present while the Electron binary is incomplete
(`path.txt`, `dist/version`, or `Electron.app` missing). `electron-builder
install-app-deps` then rebuilds native dependencies such as `better-sqlite3`
for the installed Electron version.

Validation commands:

```bash
rtk bash -lc './node_modules/.bin/electron --version'
rtk bash -lc 'ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron -p "process.versions.modules"'
rtk bash -lc 'ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron -e "const Database=require(\"better-sqlite3\"); const db=new Database(\":memory:\"); db.prepare(\"select 1\").get(); db.close(); console.log(\"electron sqlite ok\")"'
```

If Bun or host Node cannot execute `better-sqlite3` after `postinstall`, that is
expected for an Electron ABI install. The supported local daemon runtime is
Electron with `ELECTRON_RUN_AS_NODE=1`.

## Logging Requirement

`bun run proxy` must print event logs that describe what happened, not raw
protocol names. The log should let an operator reconstruct the flow:

- daemon started;
- active account loaded from SQLite;
- account quota summary;
- HTTP request purpose and result;
- WSS client connected;
- upstream WSS connected;
- user request started;
- tool call started / parameters generated / completed;
- AI reply summary;
- quota detected;
- account marked exhausted;
- replacement account selected;
- HTTP fallback quota retried or failed.

Raw protocol frames and full bodies belong only in raw capture files or the
SQLite request ledger, not in the normal terminal log.

## Parallel Work Lines

### Work Line A: Proxy Daemon Core

Owned files:

- `src/main/proxy/**`;
- daemon entrypoint;
- proxy tests;
- docs/specs/proxy-daemon-and-app-split.md;
- docs/specs/account-routing-and-quota-switching.md.

Current focus:

- make CLI and app use the same SQLite ledger;
- improve terminal log event quality with real Docker traffic;
- fix HTTP fallback `/backend-api/codex/responses` quota retry;
- stabilize WSS lifecycle and reconnect behavior;
- keep account selection driven by persisted account state.

Verification:

- `bun run lint`;
- `bun run typecheck`;
- proxy unit tests;
- Docker Codex run through `chatgpt_base_url` and `openai_base_url`;
- terminal log review from a real Codex task.

### Work Line B: Desktop App Console

Owned files:

- `src/renderer/**`;
- `src/preload/**`;
- Electron IPC/admin client glue;
- docs/specs/desktop-ui.md.

Current focus:

- show daemon status instead of assuming in-process proxy state;
- import accounts and batch query usage;
- show active account, quota, reset time, exhausted count;
- expose start/stop/restart controls;
- show request and WSS event ledger;
- keep UI usable while daemon code changes.

Verification:

- `bun run lint`;
- `bun run typecheck`;
- renderer build;
- manual app launch;
- UI can control an already-running daemon.

## Non-Goals For This Phase

- Rewriting proxy core in Go or Rust.
- Merging API-key compatibility into the account-login listener.
- Building a remote management interface.
- Logging raw tokens or full auth files in normal logs.
