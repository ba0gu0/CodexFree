# Account Routing and Quota Switching Draft

## Status

Draft. Depends on a confirmed quota-exhausted response sample.

## Observed Codex 0.130 Traffic

The `codex` Docker container was configured with:

```toml
openai_base_url = "http://10.211.55.2:33333/v1"
```

Observed request surfaces:

- `GET /v1/models?client_version=0.130.0`
- `GET /v1/responses` with WebSocket upgrade headers
- `POST /v1/responses` with `accept: text/event-stream`

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

- `openai_base_url = "http://10.211.55.2:33333/v1"` emits `/v1/models` and
  `/v1/responses`; the proxy maps those local paths back to the ChatGPT
  account-mode upstream.
- `openai_base_url = "http://10.211.55.2:33333/backend-api/codex"` emits
  `/backend-api/codex/models` and `/backend-api/codex/responses` on the
  Codex-to-proxy side.

The second shape should be preferred when the local proxy must observe the same
account backend path family that native ChatGPT account-mode traffic uses.

Useful headers:

- `authorization`: upstream bearer token; replace only on account-mode requests.
- `chatgpt-account-id`: upstream account id; replace with the selected auth file.
- `thread_id` / `session_id`: conversation identity.
- `x-client-request-id`: conversation-level request id fallback.
- `x-codex-turn-metadata`: JSON metadata containing `turn_id`.
- `x-codex-window-id`: conversation window id.

## Auth Replacement Boundary

For account-mode requests, the proxy may replace only upstream auth identity:

- `Authorization`
- `Chatgpt-Account-Id`

The proxy must not mutate the body, model, messages, tool payload, compression,
streaming headers, or user-visible conversation fields.

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

## Quota Switching Rule

When a response is confirmed as quota exhaustion:

- mark the bound account unavailable for future eligible turns;
- record the quota event against account id, run key, path, status, and body
  fingerprint;
- do not replay the current in-flight turn with a different auth file;
- allow the next user message in the same conversation to select a new auth file
  because it should have a new `turn_id`.

This preserves conversation safety: the currently running turn either finishes
or fails with its original account, while the next turn can move to a fresh
account.

## Verified

- A successful account-mode response sample through the proxy.
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

## Still Needed

- A quota-exhausted response sample with status, body fields, and headers.
- Confirmation that new user messages in the same conversation always get a new
  `turn_id`.
- Retention policy for account/run binding rows.
