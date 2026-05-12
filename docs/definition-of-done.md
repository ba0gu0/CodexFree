# Definition of Done

## General

A task is Done only when all apply:

- Behavior is implemented or the document artifact is complete.
- Verification evidence is recorded in `docs/next-tasks.md`.
- `docs/current-state.md` is updated if project status changed.
- No auth secrets, raw tokens, cookies, or sensitive headers are committed.
- User-facing behavior matches the relevant spec under `docs/specs/`.

## Proxy Tasks

Proxy-related tasks must verify:

- API-key mode requests are rejected.
- Account-mode request bodies are not mutated.
- Only authentication-related upstream headers are changed.
- Streaming responses remain compatible with Codex.
- Quota-exhausted accounts are removed from future selection.
- In-flight runs keep their bound auth until the run boundary is reached.

## UI Tasks

UI-related tasks must verify:

- Batch import and export states are visible.
- Account status, quota state, and active proxy state are distinguishable.
- User-facing text is prepared for i18n instead of hardcoded inline strings.
- Secrets are masked by default.
- Error states explain what action is needed without exposing tokens.

## Data Tasks

SQLite-related tasks must verify:

- Schema migrations are explicit and reversible during development.
- Request records link to account records without storing raw secret values.
- Retention and cleanup behavior is documented.
- Batch operations are traceable through audit events.

## Current Commands

Run the commands that apply to the touched area:

```bash
bun run lint
bun run typecheck
bun run test
bun run build
bun run build:unpack
```

For UI changes, also verify the dev window and the unpacked app with Computer
Use. `build:unpack` intentionally skips macOS signing with
`-c.mac.identity=null` so local packaging is fast and produces a runnable app.
Use `bun run build:mac` when a signed macOS artifact is required.
