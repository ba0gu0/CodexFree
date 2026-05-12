# Next Tasks

## Task Queue

| ID | Status | Task | Depends on |
|----|--------|------|------------|
| T1 | Ready | Capture and document Codex account-mode packet contract | Yakit exports |
| T2 | Draft | Define auth file normalization for Codex, CPA, and sub2api | Sample files |
| T3 | Draft | Design proxy request classification and API-key rejection | T1 |
| T4 | Draft | Design quota-exhaustion detection and auth switching state machine | T1 |
| T5 | Draft | Define SQLite schema for requests, accounts, usage, and events | T2, T4 |
| T6 | Draft | Design Electron management UI information architecture | T2, T5 |
| T7 | Done | Create Bun Electron Vite React project manifest | Stack decision |

## Immediate Next Step

Start with T1. The proxy cannot be implemented safely until normal requests,
streaming responses, auth headers, error bodies, quota exhaustion responses, and
conversation identifiers are extracted from Yakit packet exports.

T7 is complete. Verification: `bun run lint`, `bun run typecheck`,
`bun run test`, `bun run build`, `bun run build:unpack`, dev UI checked with
Computer Use, unpacked app checked with Computer Use, and packaged GitHub
update metadata confirmed with sanitized update-check failure logging.

## Readiness Rules

- Draft tasks cannot be implemented until their dependencies are supplied.
- Any task that changes request forwarding, auth handling, or persistence must
  update `docs/security-checklist.md` if it discovers a new risk.
- When a task becomes Done, record the verification evidence here.
- Independent task cards are not enabled; this file is the task queue authority.
