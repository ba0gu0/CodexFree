# Current State

## Phase

Account-login proxy core stage.

The directory was empty at initialization time. The Electron/Vite project has
now been initialized with the confirmed stack, package manifest, linting,
typechecking, testing, i18n, database schema seed, local unpack build path, and
the first transparent proxy service.

## Confirmed Product Direction

CodexFree is an Electron-based desktop system for managing Codex account auth
files and running a local proxy that is compatible with Codex account-login
traffic.

Core behavior:

- Codex account-login mode is configured with:
  - `chatgpt_base_url = "http://127.0.0.1:33333/backend-api"`.
  - `openai_base_url =
    "http://127.0.0.1:33333/backend-api/codex"`.
- A local placeholder `~/.codex/auth.json` is generated for Codex.
- The proxy does not verify that placeholder token.
- The proxy forwards Codex requests without modifying the request body.
- The proxy forwards local Codex `/backend-api/codex/*` traffic to ChatGPT
  account-mode upstream paths under `https://chatgpt.com/backend-api/codex`.
- `/v1/*` is reserved for the future explicit API-key compatibility surface,
  not the documented account-login proxy config.
- When `authPool.enabled` is true, the proxy replaces only upstream
  `Authorization` and `chatgpt-account-id` from managed account files.
- The transparent MVP records redacted request metadata and can optionally write
  raw local debug captures into the system temp directory.
- Raw capture now includes WebSocket frame JSONL files for upgraded
  `/backend-api/codex/responses` traffic.
- Auth-pool takeover is explicit. Imported accounts do not automatically enable
  routing replacement until the operator enables the pool and saves config.
- The proxy now parses decoded upstream WebSocket text frames and marks matching
  `usage_limit_reached` requests as `quota_exhausted` in the request ledger.
- Auth-pool routing now supports an explicit `authPool.enabled` config and a
  single app-managed import directory. Users cannot point the runtime at an
  arbitrary auth directory. When enabled, the proxy loads normalized imported
  auth files, replaces only upstream `Authorization` and `chatgpt-account-id`,
  binds accounts by conversation key, and switches the next request boundary
  after a WSS quota event.
- New WSS requests that immediately hit `usage_limit_reached` can be retried
  upstream without forwarding the quota frame to Codex. The client socket stays
  open only when the buffered `response.create` frame is self-contained: no
  `previous_response_id` and a non-empty `input` array. If the frame depends on
  prior upstream response state, the proxy suppresses the quota frame, marks the
  account exhausted, and then checks whether another account remains available.
  If another account exists, it closes the client WSS so Codex reconnects and
  resends its own complete context. If no replacement account exists, it forwards
  the final `usage_limit_reached` frame to Codex.
- Already-open client WSS connections re-enter a per-turn probe window when a
  new `response.create` frame arrives. If quota arrives before any non-quota
  upstream frame, the same self-contained replay rule applies; otherwise the
  stream has begun normally and later quota remains a terminal session outcome.
- The proxy does not persist a complete structured conversation transcript for
  cross-account reconstruction. Raw WebSocket captures and in-memory probe
  buffers are debug/retry aids, not a durable message-history model.
- Usage queries are forwarded with the currently bound/default available account
  and return real upstream usage. The proxy does not fabricate a constant 100%
  usage response.
- `/backend-api/wham/remote` and its child paths are transparent exceptions:
  the proxy preserves the original Codex `Authorization` and
  `chatgpt-account-id` headers instead of replacing them from the managed
  auth pool on both HTTP and WSS upgrade traffic.
- Account availability is now persisted in SQLite. The proxy syncs loaded auth
  files into `proxy_accounts`, records route decisions in
  `proxy_routing_events`, and records quota exhaustion details in
  `proxy_quota_events`. Restarted services reload persisted exhausted accounts
  before routing new requests.
- Imported account management now supports batch import, batch usage checks,
  export, 401 cleanup, per-account disable/enable, and exhaustion reset from
  the Electron management surface. Import, usage checks, and runtime routing all
  use the same app-managed auth-pool directory.
- In-memory conversation bindings are pruned after 24 hours so old sessions do
  not permanently reserve accounts.
- Proxy forwarding does not refresh managed ChatGPT tokens. It only classifies
  upstream account outcomes such as quota exhaustion, token expiry, or account
  unavailability; the main app account-maintenance flow owns refresh and
  recovery.
- In-progress WebSocket streams keep their original auth. The proxy must not
  rewrite auth on an already-upgraded WSS connection.
- A session becomes eligible for auth replacement only after the upstream WSS
  stream returns a structured `usage_limit_reached` quota error. Network
  disconnects, local `EPIPE`, proxy restarts, and Yakit/MITM failures do not
  count as quota exhaustion.
- API-key mode requests are rejected unless a future explicit compatibility
  switch is enabled. That mode is separate from Codex account-login forwarding.

## Confirmed Toolchain

- Scale: Medium.
- Runtime: Bun.
- Language: strict TypeScript.
- Desktop framework: Electron with Vite.
- Frontend: React 19.
- UI: Tailwind CSS, shadcn-style Coss UI, Base UI primitives, `lucide-react`.
- Database: SQLite with Drizzle ORM.
- Tests: Vitest first; Playwright can be added later for UI and Electron flows.
- Proxy runtime: `bun run daemon` bundles `src/main/daemon/cli.ts` to
  `out/daemon/cli.cjs` and runs it through Electron's Node runtime with
  `ELECTRON_RUN_AS_NODE=1`. Packaged builds use the same `cli.cjs` path inside
  `app.asar`; Electron main controls it through the local token-protected admin
  API.
- Native module runtime: local daemon, packaged daemon, and Vitest are aligned
  to Electron's Node ABI. `postinstall` explicitly runs
  `bun node_modules/electron/install.js` before `electron-builder
  install-app-deps` so the Electron binary exists and native modules such as
  `better-sqlite3` are rebuilt for Electron.
- Documentation modules: current docs are kept, ADR is enabled, independent task
  cards are not enabled.
- Renderer is intentionally back at the initial shell stage while the app UI is
  planned for a clean refactor. Existing Coss/shadcn component source may remain
  under `components/ui/`, but page modules, derived-data helpers, and locale
  copy tables are not considered complete until the next renderer slice lands.

## Completed Initialization

- Merged the `@quick-start/electron` React TypeScript scaffold into the project
  root and removed the nested `my-app` directory.
- Replaced ESLint and Prettier with Biome.
- Added Paraglide JS with `zh-CN` base locale and `en` fallback messages.
- Added Tailwind CSS v4, Coss/shadcn-compatible `components.json`, Base UI
  selection record, and `lucide-react`.
- Added TanStack Query, TanStack Form, Valibot, Drizzle ORM, SQLite driver, and
  `electron-log`.
- Restored `electron-updater` and GitHub publish/update configuration because
  update checking is enabled for future GitHub releases.
- Added a metadata-only SQLite schema seed and Vitest coverage for auth-secret
  exclusion in account records.
- Verified the initial Electron shell path earlier; current app UI should be
  treated as initial mode until the renderer refactor is implemented.
- Added `proxy-agent` for outbound direct, HTTP, HTTPS, SOCKS4, and SOCKS5 proxy
  modes.
- Added a transparent forwarding service with configurable listen host, listen
  port, upstream base URL, outbound proxy mode, redacted logs, and SQLite request
  ledger fields.
- Added pre-forward request classification so only known Codex account-mode
  backend paths are forwarded, while API-key mode and unknown paths are rejected
  locally.
- The default listen target is `127.0.0.1:33333`. Docker or LAN validation must
  opt in with an explicit host override such as `--host 0.0.0.0`.
- Added an explicit raw-capture debug switch that writes four protocol-shaped
  `.http` packet files outside the repository under the app data
  `raw-captures` directory.
- Proxy request bodies are capped by `maxRequestBodyBytes`; oversized bodies are
  rejected locally with HTTP 413 before upstream forwarding.
- Added WebSocket frame capture for upgraded responses traffic, including
  `permessage-deflate` decoding for readable upstream error messages.
- Added proxy IPC and daemon control surfaces for host, port, upstream,
  outbound proxy, raw capture, service status, raw capture directory, and recent
  request observations. The renderer UI for these controls is pending refactor.
- Added the first auth-file normalization module for Codex native auth files and
  flat Codex/CPA-compatible token records.
- Added the first in-memory account pool router with per-conversation binding,
  quota exhaustion marking, and next-boundary replacement.
- The renderer is in initial mode. `docs/CodexFree-v2.pen` and the preview
  assets are design references only; Dashboard, Accounts, Proxy, Requests, and
  Usage pages still need to be rebuilt in the planned renderer refactor.

## Known Missing Inputs

- More real-world sub2api variants beyond flat Codex-token-compatible records.
- Secure encrypted or platform-protected auth storage.
- Packaging/signing requirements for macOS.
- Earlier validation could not bind port `55555`; normal local development now
  uses `127.0.0.1:33333`, while Docker validation can temporarily override the
  host to `0.0.0.0`.
- The existing `codex` Docker container has `codex-cli 0.130.0` installed and
  can reach the Mac proxy through `host.docker.internal`. Host-side Codex can
  use `127.0.0.1`; LAN or VM clients can replace only the host with the
  computer IP address while keeping `/backend-api` paths unchanged.

## Current Verification

- `bun run lint`
- `bun run typecheck`
- `bun run test`
- `bun run build`
- `bun run build:unpack`
- Transparent proxy integration test forwards request bodies and records
  redacted ledger metadata.
- Manual local curl through `http://127.0.0.1:33333/backend-api/codex` reached
  the transparent service and preserved the request body.
- Manual Docker Node fetch through
  `http://host.docker.internal:33333/backend-api/codex` reached the Mac service.
- `docker exec codex codex -V` returned `codex-cli 0.130.0`.
- `test/History-1778577142774.har` confirmed the standard Codex account-mode
  upstream host is `chatgpt.com` and the primary model surfaces are
  `/backend-api/codex/models` and `/backend-api/codex/responses`.
- Earlier `codex exec` from the `codex` container was tested with `/v1`
  OpenAI-compatible local paths. That path family is now API-key compatibility
  scope, not the account-login proxy default.
- The provided flat auth template had to be normalized into Codex CLI native
  `auth.json` shape before Codex emitted `authorization` and
  `chatgpt-account-id` headers.
- Earlier `codex exec` through `/v1` completed successfully only because `/v1`
  was temporarily treated as an OpenAI-compatible mapping. That should now be
  considered API-key compatibility scope, not account-login default behavior.
- `codex exec` was also verified with the preferred config
  `chatgpt_base_url = "http://host.docker.internal:33333/backend-api"` and
  `openai_base_url =
  "http://host.docker.internal:33333/backend-api/codex"`; this keeps
  Codex-to-proxy model traffic on `/backend-api/codex/models` and
  `/backend-api/codex/responses`.
- `test/History-1778652315307.har` plus temp raw captures confirmed successful
  local entries for `models`, `responses`, `analytics-events`, `connectors`,
  `wham/apps`, and `plugins/featured`.
- For all non-primary auxiliary interfaces analyzed from that HAR, CodexFree
  preserved request lines, bodies, selected auth/protocol headers, and response
  packets; the only intentional request-header difference was `Host:
  10.211.55.2:33333` becoming `Host: chatgpt.com`.
- Raw capture now writes exactly four protocol-shaped packet files per request:
  `codex-inbound-request.http`, `codex-downstream-response.http`,
  `chatgpt-outbound-request.http`, and `chatgpt-upstream-response.http`.
- Auth normalization tests cover native Codex `auth.json`, flat token records,
  CPA filename inference, and malformed-file errors without including secret
  values in error messages.
- The request ledger now stores `chatgpt-account-id` as account metadata and
  `thread_id` / `session_id` / `x-client-request-id` as conversation metadata.
- Real usage-limit samples were captured through CodexFree. The visible HTTP
  layer still returned WebSocket `101`; the quota error was decoded from
  `websocket-upstream-to-codex.frames.jsonl`.
- The decoded usage-limit WebSocket frame contains `type: "error"`,
  `error.type: "usage_limit_reached"`, `status_code: 429`,
  `X-Codex-Plan-Type: free`, `X-Codex-Active-Limit: premium`, and
  `X-Codex-Primary-Used-Percent: 100`.
- `test/History-1778683339690.har` and raw captures confirm that Codex opens a
  WSS `/backend-api/codex/responses` channel after starting a session/turn, and
  subsequent turn traffic can be carried over WSS. Quota exhaustion is a WSS
  application message, not a transport close reason by itself.
- Unit coverage now verifies that decoded WSS `usage_limit_reached` events are
  parsed and update the proxied WSS request outcome to `quota_exhausted`.
- Four free-account `hi` runs were captured under
  `test/raw-captures/account-hi`. Across accounts, only `Authorization` and
  `chatgpt-account-id` are account identity fields that must be replaced.
  `thread_id`, `session_id`, `x-client-request-id`, `x-codex-window-id`,
  `x-codex-turn-metadata`, and `sec-websocket-key` are session/request
  boundary fields and must not be copied from auth files.
- A same-session account-switch sample was captured under
  `test/raw-captures/same-session-account-switch`. Three different auth files
  were used with `codex exec resume` on the same thread id
  `019e<thread-redacted>`; all three turns completed and the
  conversation/session/window headers stayed unchanged while only
  `Authorization` and `chatgpt-account-id` changed.
- Account-pool unit coverage verifies that a shared conversation uses account A
  for the first WSS request, marks A exhausted from a decoded
  `usage_limit_reached` frame, and uses account B on the next WSS request.
- WSS retry unit coverage verifies that an initial upstream quota frame is not
  forwarded to the client when another account is available; the replacement
  account's normal response frame is forwarded instead.
- Docker validation on Codex CLI `0.130.0` used a container inbound account
  `<uuid>` with a three-account local pool. Raw
  captures show `/backend-api/codex/models`, WSS
  `/backend-api/codex/responses`, and `/backend-api/wham/usage` outbound
  requests rewritten to pool account
  `<uuid>` while preserving request paths.
- Validation commands passed: `bun run lint`, `bun run test`, `bun run
  typecheck`, and `bun run build`.
- Electron runtime validation should include `./node_modules/.bin/electron
  --version` and an Electron-run `better-sqlite3` query against `:memory:`.
  A host Bun/Node SQLite query may fail after `postinstall` because the native
  module is intentionally rebuilt for Electron ABI.
- Current daemon-core validation passed:
  `bun test src/main/daemon/admin.test.ts src/main/daemon/cli.test.ts
  src/main/daemon/client.test.ts src/main/proxy/event-log.test.ts` and
  `bun run typecheck:node`.
- Full project Vitest validation passed with the repository test runner:
  `bun run test` reported 14 files and 48 tests passed. `service.test.ts`
  specifically passes under Vitest; direct `bun test` is not the supported
  runner for these Node raw socket/WebSocket upgrade tests.
- Local daemon smoke passed on `127.0.0.1:45555/backend-api` and admin
  `127.0.0.1:45556/admin`: default mode wrote request events only to SQLite,
  while `--debug` printed readable lines such as
  `HTTP响应: 401 /backend-api/codex/models (模型列表) ...`.
- Latest security-hardening validation passed: `bun run lint`,
  `bun run typecheck`, `bun run test` (18 files, 64 tests), `bun run build`,
  and `git diff --check`.
- Docker smoke on the existing `codex` container passed with
  `codex-cli 0.130.0` against `host.docker.internal`; a later smoke should use
  the preferred `/backend-api` and `/backend-api/codex` config.
- Current split validation passed: `bun run lint`, `bun run typecheck`,
  `bun run test`, `bun run build`, `bun run daemon:bundle`, and
  `bun run build:unpack`. The unpacked macOS app contains the bundled daemon
  entry at `out/daemon/cli.cjs`.
- Unpacked app at `dist/mac-arm64/CodexFree.app` launches; Computer Use window
  inspection timed out in this run.
- Unpacked app includes `app-update.yml`; GitHub update-check failures are logged
  as sanitized summaries.
- `/backend-api/wham/usage` client responses are now passed through exactly as
  returned by upstream after internal usage parsing. The preserved
  `user_id`/`account_id` rewrite helper remains in code but is not active;
  upstream forwarding and ledger updates still use the selected managed account.
- `/backend-api/codex/models` client responses are now passed through exactly as
  returned by upstream. Future `/v1/models` API-key compatibility must convert
  this payload into the standard OpenAI model-list response shape.
- Verification for this slice passed:
  `bun run test -- src/main/proxy/service.test.ts`,
  `bunx biome check src/main/proxy/service.ts src/main/proxy/service.test.ts`,
  and `bun run typecheck:node`. Direct full `bun test
  src/main/proxy/service.test.ts` still hits the existing raw socket/WebSocket
  failures described above; use the Vitest runner for those tests.

## Active Risks

- `bun run proxy` now starts the standalone daemon entrypoint and uses the
  shared `codexfree.sqlite` ledger. Normal mode writes structured events to
  SQLite without printing every request; `--debug` prints the same events as a
  readable operator trace.
- The daemon exposes token-protected admin endpoints for status, config,
  accounts, usage updates, requests, log events, parsed WSS protocol messages,
  start, restart, stop, delete/disable/reset account actions, and clear-records.
- The proxy ledger now stores operator log events in `proxy_log_events` and
  parsed WSS user/assistant/tool/error summaries in `proxy_protocol_messages`.
  Electron preload exposes both surfaces for future app views.
- Admin write endpoints now record successful mutations in the ledger audit log.
- Request, routing, quota, protocol, and log ledger tables are pruned
  automatically with a 30-day default retention window.
- Electron main process has been split into runtime, IPC handlers, window
  bootstrap, and updater bootstrap. It no longer imports the SQLite ledger or
  embedded proxy service. It talks to the token-protected daemon admin API for
  status, restart, config-save, import sync, usage updates, reset, and
  per-account disable/delete actions.
- Quota-exhausted response classification now has packet-level WebSocket frame
  evidence, automatic WSS parsing, persistent account state, and next-boundary
  account replacement. UI import/export wiring is still pending.
- API-key OpenAI-compatible forwarding conflicts with the current default
  account-only boundary. It should be added only as an explicit off-by-default
  mode with a separate protocol adapter.
- Quota switching can cause account or conversation risk if request boundaries
  are inferred incorrectly.
- Auth import/export must normalize multiple formats without leaking secrets to
  logs or UI telemetry.

## Write-Back Rule

After every implementation task, update this file and `docs/next-tasks.md` with
the actual result, verification command, and remaining blockers.
