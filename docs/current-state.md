# Current State

## Phase

Initialization stage.

The directory was empty at initialization time. The Electron/Vite project has
now been initialized with the confirmed stack, package manifest, linting,
typechecking, testing, i18n, database schema seed, and local unpack build path.

## Confirmed Product Direction

CodexFree is an Electron-based desktop system for managing Codex account auth
files and running a local proxy that is compatible with Codex account-login
traffic.

Core behavior:

- Codex is configured to use `https://127.0.0.1:55555/v1`.
- A local placeholder `~/.codex/auth.json` is generated for Codex.
- The proxy does not verify that placeholder token.
- The proxy forwards Codex requests without modifying the request body.
- The proxy only changes upstream authentication-related headers.
- The proxy detects quota exhaustion and switches auth files for future requests.
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
- Proxy runtime: Electron main process owns a local Node HTTPS server.
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

## Known Missing Inputs

- Yakit exported packets for normal Codex account-login traffic.
- Yakit exported packets for quota-exhausted traffic.
- Yakit evidence for identifying in-progress runs versus new user messages in
  the same conversation.
- Example Codex `auth.json` file.
- Example CPA auth file.
- Example sub2api auth file.
- SQLite schema and retention requirements.
- Packaging/signing requirements for macOS.

## Current Verification

- `bun run lint`
- `bun run typecheck`
- `bun run test`
- `bun run build`
- `bun run build:unpack`
- Dev window verified with Computer Use.
- Unpacked app at `dist/mac-arm64/CodexFree.app` verified with Computer Use.
- Unpacked app includes `app-update.yml`; GitHub update-check failures are logged
  as sanitized summaries.

## Active Risks

- Header and request-shape compatibility cannot be finalized without packet
  captures.
- Quota switching can cause account or conversation risk if request boundaries
  are inferred incorrectly.
- Auth import/export must normalize multiple formats without leaking secrets to
  logs or UI telemetry.

## Write-Back Rule

After every implementation task, update this file and `docs/next-tasks.md` with
the actual result, verification command, and remaining blockers.
