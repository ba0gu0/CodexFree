# Current State

## Phase

Transparent proxy MVP stage.

The directory was empty at initialization time. The Electron/Vite project has
now been initialized with the confirmed stack, package manifest, linting,
typechecking, testing, i18n, database schema seed, local unpack build path, and
the first transparent proxy service.

## Confirmed Product Direction

CodexFree is an Electron-based desktop system for managing Codex account auth
files and running a local proxy that is compatible with Codex account-login
traffic.

Core behavior:

- Codex is configured to use `http://127.0.0.1:33333/v1`.
- A local placeholder `~/.codex/auth.json` is generated for Codex.
- The proxy does not verify that placeholder token.
- The proxy forwards Codex requests without modifying the request body.
- The proxy maps local Codex `/v1/*` traffic back to ChatGPT account-mode
  upstream paths under `https://chatgpt.com/backend-api/codex`.
- The transparent MVP does not replace upstream authentication headers yet.
- The transparent MVP records redacted request metadata and can optionally write
  raw local debug captures into the system temp directory.
- Future proxy phases will change only upstream authentication-related headers.
- Future proxy phases will detect quota exhaustion and switch auth files for
  future requests.
- In-progress conversations keep their current auth until the active run reaches
  the quota-exhaustion boundary; new user messages in the same conversation can
  use a different auth file.
- API-key mode requests are rejected.

## Confirmed Toolchain

- Scale: Medium.
- Runtime: Bun.
- Language: strict TypeScript.
- Desktop framework: Electron with Vite.
- Frontend: React 19.
- UI: Tailwind CSS, shadcn-style Coss UI, Base UI primitives, `lucide-react`.
- Database: SQLite with Drizzle ORM.
- Tests: Vitest first; Playwright can be added later for UI and Electron flows.
- Proxy runtime: Electron main process owns a local Node HTTP forwarding server
  for the transparent MVP.
- Documentation modules: current docs are kept, ADR is enabled, independent task
  cards are not enabled.

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
- Verified dev UI and unpacked production UI with Computer Use.
- Added `proxy-agent` for outbound direct, HTTP, HTTPS, SOCKS4, and SOCKS5 proxy
  modes.
- Added a transparent forwarding service with configurable listen host, listen
  port, upstream base URL, outbound proxy mode, redacted logs, and SQLite request
  ledger fields.
- The default listen target is `0.0.0.0:33333` so Docker containers can reach
  the Mac service through the host address.
- Added an explicit raw-capture debug switch that writes four protocol-shaped
  `.http` packet files outside the repository under the system temp directory.
- Added a proxy settings UI for host, port, upstream, outbound proxy, raw capture,
  service status, raw capture directory, and recent request observations.

## Known Missing Inputs

- HAR or transparent proxy logs for quota-exhausted traffic.
- HAR or transparent proxy evidence for identifying in-progress runs versus new
  user messages in the same conversation.
- Example sub2api auth file.
- SQLite schema and retention requirements.
- Packaging/signing requirements for macOS.
- Earlier validation could not bind port `55555`; the active development config
  now uses `0.0.0.0:33333`.
- The existing `codex` Docker container has `codex-cli 0.130.0` installed and
  can reach the Mac proxy at `http://10.211.55.2:33333/v1`.

## Current Verification

- `bun run lint`
- `bun run typecheck`
- `bun run test`
- `bun run build`
- `bun run build:unpack`
- Transparent proxy integration test forwards request bodies and records
  redacted ledger metadata.
- Manual local curl through `http://127.0.0.1:33333/v1` reached the transparent
  service and preserved the request body.
- Manual Docker Node fetch through `http://10.211.55.2:33333/v1` reached the Mac
  service.
- `docker exec codex codex -V` returned `codex-cli 0.130.0`.
- `test/History-1778577142774.har` confirmed the standard Codex account-mode
  upstream host is `chatgpt.com` and the primary model surfaces are
  `/backend-api/codex/models` and `/backend-api/codex/responses`.
- `codex exec` from the `codex` container routed through the proxy and produced
  `/v1/models` and WebSocket `/v1/responses` traffic. The proxy rewrote these
  to `/backend-api/codex/models` and `/backend-api/codex/responses`.
- The provided flat auth template had to be normalized into Codex CLI native
  `auth.json` shape before Codex emitted `authorization` and
  `chatgpt-account-id` headers.
- After normalization, `codex exec` through
  `http://10.211.55.2:33333/v1` completed successfully and returned
  `converted-auth-proxy-ok`.
- `codex exec` with `chatgpt_base_url =
  "http://10.211.55.2:33333/backend-api"` and `openai_base_url =
  "http://10.211.55.2:33333/backend-api/codex"` completed successfully and
  returned `chatgpt-base-url-ok`; this keeps Codex-to-proxy model traffic on
  `/backend-api/codex/models` and `/backend-api/codex/responses`.
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
- The request ledger now stores `chatgpt-account-id` as account metadata and
  `thread_id` / `session_id` / `x-client-request-id` as conversation metadata.
- Unpacked app at `dist/mac-arm64/CodexFree.app` launches; Computer Use window
  inspection timed out in this run.
- Unpacked app includes `app-update.yml`; GitHub update-check failures are logged
  as sanitized summaries.

## Active Risks

- Quota-exhausted response classification still needs a real exhausted-account
  sample.
- Quota switching can cause account or conversation risk if request boundaries
  are inferred incorrectly.
- Auth import/export must normalize multiple formats without leaking secrets to
  logs or UI telemetry.

## Write-Back Rule

After every implementation task, update this file and `docs/next-tasks.md` with
the actual result, verification command, and remaining blockers.
