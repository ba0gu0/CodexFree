# CodexFree

[中文](./README.md)

CodexFree is an Electron desktop tool for managing many Codex JSON auth files and running a
local Codex account-mode proxy. It can import free, plus, and pro account auth files into an
account pool, rotate account quota automatically while you use Codex App or Codex CLI, and avoid
frequent Codex App restarts or VPS deployment.

## What it solves

- You have multiple Codex / ChatGPT auth files and want one local place to manage them.
- You want Codex requests to spend quota from an account pool instead of one local login account.
- You want later requests to switch accounts after an account reaches quota exhaustion.
- You want a desktop UI for proxy state, request history, account usage, and routing events.

## How it works

CodexFree changes the Codex base URLs so Codex traffic first reaches the local service:

```toml
chatgpt_base_url = "http://127.0.0.1:33333/backend-api"
openai_base_url = "http://127.0.0.1:33333/backend-api/codex"
```

After requests enter the local proxy, CodexFree keeps request bodies unchanged. It only replaces
upstream authentication-related headers before forwarding, so the actual quota comes from the
managed account pool.

The local `~/.codex/auth.json` still needs to exist. Its purpose is to let Codex App / Codex CLI
start normally and enter ChatGPT account mode. You should first sign in with one of your own
ChatGPT/Codex accounts. A free account is enough. With that setup, Codex App remote control still
works: sign in to the mobile ChatGPT App with the same account, then connect from Codex. CodexFree
does not affect remote control connection or management.

If you do not have your own account, you can manually copy one account from the account pool into
`~/.codex/auth.json`. Do not enable Codex remote control while using a pooled account unless that
account is yours, otherwise the account owner may see or control the session.

## Features

- Electron desktop console with dashboard, accounts, proxy, requests, and usage pages.
- Batch import for Codex native auth, CPA-like records, and sub2api-like records.
- Account-pool state management: available, disabled, quota exhausted, 401 cleanup, and reset.
- Batch account usage checks persisted into local SQLite.
- Local Codex account-mode proxy, listening on `127.0.0.1:33333` by default.
- Transparent forwarding for Codex account-login requests without body mutation.
- Upstream `Authorization` and `chatgpt-account-id` replacement.
- Per-session/turn account binding and account switching after quota exhaustion boundaries.
- WebSocket responses parsing, request ledger, quota events, and routing events.
- Optional raw capture directory for debugging, disabled by default.
- Onboarding and setup assistant for proxy, `config.toml`, `auth.json`, and account-pool state.

## Quick start

1. Start CodexFree.
2. Sign in through the official Codex flow with your own ChatGPT/Codex account to create
   `~/.codex/auth.json`.
3. Open the CodexFree setup assistant and write or check `~/.codex/config.toml`.
4. Import account-pool auth files or folders.
5. Check all users usage information to confirm accounts are usable.
6. Use Codex normally in Codex App or Codex CLI.

The two `config.toml` lines must be top-level TOML values, not inside `[profiles.xxx]`. If
`provider` or `model_provider` configuration exists, remove it so Codex does not use the wrong
provider path.

For Docker or LAN clients, replace only the host and keep the paths unchanged:

```toml
chatgpt_base_url = "http://host.docker.internal:33333/backend-api"
openai_base_url = "http://host.docker.internal:33333/backend-api/codex"
```

## Security boundaries

- CodexFree does not automatically overwrite, copy, or replace your `~/.codex/auth.json`.
- The relogin helper only renames the existing `auth.json` after confirmation and writes no
  replacement file.
- Imported account auth files are managed locally by CodexFree and should never be committed to Git.
- Normal logs do not record access tokens, refresh tokens, cookies, or full auth file contents.
- Raw captures may contain sensitive headers. Enable them only for explicit debugging; they are
  written outside the repository under app data.
- API-key mode is not a default feature. The normal account-mode proxy rejects API-key-shaped
  requests.

## Local development

Install dependencies and run the app:

```bash
bun install
bun run dev
```

Common commands:

```bash
bun run lint
bun run typecheck
bun run test
bun run build
bun run build:unpack
```

Run the daemon separately:

```bash
bun run daemon
```

Platform builds:

```bash
bun run build:mac
bun run build:win
bun run build:linux
```

## Project structure

- `src/main`: Electron main process, daemon control, proxy, SQLite ledger, and auth handling.
- `src/preload`: Electron preload API.
- `src/renderer`: React 19 desktop UI.
- `docs`: current state, architecture, specs, ADRs, security checklist, and task queue.
- `test`: local packet captures, auth samples, and compatibility evidence.

## Current limitations

- API-key compatibility is future work and requires packet capture plus protocol confirmation first.
- Production-grade auth encryption or platform credential storage still needs to be completed.
- More real-world sub2api variants need ongoing verification.
- macOS packaging/signing details still depend on the final release process.
