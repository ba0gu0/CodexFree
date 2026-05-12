# ADR 0001: Technical Stack

## Status

Accepted.

## Context

CodexFree is a local desktop app plus proxy service. It needs a management UI,
local HTTPS server, SQLite persistence, account import/export flows, request
history, and quota analytics.

## Decision

Use:

- Medium project scale.
- Bun for runtime scripts and package execution.
- Strict TypeScript.
- Electron with Vite.
- React 19.
- Tailwind CSS.
- Coss UI as the shadcn-style component source.
- Base UI primitives through Coss UI.
- `lucide-react` for icons.
- SQLite with Drizzle ORM.
- Vitest first, with Playwright added later for UI and Electron flows.
- Electron main process starts the local Node HTTPS proxy server.

Independent task cards are not enabled. `docs/next-tasks.md` remains the task
queue authority.

## Consequences

- Radix UI is not the default primitive layer.
- Coss UI setup should use `bunx shadcn@latest` commands, not pnpm.
- Drizzle migrations should be introduced with the project manifest.
- Proxy core should stay isolated so it can move to a sidecar later if needed.
