# Account Routing and Quota Switching Draft

## Status

Ready for account-login proxy core. Packet-level WebSocket frame capture
confirms the usage-limit event shape, and the proxy automatically classifies
decoded WebSocket `usage_limit_reached` payloads. Account selection,
next-boundary replacement, persistent account state, app-managed import, batch
usage checks, per-account disable/enable, and exhaustion reset are implemented.

## Observed Codex 0.130 Traffic

The `codex` Docker container was configured with:

```toml
chatgpt_base_url = "http://host.docker.internal:33333/backend-api"
openai_base_url = "http://host.docker.internal:33333/backend-api/codex"
```

Observed request surfaces:

- `GET /backend-api/codex/models?client_version=0.130.0`
- `GET /backend-api/codex/responses` with WebSocket upgrade headers
- `POST /backend-api/codex/responses` with `accept: text/event-stream`

The HAR file `test/History-1778577142774.har` shows the direct ChatGPT upstream
surfaces:

- `/backend-api/codex/models`
- `/backend-api/codex/responses`
- `/backend-api/codex/analytics-events/events`
- `/backend-api/connectors/directory/list`
- `/backend-api/wham/usage`
- `/backend-api/wham/apps`
- `/backend-api/plugins/featured`

With `openai_base_url`, Codex sends model endpoints under exactly the configured
base URL. Two local routing shapes are verified:

- `openai_base_url = "http://host.docker.internal:33333/backend-api/codex"`
  emits `/backend-api/codex/models` and `/backend-api/codex/responses` on the
  Docker Codex-to-proxy side. Host-side Codex can replace only the host with
  `127.0.0.1` or the computer IP.
- `/v1/models` and `/v1/responses` are reserved for the future API-key
  compatibility surface. They are not the documented account-login config.

The `/backend-api/codex` shape is preferred because the local proxy observes the
same account backend path family that native ChatGPT account-mode traffic uses.

Useful headers:

- `authorization`: upstream bearer token; replace only on account-mode requests.
- `chatgpt-account-id`: upstream account id; replace with the selected auth file.
- `thread_id` / `session_id`: conversation identity.
- `x-client-request-id`: conversation-level request id fallback.
- `x-codex-turn-metadata`: JSON metadata containing `turn_id`.
- `x-codex-window-id`: conversation window id.

Latest evidence from `test/History-1778683339690.har` and raw captures shows
that Codex can establish a WSS `/backend-api/codex/responses` channel after a
session starts, and subsequent conversation traffic is carried on that WSS
stream. Therefore, auth switching must be tied to WSS application messages and
request boundaries, not only to one HTTP request/response pair.

## Auth Replacement Boundary

For account-mode requests, the proxy may replace only upstream auth identity:

- `Authorization`
- `Chatgpt-Account-Id`

The proxy must not mutate the body, model, messages, tool payload, compression,
streaming headers, or user-visible conversation fields.

Four-account packet comparison confirms that only `Authorization` and
`chatgpt-account-id` need account replacement. The following fields are owned by
Codex session/runtime state and must be preserved from the incoming request:

- `thread_id`
- `session_id`
- `x-client-request-id`
- `x-codex-window-id`
- `x-codex-turn-metadata`
- `sec-websocket-key`

The same rule holds when changing accounts inside one Codex conversation. The
same-session sample in `test/raw-captures/same-session-account-switch` used one
thread id across three account files:

- thread/session/client request id:
  `019e<thread-redacted>`
- step 1 account id: `<uuid>`
- step 2 account id: `<uuid>`
- step 3 account id: `<uuid>`

Across the three turns, `thread_id`, `session_id`, `x-client-request-id`,
`x-codex-window-id`, and `x-codex-turn-metadata` stayed stable. The account id
and bearer token changed. `sec-websocket-key` changed per WSS upgrade and must
be treated as transport randomness, not account state.

## Auth File Normalization Finding

Codex 0.130.0 expects `~/.codex/auth.json` in native shape:

```json
{
  "auth_mode": "chatgpt",
  "OPENAI_API_KEY": null,
  "tokens": {
    "id_token": "...",
    "access_token": "...",
    "refresh_token": "...",
    "account_id": "..."
  },
  "last_refresh": "..."
}
```

Flat templates with top-level `access_token`, `refresh_token`, and `account_id`
must be normalized into this shape before Codex emits `authorization` and
`chatgpt-account-id` headers.

## Run Binding Rule

Use the most specific stable key available:

1. `turn_id` from `x-codex-turn-metadata`
2. `thread_id` plus `x-client-request-id`
3. `session_id`

When a turn starts, bind that run key to the selected auth file. All WebSocket
and POST retries for the same run key must keep the same auth file.

For WSS traffic, the auth headers are fixed at upgrade time. The proxy must not
replace auth on an already-upgraded WSS connection. It can only change auth on a
later request or WSS upgrade boundary.

Observed `codex exec resume` turns can keep `turn_id` empty while preserving the
same thread/session/window ids. Therefore the runtime binding key should be:

1. `thread_id` when present;
2. `session_id` when `thread_id` is absent;
3. `x-client-request-id` as a fallback.

`x-codex-turn-metadata.turn_id` is useful when non-empty, but it cannot be the
only switch boundary because current samples use an empty `turn_id`.

## Quota Switching Rule

When an in-flight response is confirmed as quota exhaustion:

- mark the bound account unavailable for future eligible turns;
- record the quota event against account id, run key, path, status, and body
  fingerprint;
- if no upstream business frame has reached Codex yet, hide the quota frame,
  reconnect upstream with the next available auth file, and replay only the
  buffered client frames from that probe window;
- if normal upstream streaming has already begun, do not replay that active task
  across accounts; allow the next eligible request in the same session to select
  a new auth file after the stream ends.

This preserves conversation safety while avoiding client reconnect loops for the
common initial-quota failure: a failed probe can move to a fresh account before
Codex sees business data, but an already-streaming task stays on its original
account.

The concrete state machine is:

1. On an eligible account-mode request or WSS upgrade, classify the conversation
   key from `thread_id` / `session_id` / `x-client-request-id`.
2. If the conversation has a bound available account, reuse that account.
3. If no binding exists, select the next available account from the pool.
4. Replace only `Authorization` and `chatgpt-account-id` before constructing the
   upstream request options.
5. For WSS, start in a probe window before any upstream business frame is
   forwarded to Codex.
6. If the probe frame contains `usage_limit_reached`, mark the bound account
   exhausted, remove only that conversation binding, reconnect upstream with the
   next available account, and replay buffered client frames.
7. Once a non-quota upstream frame has been forwarded, switch to normal piping
   and do not replay the active stream across accounts.
8. On the next request or WSS upgrade for the same conversation, select another
   available account and preserve the incoming conversation/session headers.

Multiple concurrent conversations are independent because the binding map is
keyed by conversation id, not by one global active session.

## New WSS Quota Retry Rule

There is one important optimization for a new WSS request that immediately hits
quota before any useful upstream business frame reaches Codex. This can happen
when another long-running task spent the last remaining quota on the old
account, while a new task starts a separate WSS connection.

For that case, the proxy uses a client-stable upstream retry:

1. Accept the client WSS upgrade and keep the Codex client socket open.
2. Connect to upstream with the selected account.
3. Buffer upstream frames until the first decoded upstream text frame determines
   whether the account is usable.
4. Buffer client frames sent during this probe window.
5. If the first upstream business frame is `usage_limit_reached`, do not forward
   that quota frame to Codex.
6. Mark the attempted account exhausted.
7. Close only that upstream socket.
8. Select the next available account and reconnect upstream with the same
   incoming conversation/session headers, replacing only auth identity headers.
9. Replay the buffered client frames to the replacement upstream socket.
10. Once a non-quota upstream frame arrives, flush buffered upstream bytes to the
    Codex client and switch to normal bidirectional piping.

This rule is intentionally narrow. It applies only before any upstream business
frame has been forwarded to the client. If a long-running WSS task has already
started streaming normally and later fails, the proxy must not hide or replay
that active task across accounts.

HTTP fallback retry has a stricter safety boundary. A request body may already
have produced upstream side effects before an HTTP quota response is observed, so
HTTP retry is best-effort only and must stay bounded. The preferred path for
state-changing `/backend-api/codex/responses` traffic is the WSS initial-frame
retry shield above, where no upstream business frame has been forwarded to Codex
before the retry decision.

If every available account returns `usage_limit_reached` during the probe, the
proxy suppresses the quota payload and ends the client stream with a completion
frame because there is no valid account left to continue the task.

## Persistent Account State

The account pool is not only in memory:

1. Batch-imported auth files in the app-managed directory are synchronized to
   SQLite `proxy_accounts`.
2. Existing `proxy_accounts.status = exhausted` rows are applied before routing
   after a restart.
3. Each selected or retried account is recorded in `proxy_routing_events`.
4. Each WSS quota exhaustion is recorded in `proxy_quota_events` with plan,
   active-limit, used-percent, reset-at, and message fields when present.
5. Clearing proxy records resets account exhaustion state back to available.
6. Disabled accounts are applied before routing and are excluded from existing
   conversation bindings.
7. In-memory conversation bindings are pruned after 24 hours.

The proxy still does not persist raw auth secrets in SQLite.

The proxy must not expose a custom account-directory setting. Runtime routing,
batch import, export, enable/disable, usage checks, and cleanup all operate on
the app-managed auth-pool directory so the displayed account state matches the
accounts that can actually be selected.

## Token State Rule

The HTTP and WSS forwarding paths do not refresh managed ChatGPT tokens. They
classify account outcomes such as quota exhaustion, token expiry, or account
unavailability, then mark the account state for later app-side maintenance.

Refresh and account recovery belong to the main app account-maintenance flow.
They are not quota events, do not rewrite an already-upgraded WSS connection,
and do not run inside the quota switch state machine.

## Usage Query Rule

`/backend-api/wham/usage` and related usage surfaces must return real upstream
usage for the account that the proxy will use, not a fabricated constant such as
always 100%.

The routing rule is:

1. If the request has a conversation key, use that conversation's bound account.
2. If there is no conversation key, use the current default available account.
3. If the current default account was marked exhausted, select the next available
   account before forwarding usage.
4. If all accounts are exhausted, return the real upstream exhausted/100% state
   from the last attempted account or fail normally.

This keeps Codex UI state aligned with the account that will actually receive
the next request, while avoiding fake low or fake high quota values.

Only this condition counts as quota exhaustion:

- upstream WSS text payload decodes as JSON;
- payload has `type: "error"`;
- payload has `error.type: "usage_limit_reached"`;
- optional headers may include `X-Codex-Primary-Used-Percent: "100"` and reset
  timestamps.

These conditions do not count:

- socket `close` without the structured quota payload;
- local `EPIPE`;
- reconnects caused by network or proxy failures;
- Yakit/MITM HTML error pages;
- non-quota 4xx/5xx transport failures.

## Usage-Limit Sample

Captured with Docker Codex CLI `0.130.0` and both base URLs pointing at
CodexFree:

```toml
chatgpt_base_url = "http://host.docker.internal:33333/backend-api"
openai_base_url = "http://host.docker.internal:33333/backend-api/codex"
```

Codex CLI output:

```text
You've hit your usage limit. Upgrade to Plus to continue using Codex
(https://chatgpt.com/explore/plus), or try again at May 20th, 2026 3:15 AM.
```

Matching proxy request:

- request id: `<uuid>`
- path: `GET /backend-api/codex/responses`
- session/thread id: `019e<thread-redacted>`
- HTTP response: `101 Switching Protocols`

The quota signal is not visible as a non-101 HTTP status. It arrives after the
WebSocket upgrade, so quota detection must inspect WebSocket messages or use a
Yakit export that includes WebSocket frames.

The latest decoded sample was captured in
`/tmp/codexfree-ws-loop-usage.jsonl` with raw capture id
`<uuid>`. The upstream frame was compressed but
decoded successfully into:

- `type: "error"`
- `error.type: "usage_limit_reached"`
- `status_code: 429`
- `headers.X-Codex-Active-Limit: "premium"`
- `headers.X-Codex-Plan-Type: "free"`
- `headers.X-Codex-Primary-Used-Percent: "100"`
- `headers.X-Codex-Primary-Window-Minutes: "10080"`
- `headers.X-Codex-Primary-Reset-At: "1779268417"`

The proxy should mark quota exhaustion only from this decoded application
payload. A WebSocket close, `EPIPE`, HTTP 101, Yakit HTML error response, or
network reconnect by itself is not a quota signal.

## Same-Session Account Switch Sample

Captured with:

```text
codex exec "Reply exactly: same-session-1"
codex exec resume <same-thread-id> "Reply exactly: same-session-2"
codex exec resume <same-thread-id> "Reply exactly: same-session-3"
```

Each command used a different `~/.codex/auth.json` copied from `test/*.auth.json`.
All requests went through CodexFree without Yakit proxy variables.

Results:

- capture root: `test/raw-captures/same-session-account-switch`
- same thread id: `019e<thread-redacted>`
- step 1 returned: `same-session-1`
- step 2 returned: `same-session-2`
- step 3 returned: `same-session-3`

Per-step WSS account identity:

| Step | Account file | `chatgpt-account-id` | Auth fingerprint |
|------|--------------|----------------------|------------------|
| 1 | `<email>` | `<uuid>` | `777eaf6ff1ad0ce6` |
| 2 | `<email>` | `<uuid>` | `d06178a409679a05` |
| 3 | `<email>` | `<uuid>` | `376c9f1e3dd4503a` |

Per-step session identity:

| Field | Step 1 | Step 2 | Step 3 |
|-------|--------|--------|--------|
| `thread_id` | same | same | same |
| `session_id` | same | same | same |
| `x-client-request-id` | same | same | same |
| `x-codex-window-id` | same | same | same |
| `x-codex-turn-metadata` | same JSON, empty `turn_id` | same JSON, empty `turn_id` | same JSON, empty `turn_id` |
| `sec-websocket-key` | different | different | different |

Conclusion: account switching inside one Codex conversation is compatible with
the observed protocol when it happens at the next WSS upgrade boundary and only
auth identity headers are replaced.

## Verified

- A successful account-mode response sample through the proxy.
- Four independent free-account `hi` samples through the proxy.
- Three same-session resume samples using three different accounts.
- WebSocket upgrade returned `101 Switching Protocols` through the proxy.
- The forwarded `.http` capture showed `Authorization`,
  `chatgpt-account-id`, `Host: chatgpt.com`, and
  `/backend-api/codex/responses`.
- The raw capture now writes only four `.http` files per request:
  Codex-to-proxy request, proxy-to-Codex response, proxy-to-ChatGPT request, and
  ChatGPT-to-proxy response.
- `test/History-1778652315307.har` verified the `/backend-api/codex` base URL
  shape. `models` returned `200`, `responses` returned WebSocket `101`, and
  auxiliary interfaces matched the raw `.http` capture with unchanged bodies and
  selected auth/protocol headers. The only intentional request-header difference
  across the proxy boundary was the `Host` value.
- WebSocket frame capture writes `websocket-upstream-to-codex.frames.jsonl` and
  `websocket-codex-to-upstream.frames.jsonl`; upstream compressed text frames
  are decoded with connection-level `permessage-deflate` state.
- The decoded upstream WSS frame observer parses `usage_limit_reached` messages
  and updates the matching request ledger row to `quota_exhausted` with status
  `429`.
- The in-memory account pool binds accounts per conversation key and switches to
  the next available account on the next WSS request after quota exhaustion.

## Still Needed

- More real-world sub2api auth-file variants.
- Encrypted or platform-protected storage for imported auth payloads.
- UI drill-down for persistent routing and quota-event tables.
- Separate explicit API-key compatibility listener if that future phase is
  approved.
