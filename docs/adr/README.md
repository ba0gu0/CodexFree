# Architecture Decision Records

ADR status values are Proposed, Accepted, Deprecated, and Superseded.

## Accepted

- `0001-technical-stack.md` - Electron, Bun, React 19, Coss UI, SQLite, and
  Drizzle ORM.

## Rules

- Create an ADR for stack changes, proxy protocol changes, auth storage changes,
  and database schema strategy changes.
- Do not change an Accepted ADR silently. Add a new ADR that supersedes it.
- Update `docs/current-state.md` and `docs/next-tasks.md` when an ADR changes
  implementation direction.
