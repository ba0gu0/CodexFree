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
- Account-pool routing is the normal forwarding mode. The proxy replaces only
  upstream `Authorization` and `chatgpt-account-id` from managed account files.
- The transparent MVP records redacted request metadata and can optionally write
  raw local debug captures into the system temp directory.
- Raw capture now includes WebSocket frame JSONL files for upgraded
  `/backend-api/codex/responses` traffic.
- `docs/proxy-traffic-analysis.md` now records the current GET/POST capture
  inventory, token usage extraction sources, request/protocol ledger fields,
  and UI usage recommendations. Use it as the cross-session reference for
  request, usage, overview, and account page data-source optimization.
- Auth-pool takeover is always on for account-mode proxying. Imported accounts
  are loaded from the single app-managed directory; there is no UI or CLI switch
  for disabling the pool.
- The proxy now parses decoded upstream WebSocket text frames and marks matching
  `usage_limit_reached` requests as `quota_exhausted` in the request ledger.
- Auth-pool routing now uses a single app-managed import directory. Users cannot
  point the runtime at an arbitrary auth directory. The proxy loads normalized
  imported auth files, replaces only upstream `Authorization` and
  `chatgpt-account-id`, binds accounts by conversation key, and switches the
  next request boundary
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
- Imported account metadata now persists email in SQLite `proxy_accounts` and
  backfills auth files when a usage check returns or decodes an email address.
  Operator log rows persist a typed `event_type` so the UI can distinguish
  normal requests, account switching, network issues, quota issues, auth issues,
  and system mutations.
- Electron startup now reads daemon management host, port, and admin token from
  SQLite `proxy_settings`, tries the configured admin endpoint first, and only
  spawns the daemon when that endpoint is not reachable.
- Daemon lifecycle is owned by the Electron app process or the operating-system
  service manager, not by daemon admin HTTP endpoints. The admin surface no
  longer exposes `/admin/start`, `/admin/stop`, or `/admin/restart`; app
  start/stop/restart controls use the configured LaunchAgent, systemd user
  service, Windows service, or the app-owned child process and report
  diagnostics when the daemon was started outside the app.
- Proxy configuration is durable only in SQLite `proxy_settings`. Saving config
  from the desktop UI writes SQLite first, then the App process manager restarts
  the daemon through the configured owner: App child process, LaunchAgent,
  systemd user service, or Windows service. Direct database edits do not change
  a running daemon until the App owner restarts it or a local admin client calls
  the retained `/admin/reload` utility endpoint.
- Account-management actions write SQLite and then refresh only the daemon's
  in-memory account-pool cache. They do not restart the proxy service and do not
  close existing WSS sessions.
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
- Renderer has been refactored onto the V3 desktop shell with the new
  top-level navigation, dashboard, account, proxy, request, and data-analysis
  pages wired through the daemon/admin API. The dashboard overview has completed
  the V3 detail pass: header order, three-column shell, status strip, proxy and
  account-pool cards, recent activity table, and right inspector now follow the
  `docs/CodexFree-v3.pen` overview mockup. The account, proxy, request, and
  data-analysis pages now share the same desktop-console treatment with summary
  strips, scan-friendly tables, contextual side panels, and masked/local-only
  operational details. Daemon management settings live inside the Proxy page
  rather than a separate settings page. Destructive local actions such as
  request-ledger clearing and placeholder `auth.json` writing now require
  confirmation dialogs. The selected UI language is synchronized into native
  import/export dialogs and both language and theme preferences persist locally.
  The desktop window opens at the same `1160x720` size as its minimum; the
  overview shell is fixed-height at that size, keeps the V3 three-column
  structure with proportional side rails, and confines Recent Activity scrolling
  to the table body without horizontal scrolling or a fixed row slice.
  The latest overview pass also removes the top-strip recent-event tile, changes
  the system utility button into a `system -> dark -> light` theme cycle, shows
  categorized recent events instead of alarm text, removes the account-health
  progress bar, formats proxy config rows without wrapping at `=`, and uses
  account email metadata instead of synthetic `codex:<account-id>` labels.
  `/backend-api/wham/remote/*` rows are explicitly marked as the original Codex
  account because that route preserves the user's configured upstream auth.
  The latest remaining-page polish pass aligns Accounts, Proxy, Requests, and
  Usage with the overview style: compact headers, semantic light/dark borders,
  fixed-height desktop content, virtualized multi-row tables, and no duplicate
  proxy-copy or related-context blocks on the Proxy page.
  The latest data-display pass aligns renderer DTOs, derived models, Overview,
  Accounts, Requests, and Usage with `docs/proxy-traffic-analysis.md`: request
  purpose, model, content metadata, Codex thread/turn/runtime fields, usage
  source, cached input tokens, token breakdowns, and protocol-message fields are
  now visible where relevant. Requests keeps time/status/purpose/method-path/
  account/model/tokens/duration/bytes visible at `1160x720`, and Usage groups
  real token records by source, model, account, day, and thread/turn without
  estimating missing usage. The latest interaction pass also gives list views
  sticky sortable headers, removes request-page auto-polling in favor of manual
  refresh plus refresh-on-navigation, and keeps account usage checks on explicit
  buttons with progress rendered on the initiating button.

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
- Verified the Electron renderer after the V3 shell refactor. The desktop
  window now loads the redesigned shell, switches between views, and exercises
  live actions such as opening managed directories.
- Completed the V3 dashboard overview detail pass against
  `docs/CodexFree-v3.pen`, including the default desktop-window three-column
  layout, clean tab switching, and design-matched dashboard column padding.
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
- Proxy request bodies are capped only when `maxRequestBodyBytes` is greater
  than 0; the default value `0` means unlimited.
- Added WebSocket frame capture for upgraded responses traffic, including
  `permessage-deflate` decoding for readable upstream error messages.
- Added proxy IPC and daemon control surfaces for host, port, upstream,
  outbound proxy, raw capture, service status, raw capture directory, daemon
  lifecycle, full-database request/usage summaries, and recent request
  observations. The renderer UI is wired to these controls.
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
- `bun run typecheck:web`
- `bun run typecheck:node`
- `bun run typecheck`
- `bun run test`
- `bun run build`
- `bun run build:unpack`
- Manual Electron verification on the V3 shell:
  - dashboard renders the three-column mockup layout in the default desktop
    window;
  - `账户` and `代理` tabs switch correctly;
  - `代理`, `请求`, `用量`, and `系统` pages render the polished desktop
    console layouts;
  - request-ledger clearing and placeholder `auth.json` writing show
    confirmation dialogs before dispatching the daemon action;
  - the `1160x720` minimum Electron window keeps the dashboard chrome fixed,
    with only the Recent Activity table scrolling vertically;
  - Accounts, Proxy, Requests, and Usage were checked in the live Electron
    window after the shared border/theme pass and now match the overview card
    and table treatment in both light and dark modes;
  - the dashboard proxy config snippet stays at three lines and hides the
    horizontal scrollbar while preserving horizontal scrolling;
  - managed auth directory opening succeeds and returns an app notice;
  - account metric cards no longer wrap the auth directory path vertically.
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
  `bun run test` reported 24 files and 89 tests passed. `service.test.ts`
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
- Current split validation passed through the repository runner: `rtk bun run
  lint`, `rtk bun run typecheck`, `rtk bun run test`, `rtk bun run build`, and
  `rtk bun run build:unpack`. The unpacked macOS app contains the bundled daemon
  entry at `out/daemon/cli.cjs`.
- Dev app runtime was inspected with Computer Use. The dashboard rendered the
  full-database historical request count, purpose distribution, proxy config
  with `model_provider = "openai"`, and the animated background-service card.
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
  accounts, usage updates, requests, request summaries, usage summaries, log
  events, parsed WSS protocol messages, delete/disable/reset account actions,
  and clear-records. It intentionally does not expose daemon lifecycle
  endpoints.
- The proxy ledger now stores operator log events in `proxy_log_events` and
  parsed WSS user/assistant/tool/error summaries in `proxy_protocol_messages`.
  Electron preload exposes both surfaces for future app views.
- Admin write endpoints now record successful mutations in the ledger audit log.
- Request, routing, quota, protocol, and log ledger tables are pruned
  automatically with a 30-day default retention window.
- Electron main process has been split into runtime, IPC handlers, window
  bootstrap, and updater bootstrap. It no longer embeds the proxy service. It
  talks to the token-protected daemon admin API for live daemon data and reads
  summary aggregates from SQLite when needed so stopped-daemon UI refreshes do
  not respawn the daemon.
- Quota-exhausted response classification now has packet-level WebSocket frame
  evidence, automatic WSS parsing, persistent account state, and next-boundary
  account replacement.
- Daemon control config is wired through the Proxy page. Operators can edit the
  management host/port/token, enable or disable OS-specific startup service
  ownership, and use app controls that start/stop/restart the actual process
  owner instead of calling admin lifecycle endpoints.
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
