# Next Tasks

## Task Queue

| ID | Status | Task | Depends on |
|----|--------|------|------------|
| T1a | Done | Implement transparent proxy service and redacted observation ledger | Stack decision |
| T1b | Done | Complete Codex account-mode packet contract from HAR or proxy logs | T1a or Yakit exports |
| T2 | In Progress | Define auth file normalization for Codex, CPA, and sub2api | Sample files |
| T3 | Draft | Design proxy request classification and API-key rejection | T1b |
| T4 | Draft | Design quota-exhaustion detection and auth switching state machine | T1b |
| T5 | Draft | Define SQLite schema for requests, accounts, usage, and events | T2, T4 |
| T6 | Draft | Design Electron management UI information architecture | T2, T5 |
| T7 | Done | Create Bun Electron Vite React project manifest | Stack decision |

## Immediate Next Step

T1a is complete. The service starts from the Electron main process, supports
configurable listen host, listen port, upstream base URL, outbound proxy mode,
redacted logs, SQLite request ledger fields, and explicit temp-directory raw
capture. It does not mutate request bodies and does not replace upstream auth.

Verification: `bun run lint`, `bun run typecheck`, `bun run test`,
`bun run build`, `bun run build:unpack`, transparent proxy integration test,
local curl through `127.0.0.1:33333`, Docker Node fetch through
`10.211.55.2:33333`, and `codex exec` from the existing `codex` container.

Environment notes: the default port is now `33333`. The existing `codex`
container has `codex-cli 0.130.0`; its config was pointed to
`http://10.211.55.2:33333/v1` for validation.

T1b is complete for normal account-mode traffic. HAR analysis confirmed the
direct upstream paths under `https://chatgpt.com/backend-api`. Two local routing
shapes are now verified:

- `openai_base_url = "http://10.211.55.2:33333/v1"` makes Codex emit
  OpenAI-compatible local paths such as `/v1/models` and `/v1/responses`; the
  proxy maps those paths back to `/backend-api/codex/*`.
- `openai_base_url = "http://10.211.55.2:33333/backend-api/codex"` keeps
  Codex-to-proxy model traffic on `/backend-api/codex/models` and
  `/backend-api/codex/responses` while `chatgpt_base_url =
  "http://10.211.55.2:33333/backend-api"` keeps auxiliary ChatGPT backend
  traffic on `/backend-api/*`.

In both verified shapes, the proxy rewrites `Host` to `chatgpt.com` and
preserves request bodies.

The provided flat auth template was normalized into Codex 0.130 native
`auth.json` shape. After normalization, `codex exec` through
`http://10.211.55.2:33333/v1` returned `converted-auth-proxy-ok`; the ledger
showed `GET /v1/models` status `200` and WebSocket `GET /v1/responses` status
`101`.

The second HAR, `test/History-1778652315307.har`, verified the
`/backend-api/codex` base URL shape. `codex exec` returned
`chatgpt-base-url-ok`; raw captures showed `GET /backend-api/codex/models`
status `200` and WebSocket `GET /backend-api/codex/responses` status `101`.
Auxiliary interfaces (`analytics-events`, `connectors`, `wham/apps`, and
`plugins/featured`) matched between HAR and raw capture with unchanged bodies
and selected auth/protocol headers.

Immediate next step: continue T2 by implementing auth-file import
normalization in the app, then use a real quota-exhausted account sample to
finish T4.

T2 has started. The first implementation is a pure normalization module that
accepts native Codex `auth.json` and flat Codex/CPA-compatible token records,
returns canonical Codex account-login auth shape, and separates safe metadata
from the raw token-bearing object. It does not persist secrets and is not wired
to the Electron import UI yet.

Current T2 verification: `bun run test`, `bun run typecheck`, and
`bun run lint`.

Remaining T2 work:

- add a real sub2api sample before marking sub2api parsing complete;
- decide where encrypted auth payloads are stored;
- wire batch import UI and persistence;
- add export paths after storage format is fixed.

T7 is complete. Verification: `bun run lint`, `bun run typecheck`,
`bun run test`, `bun run build`, `bun run build:unpack`, dev UI checked with
Computer Use, unpacked app checked with Computer Use, and packaged GitHub
update metadata confirmed with sanitized update-check failure logging.

## Readiness Rules

- Draft tasks cannot be implemented until their dependencies are supplied.
- Any task that changes request forwarding, auth handling, or persistence must
  update `docs/security-checklist.md` if it discovers a new risk.
- Temporary raw capture is allowed only behind an explicit debug setting and
  must write outside the repository into the system temp directory.
- When a task becomes Done, record the verification evidence here.
- Independent task cards are not enabled; this file is the task queue authority.
