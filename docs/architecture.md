# Architecture

## System Shape

CodexFree has three primary runtime surfaces, plus one future compatibility
surface:

1. Electron desktop app for account management, usage inspection, import/export,
   and operational controls.
2. Standalone local proxy daemon that owns the forwarding socket and account
   routing state.
3. Local admin/control surface used by the app to start, stop, inspect, and
   configure the daemon.
4. Future explicit API-key compatibility service on a separate port. This mode
   is disabled by default and must warn the operator that adapting external
   API-key traffic onto account WebSocket traffic can increase account detection
   or ban risk.

## Confirmed Stack

The implementation stack is:

- Bun for runtime scripts and package execution.
- Strict TypeScript.
- Electron and Vite for the desktop application shell.
- React 19 for the renderer.
- Tailwind CSS and Coss UI for the component system.
- Base UI as the primitive layer through Coss UI, not Radix UI.
- `lucide-react` for icons.
- SQLite with Drizzle ORM for local persistence.
- Vitest for unit and integration tests.
- Playwright later for UI and Electron verification when needed.

## Proxy Path

```text
Codex CLI
  -> http://127.0.0.1:33333/backend-api/codex
  -> request classifier
  -> account-session router
  -> upstream Codex/OpenAI account endpoint
```

The proxy is transparent for request bodies. The only permitted mutation is
authentication-related upstream headers.

The default Codex config uses `chatgpt_base_url` under `/backend-api` and
`openai_base_url` under `/backend-api/codex`. The `/v1` local path belongs to
the future API-key compatibility surface, not the account-login default.

The account-login proxy and the future API-key compatibility service are
separate trust boundaries. API-key shaped requests remain rejected on the normal
Codex account proxy. If the compatibility service is implemented, it must listen
on its own configured port, require an explicit local API key, and translate each
accepted OpenAI-compatible request into a short-lived account WebSocket exchange
against `/backend-api/codex/responses`.

## Account Session Routing

The router owns:

- active auth file selection from the app-managed import directory;
- per-account health and quota status;
- in-progress run binding;
- next-message auth switching;
- audit events for quota detection and account transitions.

The critical rule is that quota exhaustion must not forcibly rewrite the auth of
an in-flight request stream. Switching applies to the next eligible request after
the current run boundary is identified.

The runtime account source is intentionally not configurable by arbitrary path.
Operators batch-import files into the app-managed auth pool, then enable or
disable the pool. This keeps the UI database, account status, usage checks, and
proxy routing aligned to the same file set.

Codex CLI 0.130 traffic exposes that boundary through request headers:

- `thread_id` / `session_id` identify the conversation.
- `x-codex-turn-metadata` contains a `turn_id` for the active user turn.
- `x-codex-window-id` stays tied to the active conversation window.
- `chatgpt-account-id` identifies the upstream account currently used by Codex.

Auth switching should bind an account to the active `turn_id` when present. If
quota exhaustion is detected during that turn, the account is marked unavailable
for future eligible turns, but the current turn is not replayed with a different
auth file. A later user message in the same conversation can switch because it
will have a new `turn_id`.

## Storage

SQLite is the local source of truth for:

- imported auth file metadata;
- normalized account identifiers;
- request records;
- usage counters;
- quota and rejection events;
- import/export history;
- batch usage query results.

Raw secrets should be encrypted or stored through the platform credential store
when implementation begins. If plain local storage is used during early
development, it must be documented as temporary and excluded from commits.

Drizzle ORM should own schema definitions and migrations after the project
manifest is created.

## Runtime Split

The accepted direction is documented in
`docs/specs/proxy-daemon-and-app-split.md`.

The current implementation still has Electron main-process wiring, but the next
architecture step is to extract a daemon boundary:

```text
Codex CLI -> codexfree-proxy daemon -> ChatGPT account backend
CodexFree App -> local admin API / IPC -> codexfree-proxy daemon
```

The daemon and the app must share:

- SQLite ledger and account state;
- app-managed auth-pool directory;
- proxy config file;
- raw capture directory policy.

The daemon owns forwarding, WSS parsing, quota decisions, and active-account
selection. The app owns account import/export, batch usage checks, settings, and
visual inspection. This split allows proxy-core debugging and App UI work to run
in parallel without changing the same hot path.

## UI Areas

Recommended main navigation:

- Dashboard: account pool health, active account, recent quota events.
- Accounts: import, validate, tag, enable or disable, batch actions.
- Proxy: local endpoint state, certificate status, request mode rejection counts.
- Requests: searchable request ledger and per-conversation activity.
- Usage: account-level usage statistics and batch quota query.
- Settings: Codex config helper, auth placeholder generation, data retention.

## Renderer Stack

The renderer is a React 19 application inside Electron/Vite and must follow a
source-owned design system layout after the planned UI refactor:

- `src/renderer/src/components/ui/` contains Coss/shadcn component source;
- `src/renderer/src/components/` contains app-specific composition;
- `src/renderer/src/pages/` contains one page module per view;
- `src/renderer/src/data/` contains derived models and pure formatting helpers;
- `src/renderer/src/i18n/` contains copy tables and locale routing;
- `src/renderer/src/assets/main.css` contains only global tokens, layout
  primitives, and page-scale utilities.

Current implementation note: the renderer is in initial shell mode. The
structure above is the target architecture, not the current completion state.

Component policy:

- use Coss UI first for buttons, cards, tables, toggles, inputs, tabs, and
  layout primitives;
- use shadcn/ui only when Coss UI does not provide the needed component or
  interaction pattern;
- do not create a parallel custom primitive layer when an existing Coss or
  shadcn source component can be copied into `components/ui/`.

The shadcn CLI does not auto-detect electron-vite, so this project keeps a
manual `components.json` configuration. Add components with `bunx shadcn@latest`
commands, adjusted to the final project structure and the Coss-first policy.

## Compatibility Inputs

The following must come from packet captures before implementation is marked
Ready:

- account-mode request headers;
- streaming response shape;
- quota-exhaustion response body and status;
- conversation or run identifiers;
- API-key mode request signal;
- upstream endpoint paths used by Codex account login.
