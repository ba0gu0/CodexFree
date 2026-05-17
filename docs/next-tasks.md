# Next Tasks

## Task Queue

| ID | Status | Task | Depends on |
|----|--------|------|------------|
| T1a | Done | Implement transparent proxy service and redacted observation ledger | Stack decision |
| T1b | Done | Complete Codex account-mode packet contract from HAR or proxy logs | T1a or Yakit exports |
| T2 | Done | Define auth file normalization for Codex, CPA, and sub2api | Sample files |
| T3 | Done | Design proxy request classification and API-key rejection | T1b |
| T4 | Done | Implement quota-exhaustion detection and auth switching state machine | T1b |
| T5 | Done | Define SQLite schema for accounts, usage, and events | T2, T4 |
| T6 | Done | Design Electron management UI information architecture | T2, T5 |
| T7 | Done | Create Bun Electron Vite React project manifest | Stack decision |
| T8 | Draft | Add explicit API-key OpenAI-compatible adapter mode | T1b, T4 |
| T9 | Done | Split proxy into standalone daemon controlled by app | T4, T5 |
| T10 | In Progress | Make proxy logs operator-readable from real Docker Codex traffic | T4 |
| T11 | In Progress | Polish remaining page layouts and interactions against daemon/admin API | T6, T9 |

## Parallel Work Lines

### Work Line A: Proxy Daemon Core

This line can run in a separate thread from UI work.

Owned scope:

- `src/main/proxy/**`;
- daemon/CLI entrypoint;
- local admin API or IPC;
- SQLite ledger and account-state reads/writes;
- WSS and HTTP quota handling;
- terminal logs;
- Docker Codex validation.

Immediate tasks:

1. Done: `bun run proxy` now starts the daemon entrypoint and uses the shared
   `codexfree.sqlite` ledger.
2. Done: daemon admin API is token-protected and exposes status, config,
   accounts, usage updates, requests, log events, protocol messages, start,
   restart, stop, account disable/delete/reset, and clear.
3. Done: normal daemon runs write log events to SQLite without request spam;
   `--debug` prints readable lines from the same event stream.
4. Done: Electron main no longer imports the SQLite ledger or embedded proxy
   service. Packaged builds include the daemon JS bundle and run it with
   Electron's Node runtime; development startup uses the same `bun run proxy`
   path.
5. Continue reworking `bun run proxy` logs against real Docker Codex
   traffic:
   - daemon startup;
   - active account loaded from SQLite;
   - quota remaining and reset time;
   - HTTP request purpose and response result;
   - WSS connection lifecycle;
   - user request, AI reply, and tool events;
   - quota detection;
   - account switch or no replacement account.
6. Fix HTTP fallback `POST /backend-api/codex/responses` quota handling so it
   follows the same account-state rules as WSS quota handling.
7. Keep normal account-login proxy paths under `/backend-api`; keep `/v1`
   API-key compatibility separate and explicit.
8. Done: already-open client WSS connections re-enter a per-turn
   `response.create` probe. Immediate quota is suppressed; self-contained turns
   are replayed to a replacement upstream account, while incremental turns close
   the client WSS only when another account exists for Codex to reconnect onto.
   If the pool has no replacement account, final quota is forwarded.
9. Done: current packet and relay-analysis findings are documented in
   `docs/proxy-traffic-analysis.md`. Future UI work should use that document as
   the data-source reference before adding new request, usage, overview, or
   account fields.

Verification:

- `bun run lint`;
- `bun run typecheck`;
- focused proxy tests;
- `docker exec codex ... codex exec ...` through
  `chatgpt_base_url = ".../backend-api"` and
  `openai_base_url = ".../backend-api/codex"`;
- terminal log review proving the whole flow is understandable.

### Work Line B: Desktop App Console

This line should avoid changing proxy hot-path code unless it needs a new admin
status field.

Owned scope:

- `src/renderer/**`;
- `src/preload/**`;
- Electron shell and admin client glue;
- app navigation and account/request/usage views.

Immediate tasks:

1. Done for main-process control: Electron main has a daemon admin client and
   does not import the SQLite ledger or embedded proxy service. Runtime startup
   ensures the daemon is reachable, and status, restart, config-save, import
   sync, usage updates, reset, and account disable/delete actions go through the
   daemon admin API. Startup now reads the configured daemon management
   host/port and admin token from SQLite `proxy_settings`, probes that endpoint
   first, and spawns a daemon only when the endpoint is unreachable.
2. Show startup/config helper values:
   - `chatgpt_base_url = "http://127.0.0.1:<port>/backend-api"`;
   - `openai_base_url = "http://127.0.0.1:<port>/backend-api/codex"`.
3. Done for overview: show account email where known, quota, reset time,
   available count, exhausted count, categorized recent events, and copyable
   proxy config rows without wrapping around `=`.
4. Keep account import, batch usage checks, enable/disable/reset, and request
   ledger screens usable while the daemon evolves.
5. Done: expose management host/port/token in the Proxy page and add a macOS
   LaunchAgent toggle so boot startup has a clear service owner.
6. Use `docs/proxy-traffic-analysis.md` as the UI data-source contract for the
   next Requests and Usage page optimization pass, especially token source,
   cached-token display, request purpose filtering, and quota fields.

Verification:

- `bun run lint`;
- `bun run typecheck`;
- renderer build;
- manual app launch;
- app can inspect/control an already-running daemon.

Renderer refactor state:

- Coss-first and shadcn-fallback component policy remains the target.
- `src/renderer/src/components/ui/` may contain source-owned component building
  blocks, but it is not the app UI implementation.
- `src/renderer/src/App.tsx` now owns the V3 shell and page routing.
- Dashboard, Accounts, Proxy, Requests, and Usage are implemented and
  connected. Dashboard, Accounts, Proxy, Requests, and Usage now share
  the V3 desktop-console information architecture; future work should focus on
  narrow interaction polish and missing backend-backed fields rather than
  another broad shell rewrite. Destructive local actions now use confirmation
  dialogs before clearing records or writing placeholder `auth.json`. The
  selected UI language is synchronized into native import/export dialogs, while
  language and theme choices persist locally. Daemon management configuration is
  part of the Proxy page, not a separate settings page. The
  overview opens at and is constrained for the `1160x720` minimum desktop
  window: no top-level page scroll, proportional three-column app structure, and
  an internally scrolling Recent Activity table with no horizontal scrollbar or
  fixed row slice. The remaining-page polish pass aligns Accounts, Proxy,
  Requests, and Usage with the overview through compact headers, semantic
  light/dark borders, virtualized data tables, and a cleaner Proxy page without
  duplicate copy/context blocks. The current overview detail pass removes the
  top recent-event summary, turns the utility system button into a theme cycle,
  removes the account-health progress bar, classifies recent logs by event type,
  marks `/backend-api/wham/remote/*` as the original Codex account, and uses
  email metadata instead of synthetic account ids.
- `docs/CodexFree-v2.pen`, `docs/CodexFree-v3.pen`, and preview images remain
  design references rather than proof by themselves.

Current verification:

- `bun run lint`;
- `bun run typecheck:web`;
- `bun run typecheck:node`;
- `bun run typecheck`;
- `bun run build`;
- `bun run build:unpack`.
- Electron shell verification on the current refactor:
  - dashboard overview matches the V3 desktop mockup details in the default
    desktop window;
  - account, proxy, request, and usage navigation works;
  - proxy, request, and usage pages render the current polished
    console layouts in the live Electron window;
  - accounts, proxy, requests, and usage match the overview card/table visual
    language in both light and dark modes;
  - request clearing and placeholder `auth.json` writing open confirmation
    dialogs and can be canceled without dispatching the destructive action;
  - at the minimum `1160x720` window, the overview keeps the shell fixed and
    only the Recent Activity table scrolls vertically;
  - managed directory open action succeeds.
- Current daemon/proxy core verification:
  - `bun run test` passed 24 test files and 89 tests;
  - `bun run typecheck:node` passed;
  - `bun run daemon -- --help` passed;
  - local daemon smoke confirmed log events are persisted by default and printed
    only with `--debug`.

## Immediate Next Step

T1a is complete. The service starts from the standalone daemon, supports
configurable listen host, listen port, upstream base URL, outbound proxy mode,
redacted logs, SQLite request ledger fields, and explicit temp-directory raw
capture. It does not mutate request bodies and does not replace upstream auth.

Verification: `bun run lint`, `bun run typecheck`, `bun run test`,
`bun run build`, `bun run build:unpack`, transparent proxy integration test,
local curl through `127.0.0.1:33333`, Docker Node fetch through
`10.211.55.2:33333`, and `codex exec` from the existing `codex` container.

Environment notes: the default port is now `33333` and the default host is
`127.0.0.1`. The existing `codex` container has `codex-cli 0.130.0`; Docker
validation needs an explicit `--host 0.0.0.0` override before its config can be
pointed to the Mac proxy. Docker should use `host.docker.internal`; local host
Codex should use `127.0.0.1`, or the computer IP when accessed from a VM/LAN
client.

T1b is complete for normal account-mode traffic. HAR analysis confirmed the
direct upstream paths under `https://chatgpt.com/backend-api`. Two local routing
shapes are now verified:

- `openai_base_url = "http://host.docker.internal:33333/backend-api/codex"`
  keeps Docker Codex-to-proxy model traffic on `/backend-api/codex/models` and
  `/backend-api/codex/responses` while `chatgpt_base_url =
  "http://host.docker.internal:33333/backend-api"` keeps auxiliary ChatGPT
  backend traffic on `/backend-api/*`.
- `/v1/models` and `/v1/responses` belong to the future API-key compatibility
  surface. `/v1/models` must convert upstream account models into the standard
  OpenAI model-list response shape.
- `openai_base_url = "http://127.0.0.1:33333/backend-api/codex"` keeps host
  Codex-to-proxy model traffic on `/backend-api/codex/models` and
  `/backend-api/codex/responses` while `chatgpt_base_url =
  "http://127.0.0.1:33333/backend-api"` keeps auxiliary ChatGPT backend traffic
  on `/backend-api/*`.

In both verified shapes, the proxy rewrites `Host` to `chatgpt.com` and
preserves request bodies.

The provided flat auth template was normalized into Codex 0.130 native
`auth.json` shape. After normalization, `codex exec` through
the earlier `/v1` experiment returned `converted-auth-proxy-ok`; that result is
historical evidence only and should not be used as the account-login default.

The second HAR, `test/History-1778652315307.har`, verified the
`/backend-api/codex` base URL shape. `codex exec` returned
`chatgpt-base-url-ok`; raw captures showed `GET /backend-api/codex/models`
status `200` and WebSocket `GET /backend-api/codex/responses` status `101`.
Auxiliary interfaces (`analytics-events`, `connectors`, `wham/apps`, and
`plugins/featured`) matched between HAR and raw capture with unchanged bodies
and selected auth/protocol headers.

Immediate next step: keep API-key compatibility mode as a separate T8 phase.
The account-login proxy path is now usable with imported managed accounts,
real usage checks, persisted account state, and explicit auth-pool takeover.

T2 is complete for the current supported import surface. The normalization
module accepts native Codex `auth.json`, CPA-style records, and sub2api-style
records that contain ChatGPT account tokens. It returns canonical Codex
account-login auth shape and separates safe metadata from the raw token-bearing
object.

Current T2 verification: `bun run lint`, `bun run typecheck`, `bun run test`,
and `bun run build`.

Deferred T2 hardening:

- add more real-world sub2api variants as samples appear;
- replace plaintext app-managed auth-file storage with encrypted or
  platform-protected storage in a later security phase.

T3 is complete. The proxy now classifies requests by account-mode path and
headers before forwarding. Known Codex account backend paths are allowed only
when they carry account auth headers; `Bearer sk-` API-key mode requests and
unknown backend paths are rejected locally and written to the ledger as
`rejected` without reaching upstream. This applies to normal HTTP requests and
WebSocket Upgrade requests.

Current T3 verification: `bun run lint`, `bun run typecheck`, `bun run test`,
and `bun run build`.

T4 has advanced because real usage-limit samples were captured and decoded from
the WebSocket packet stream. The loop run
`/tmp/codexfree-ws-loop-usage.jsonl` hit:

```text
You've hit your usage limit. Upgrade to Plus to continue using Codex
(https://chatgpt.com/explore/plus), or try again at May 20th, 2026 3:15 AM.
```

The matching raw capture id was `<uuid>`, with
`GET /backend-api/codex/responses` returning HTTP `101`. The decoded
`websocket-upstream-to-codex.frames.jsonl` payload contained
`usage_limit_reached`, `status_code: 429`, `X-Codex-Plan-Type: free`,
`X-Codex-Active-Limit: premium`, and `X-Codex-Primary-Used-Percent: 100`.

Implemented T4 slice: decoded upstream WSS text frames are now parsed for
`usage_limit_reached`, and matching upgraded requests are updated in the ledger
as `quota_exhausted` with status `429`. This does not replay or modify the
in-flight turn.

Current T4 verification: `bun run lint:fix`, `bun run test`,
`bun run typecheck`, and `bun run build`.

Immediate next step: update account availability and implement next-boundary
auth replacement without changing request bodies or replaying the failed turn.

Implemented T4 account-pool slice: account-pool routing loads normalized auth
files from the app-managed import directory into an in-memory router. The user
cannot select a custom runtime auth directory. The router binds each
conversation key to a selected account, replaces only upstream `Authorization`
and `chatgpt-account-id`, marks the bound account exhausted on decoded WSS
`usage_limit_reached`, and selects the next available account on the next
request or WSS upgrade boundary. Multiple conversations are handled by separate
conversation bindings.

Implemented WSS quota retry shielding: when a newly opened upstream WSS returns
`usage_limit_reached` before any upstream business frame has been forwarded to
Codex, the proxy buffers the client socket, hides that quota frame, marks the
attempted account exhausted, reconnects upstream with the next available
account, replays buffered client frames, and then resumes normal piping. This
prevents a new Codex task from showing quota exhausted when another long task
spent the previous account's final quota.

Usage query policy is also fixed: `/backend-api/wham/usage` should be forwarded
with the currently bound/default available account and return that account's
real upstream usage. The proxy must not fabricate a constant 100% or fake low
usage value.

Four free-account `hi` samples were captured in
`test/raw-captures/account-hi`. The packet comparison showed:

- account-varying fields: `Authorization`, `chatgpt-account-id`;
- session-varying fields: `thread_id`, `session_id`, `x-client-request-id`,
  `x-codex-window-id`, `x-codex-turn-metadata`;
- transport-varying fields: `sec-websocket-key`;
- stable protocol fields: `/backend-api/codex/models`,
  `/backend-api/codex/responses`, `openai-beta:
  responses_websockets=2026-02-06`, request bodies for model/responses.

Same-session account switching was also captured in
`test/raw-captures/same-session-account-switch`. Three auth files were used with
the same `codex exec resume` thread id
`019e<thread-redacted>`. The response WSS account id changed per
auth file, while `thread_id`, `session_id`, `x-client-request-id`,
`x-codex-window-id`, and `x-codex-turn-metadata` stayed stable. This confirms
that account switching can happen inside one conversation at the next WSS
upgrade boundary.

Current T4 verification: `bun run lint`, `bun run test`, `bun run typecheck`,
`bun run build`, and Docker validation with Codex CLI `0.130.0`.

Completed T4 core work:

- persisted account availability into SQLite `proxy_accounts`;
- persisted route decisions into `proxy_routing_events`;
- persisted quota exhaustion details into `proxy_quota_events`;
- reloaded persisted exhausted accounts before routing after service restart;
- marked token/account failures during forwarding without refreshing inside the
  proxy path;
- kept concurrent conversation bindings separate and avoided stealing an account
  already bound to another active conversation when an unbound account exists;
- shielded initial WSS `usage_limit_reached` frames and retried on the next
  available account;
- passed through the quota error only when every managed account is exhausted;
- verified real `/backend-api/wham/usage` forwarding with the selected account.

Docker validation evidence:

- Container inbound account:
  `<uuid>`.
- Local auth-pool outbound account:
  `<uuid>`.
- Raw captures show account replacement on `/backend-api/codex/models`,
  WebSocket `/backend-api/codex/responses`, and `/backend-api/wham/usage`.
- The chat task returned `authpool-docker-ok`; the manual usage query returned
  HTTP 200 with a real upstream body.

T4 is complete for the account-login proxy path. The latest slice added:

- app-managed account import without automatically enabling takeover;
- runtime routing uses the same app-managed directory as batch import;
- batch usage checks for imported accounts;
- per-account disable/enable control;
- exhausted-account reset control;
- exported auth-file backup path;
- 24-hour retention pruning for in-memory conversation bindings;
- status reporting for available, exhausted, and disabled account counts.

The latest evidence from `test/History-1778683339690.har` and raw captures
refines T4:

- Codex establishes a WSS `/backend-api/codex/responses` channel after a
  session/turn starts.
- The proxy must preserve auth headers for an already-upgraded WSS connection.
- Only a decoded upstream WSS payload with `error.type =
  "usage_limit_reached"` marks the bound account as exhausted.
- Network disconnects, `EPIPE`, local proxy failures, or Yakit HTML errors must
  not trigger auth replacement.
- After quota exhaustion, the same session can become eligible for a new account
  on the next request boundary; the failed in-flight WSS turn is not replayed.

T8 is intentionally separate. It changes the previous hard boundary by adding an
off-by-default API-key compatibility mode. In that mode, CodexFree would accept
standard OpenAI-style `/v1/models`, `/v1/responses`, and legacy
`/v1/chat/completions` requests on a configured port/key. `/v1/models` must
convert the account models payload into the standard OpenAI response shape.
`/v1/responses` must support HTTP/SSE and WebSocket client surfaces while every
generation request to ChatGPT goes through a short-lived account WSS
`/backend-api/codex/responses` call. `chat/completions` must translate requests
to Codex Responses frames and translate Codex response events back to OpenAI
Chat Completions chunks or final JSON. The detailed conversion design is in
`docs/specs/v1-compatibility-adapter.md`. This is not the same as the
account-login transparent proxy and needs separate tests and operator controls.

## Overall Proxy Capability Plan

Still needed after the account-login proxy core:

- Account storage hardening: encrypted or platform-protected auth payload
  storage.
- Validation tools: one-click raw capture cleanup and packet diff summaries for
  account/header changes. Docker smoke output for the current daemon path is now
  recorded in `docs/current-state.md`.
- Token refresh integration: `src/main/auth/refresh.ts` exists, but forwarding
  should not refresh inside HTTP/WSS proxy paths. Use the main app
  account-maintenance flow to refresh or recover accounts marked unavailable.
- API-key compatibility mode: separate disabled-by-default listener, explicit
  local API key, visible ban/detection warning, and adapter from OpenAI-style
  `/v1/*` requests to short-lived account WSS exchanges.

T7 is complete. Verification: `bun run lint`, `bun run typecheck`,
`bun run test`, `bun run build`, `bun run build:unpack`, dev UI checked with
Computer Use, unpacked app checked with Computer Use, and packaged GitHub
update metadata confirmed with sanitized update-check failure logging.

The latest proxy-response slice is complete for the two client-visible account
surfaces:

- `/backend-api/wham/usage` still forwards through the selected managed auth
  file and updates quota state from the real upstream response, then returns
  the real upstream usage shape to Codex without client-visible field rewriting.
  The previous `user_id`/`account_id` rewrite helper remains in code but is not
  active.
- `/backend-api/wham/remote` and child paths now bypass managed auth
  replacement so upstream receives the original Codex `Authorization` and
  `chatgpt-account-id` headers for HTTP and WSS traffic.
- Terminal WSS quota handling now suppresses immediate probe quota frames only
  while another account remains usable. If no replacement account remains, the
  final `usage_limit_reached` frame is returned to Codex.
- `/backend-api/codex/models` keeps the upstream model list exactly as returned
  by upstream.
- Verification passed:
  `bun run test -- src/main/proxy/service.test.ts`,
  `bunx biome check src/main/proxy/service.ts src/main/proxy/service.test.ts`,
  and `bun run typecheck:node`.

## Readiness Rules

- Draft tasks cannot be implemented until their dependencies are supplied.
- Any task that changes request forwarding, auth handling, or persistence must
  update `docs/security-checklist.md` if it discovers a new risk.
- Temporary raw capture is allowed only behind an explicit debug setting and
  must write outside the repository into the app data `raw-captures` directory.
- When a task becomes Done, record the verification evidence here.
- Independent task cards are not enabled; this file is the task queue authority.
