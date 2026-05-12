# CodexFree Agent Guide

## Project

CodexFree is an Electron desktop app with a local proxy service for managing
Codex account auth files and forwarding Codex account-mode requests through a
local OpenAI-compatible endpoint.

The intended local Codex config points requests to:

```toml
openai_base_url = "https://127.0.0.1:55555/v1"
```

The local `~/.codex/auth.json` used by Codex is a randomly generated placeholder
token. CodexFree does not validate that local placeholder; it only replaces the
upstream authentication headers when proxying through managed account auth files.

## Read First

1. `docs/current-state.md` - current phase, known facts, open risks.
2. `docs/next-tasks.md` - executable task queue and dependencies.
3. `docs/architecture.md` - proxy, Electron, SQLite, auth-file architecture.
4. `docs/definition-of-done.md` - acceptance and verification rules.
5. `docs/security-checklist.md` - account-safety and secret-handling rules.
6. `docs/adr/README.md` - accepted architecture decisions.

## Current Scope

- Electron app with a management interface.
- Local HTTPS proxy at `127.0.0.1:55555`.
- OpenAI-compatible `/v1` surface matching Codex account-login traffic.
- Request forwarding without body mutation.
- Header-only upstream auth replacement.
- Auth pool management for Codex `auth.json`, CPA format, and sub2api format.
- Automatic auth switching after quota exhaustion.
- SQLite request ledger and account usage analytics.
- Batch import, export, and usage query for auth files.

## Confirmed Stack

- Scale: Medium.
- Runtime and package runner: Bun and `bunx`.
- Language: strict TypeScript.
- Desktop shell: Electron with Vite.
- Frontend: React 19.
- UI: Tailwind CSS, shadcn-style components from Coss UI, Base UI primitives,
  and `lucide-react`.
- Database: SQLite with Drizzle ORM.
- Tests: Vitest first, Playwright later for UI and Electron flows.
- Proxy: Electron main process starts a local Node HTTPS server.

## Hard Boundaries

- Do not accept API-key mode requests in the proxy. This project only supports
  Codex account-login request traffic.
- Do not mutate proxied request bodies unless a future spec explicitly allows it.
- Do not log access tokens, refresh tokens, authorization headers, cookies, or
  raw auth file contents.
- Do not create package-manager files or install dependencies until the project
  dependency plan is confirmed.
- Do not mark quota-switching complete until it is verified against provided
  Yakit packet exports.
- Do not introduce Radix UI as the default primitive layer; use Coss UI and Base
  UI unless a future ADR changes this.

## Tooling Rules

- Shell commands in this workspace must be prefixed with `rtk`.
- JavaScript and TypeScript runners should use `bun` and `bunx`.
- One-off Python work should use `uv run --with` or `uvx`.
- Do not use `npm install`, `npm install -g`, `yarn`, `pnpm`, `pip`, `pipenv`, or
  `poetry`.

## Status Rules

| Status | Meaning | Entry condition |
|--------|---------|-----------------|
| Draft | Planning | Needs more detail or external input |
| Ready | Executable | Spec and acceptance are clear, dependencies satisfied |
| In Progress | Active | Agent or developer has started work |
| Blocked | Blocked | Missing external input or dependency |
| Done | Complete | Implementation, verification, and doc write-back are done |

Done requires code, verification evidence, and state documentation updates.
