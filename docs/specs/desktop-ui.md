# Desktop UI Spec

## Status

V3 desktop console is implemented. The next UI pass is not another shell
rewrite; it is a data-display optimization pass that aligns all visible request,
usage, overview, and account metrics with `docs/proxy-traffic-analysis.md`.

## Main Layout

Use an operations-console layout rather than a marketing layout.

Use Tailwind CSS and Coss UI components. Coss UI follows shadcn-style component
installation and uses Base UI primitives; do not use Radix UI as the default
primitive layer.

## Renderer Architecture

Renderer code must follow this structure:

- `src/renderer/src/App.tsx` owns shell state, view routing, locale/theme, and
  IPC refresh wiring only.
- `src/renderer/src/components/` holds reusable shell, table, panel, badge,
  form, and layout primitives.
- `src/renderer/src/pages/` holds one page module per primary view.
- `src/renderer/src/data/` holds derived models, grouping helpers, and
  formatting helpers.
- `src/renderer/src/i18n/` holds view-copy selection and locale-specific copy.
- `src/renderer/src/assets/` holds global CSS only.

The renderer must not keep all page markup in a single large file. View-specific
data derivation must live outside the page component.

## UI Component Policy

- Prefer Coss UI components first.
- If Coss UI does not provide the needed component or behavior, use the shadcn
  component from the same `components/ui/` layer.
- Keep the component layer source-owned in the repo; do not invent parallel
  local primitives for Button, Card, Table, Badge, Input, Switch, Tabs, or
  similar controls when Coss/shadcn equivalents exist.
- Use `lucide-react` icons for action buttons and status markers.
- Keep account tokens and auth fields masked by default.
- Use dense, scan-friendly tables for accounts, requests, and usage records.
- Avoid marketing-style cards and hero sections in the app shell.

Recommended primary navigation:

- Dashboard
- Accounts
- Proxy
- Requests
- Usage
- Settings

## Dashboard

Show:

- proxy running state;
- active account;
- available account count;
- quota-exhausted count;
- recent switching events;
- request volume summary.

Data-display requirements:

- Show recent request volume by `request_purpose`, not only by outcome.
- Show active account by email when present, then label, then masked fallback.
- Show account plan, primary used percent, and rate-limit reset time when the
  latest usage query has persisted those fields.
- Keep quota, auth, network, and system log categories visually distinct.
- Mark `/backend-api/wham/remote/*` as original Codex-account traffic because
  that path intentionally bypasses account-pool auth replacement.

## Accounts

Support:

- batch import;
- batch export;
- format filter;
- status filter;
- enable and disable;
- batch usage query;
- masked secret details;
- per-account request and quota history.

Data-display requirements:

- Prefer `proxy_accounts.email` for the account name. Avoid synthetic
  `codex:<account-id>` labels in primary UI when email is available.
- Show plan, primary used percent, secondary used percent, reset time, last
  usage check, and last usage error from the persisted account row.
- Treat quota exhaustion as account state plus quota/log history, not merely the
  status of the most recent request row.
- Keep auth fingerprints and token-bearing material masked.

## Requests

Support:

- request timeline;
- account used;
- upstream outcome;
- quota detection marker;
- API-key rejection marker;
- conversation or run grouping after packet evidence confirms identifiers.

Data-display requirements:

- Default columns are time, status, purpose, method/path, account, model,
  token breakdown, duration, and bytes.
- Purpose uses `request_purpose`; API-key probes and non-`/backend-api`
  traffic stay grouped separately from the default account-login path.
- Token display shows input, cached input, output, reasoning, and total tokens.
  Cached input tokens must not be folded into ordinary input.
- Surface `token_usage_source` in the row or detail panel so `protocol`, `sse`,
  and `analytics_event` usage are not silently mixed.
- Request detail separates HTTP metadata from protocol messages. HTTP metadata
  includes content type, body encoding, request/response model, item counts,
  JSON-RPC fields, Codex thread/turn identifiers, runtime version, duration,
  bytes, upstream host, and error text.
- Protocol message detail uses `proxy_protocol_messages` for WSS/request-stream
  timelines, including direction, kind, protocol type, sequence, response ids,
  model, tool/input counts, per-message tokens, payload size, and truncation.

## Usage

Support:

- request and error statistics;
- traffic statistics;
- token usage statistics;
- source-aware analysis of client and proxy usage records.

Data-display requirements:

- Aggregate by account, model, thread, turn, source, and day.
- Requests with no usage contribute to request volume, traffic, latency, and
  error-rate statistics, but not to token totals.
- Default token totals are source-separated. A future "merge by turn" view must
  be explicit because analytics events and protocol/SSE usage can describe the
  same turn.
- `analytics_event` is the Codex client view. `protocol` and `sse` are the
  proxy-observed upstream response views.

## Settings

Support:

- display local proxy endpoint;
- helper for `~/.codex/config.toml` setup;
- placeholder `~/.codex/auth.json` generation workflow;
- SQLite data retention settings;
- proxy request body size limit (`maxRequestBodyBytes`);
- local certificate status and setup instructions.

## Component Rules

- Use Coss UI components before creating local primitives.
- Use shadcn UI only when Coss UI lacks the needed primitive or pattern.
