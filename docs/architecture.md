# Architecture

## System Shape

CodexFree has two runtime surfaces:

1. Electron desktop app for account management, usage inspection, import/export,
   and operational controls.
2. Local HTTPS proxy service that exposes an OpenAI-compatible `/v1` endpoint for
   Codex account-login traffic.

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
  -> http://127.0.0.1:33333/v1
  -> request classifier
  -> account-session router
  -> upstream Codex/OpenAI account endpoint
```

The proxy is transparent for request bodies. The only permitted mutation is
authentication-related upstream headers.

## Account Session Routing

The router owns:

- active auth file selection;
- per-account health and quota status;
- in-progress run binding;
- next-message auth switching;
- audit events for quota detection and account transitions.

The critical rule is that quota exhaustion must not forcibly rewrite the auth of
an in-flight request stream. Switching applies to the next eligible request after
the current run boundary is identified.

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

## UI Areas

Recommended main navigation:

- Dashboard: account pool health, active account, recent quota events.
- Accounts: import, validate, tag, enable or disable, batch actions.
- Proxy: local endpoint state, certificate status, request mode rejection counts.
- Requests: searchable request ledger and per-conversation activity.
- Usage: account-level usage statistics and batch quota query.
- Settings: Codex config helper, auth placeholder generation, data retention.

Coss UI should be initialized through shadcn-compatible commands using `bunx`,
for example `bunx shadcn@latest init @coss/style` or
`bunx shadcn@latest add @coss/ui`, adjusted to the final project structure.
The shadcn CLI does not auto-detect electron-vite, so this project keeps a
manual `components.json` configuration and uses the Base UI option for future
Coss component additions.

## Compatibility Inputs

The following must come from packet captures before implementation is marked
Ready:

- account-mode request headers;
- streaming response shape;
- quota-exhaustion response body and status;
- conversation or run identifiers;
- API-key mode request signal;
- upstream endpoint paths used by Codex account login.
