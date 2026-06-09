# CodexFree

[中文](./README.md)

This repository is suitable for an alpha source release. macOS release builds are unsigned and not
notarized by default because of release-cost constraints. If you install a release artifact
directly, macOS may require a manual security override. For sensitive environments, build from
source and review dependencies first.

CodexFree is an Electron desktop tool for managing many Codex JSON auth files and running a
local Codex account-mode proxy. It can import free, plus, and pro account auth files into an
account pool, rotate account quota automatically while you use Codex App or Codex CLI, and avoid
frequent Codex App restarts or VPS deployment.

CodexFree is mainly for users who already have CPA, sub2api, or Codex official-login account auth
configuration files. It is not an API-key switcher and does not target generic OpenAI API relay
providers. For API keys, relay base URLs, or normal API mode, use `cc switch` or another config
switching tool instead. CodexFree uses the ChatGPT/Codex account-login proxy path. With that path,
Codex fast mode can be used; normal API-key mode cannot use that capability.

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

In proxy mode, the top-level `config.toml` should not contain `model_provider`. If you previously
used API-mode config such as `model_provider = "codex"` plus `[model_providers.codex]`,
CodexFree only removes the top-level `model_provider`; it does not modify
`[model_providers.<name>]` tables. This lets proxy mode return to the default Codex account path
while still allowing API mode to be restored from a CodexFree file backup.
If you also use `cc switch` or another tool that edits Codex config, do not let it write config at
the same time as CodexFree, and avoid rapidly switching the same `config.toml` back and forth
between tools. That can create conflicting config writes.

After requests enter the local proxy, CodexFree keeps request bodies unchanged. It only replaces
upstream authentication-related headers before forwarding, so the actual quota comes from the
managed account pool.

The local `~/.codex/auth.json` still needs to exist. Its purpose is to let Codex App / Codex CLI
start normally and enter ChatGPT account mode. You should first sign in with one of your own
ChatGPT/Codex accounts. A free account is enough. With that setup, Codex App remote control still
works: sign in to the mobile ChatGPT App with the same account, then connect from Codex. CodexFree
does not affect remote control connection or management.

If you do not have your own account, import the account pool first, then explicitly select one
imported account in the guide and write it into `~/.codex/auth.json`. Do not enable Codex remote
control while using a pooled account unless that account is yours, otherwise the account owner may
see or control the session. CodexFree backs up the existing `auth.json` before writing and orders
that account later in proxy rotation so other available accounts are used first.

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
2. Import account-pool auth files or folders first.
3. Check all users usage information to confirm accounts are usable.
4. Check `~/.codex/auth.json`; if you do not have your own login account, select one imported
   account in the guide and write it into place.
5. Open the CodexFree setup assistant and write or check `~/.codex/config.toml`.
6. Use Codex normally in Codex App or Codex CLI.

The two `config.toml` lines must be top-level TOML values, not inside `[profiles.xxx]`. Proxy mode
only needs the top-level `model_provider` removed. Do not delete `[model_providers.<name>]`, and
do not add `model_provider = "openai"`. Before writing config, CodexFree backs up the current
`config.toml` as `config-codexfree-YYYYMMDD-HHMMSS.toml`. To return to API mode, choose
the backup to restore on the Proxy page, then sync historical session provider metadata from the
current config.
You can still use `cc switch` or other config-switching tools, but do not let them edit the same
`config.toml` while CodexFree is also writing or monitoring it. Disable one side's automatic config
write or monitoring before switching to avoid overwrites.

For Docker or LAN clients, replace only the host and keep the paths unchanged:

```toml
chatgpt_base_url = "http://host.docker.internal:33333/backend-api"
openai_base_url = "http://host.docker.internal:33333/backend-api/codex"
```

## Security boundaries

- Only import and use account auth files that you own or are authorized to use.
- CodexFree is not an official OpenAI, ChatGPT, or Codex product and is not affiliated with them.
- CodexFree does not automatically overwrite, copy, or replace your `~/.codex/auth.json`.
- CodexFree writes `auth.json` only after you explicitly select an imported account in the guide
  and confirm the action. The existing file is backed up first.
- CodexFree-created backups use dedicated names:
  `config-codexfree-YYYYMMDD-HHMMSS.toml` and
  `auth-codexfree-YYYYMMDD-HHMMSS.json`. Restore only selects from those backups, does not
  read arbitrary files, and does not create another backup while restoring.
- The relogin helper only renames the existing `auth.json` after confirmation and writes no
  replacement file.
- Imported account auth files are managed locally by CodexFree and should never be committed to Git.
- Normal logs do not record access tokens, refresh tokens, cookies, or full auth file contents.
- Raw captures may contain sensitive headers. Enable them only for explicit debugging; they are
  written outside the repository under app data.
- API-key mode is not a default feature. The normal account-mode proxy rejects API-key-shaped
  requests.
- Do not attach real auth files, tokens, cookies, raw captures, or local SQLite databases to
  security reports. See [SECURITY.md](./SECURITY.md).

## Open Source And Releases

- License: MIT. See [LICENSE](./LICENSE).
- Security reporting rules: see [SECURITY.md](./SECURITY.md).
- macOS releases are unsigned and not notarized by default. This is the current release policy,
  not a blocker; users should decide whether the install risk is acceptable and allow or self-sign
  the app locally as needed.
- macOS also uses Velopack for update checks, downloads, and applying updates; GitHub Releases
  still include full installers for manual downloads. Windows and Linux use Velopack updates too.
- Local `test` reference material, captures, databases, and build outputs are ignored by Git. Do
  not manually upload a local folder archive as a substitute for the GitHub source package.

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
- `test`: local packet captures, auth samples, and compatibility evidence, ignored from Git by
  default.

## Current limitations

- API-key compatibility is future work and requires packet capture plus protocol confirmation first.
- Production-grade auth encryption or platform credential storage still needs to be completed.
- More real-world sub2api variants need ongoing verification.
- macOS packages are currently unsigned and not notarized as an alpha cost-control limitation.
