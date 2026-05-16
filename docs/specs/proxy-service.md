# Proxy Service Spec

## Status

Ready for account-login proxy core. API-key compatibility remains a separate
future phase.

## Goal

Expose local `/backend-api` and `/backend-api/codex` endpoints that Codex can
use as `chatgpt_base_url` and `openai_base_url` while the proxy forwards
account-login traffic through managed auth files.

## Required Behavior

- Listen on `http://127.0.0.1:33333/backend-api` and
  `http://127.0.0.1:33333/backend-api/codex` by default.
- Reserve `/v1` for the separate API-key compatibility mode.
- Accept only Codex account-mode traffic.
- Reject API-key mode traffic on the account-login proxy.
- Do not modify request body bytes.
- Replace only upstream authentication-related headers.
- Load routeable accounts only from the app-managed batch-import directory.
- Preserve streaming behavior expected by Codex.
- Record request metadata and routing outcome in SQLite.

## Future API-key Compatibility Mode

API-key compatibility is a separate next-stage feature, not part of the default
account-login proxy. If enabled later, it must:

- be disabled by default;
- use a separate listener port and explicit operator-provided local API key;
- show a clear warning that this behavior can be detected and may cause account
  restrictions or bans;
- accept only `/v1/models` and `/v1/responses`;
- return `/v1/models` using the standard OpenAI model-list response shape,
  converted from the upstream account models payload;
- adapt each external request to the standard account WebSocket flow against
  `/backend-api/codex/responses`;
- close the upstream WebSocket after the single external request completes;
- keep account-login proxy request body forwarding rules unchanged.

## Quota Switching

A real usage-limit sample showed that the main `responses` request still returns
HTTP `101 Switching Protocols`; the quota error is delivered inside the
WebSocket message stream after upgrade. The proxy must therefore classify quota
events from WebSocket frames, not from the HTTP upgrade status alone.

Raw capture now stores upgraded WebSocket traffic in JSONL frame files. The
upstream `usage_limit_reached` message is compressed with `permessage-deflate`,
so the capture layer must keep a connection-level inflater context and decode
the payload before quota classification.

When quota exhaustion is detected:

- mark the current auth file unavailable for future eligible requests;
- before any upstream business frame is forwarded, suppress the quota frame,
  reconnect upstream with the next account, and replay buffered client frames;
- after normal upstream streaming has begun, keep the active stream on its
  original auth and select a replacement account only for the next eligible
  request;
- write an audit event with account, request, and detection reason metadata.

Current implementation status: decoded upstream WebSocket frames are parsed for
`usage_limit_reached`; the request ledger is updated to `quota_exhausted`; the
bound account is marked exhausted; and the next eligible request or WSS upgrade
selects another available account. A narrow initial-WSS retry shield hides a
quota frame only when no upstream business frame has been forwarded yet and
another account is available.

## Packet Evidence Required

The account-login proxy core reached Ready after captures identified:

- normal request and response shape;
- streaming request and response details;
- quota-exhaustion status, body, and headers;
- WebSocket frame payload for the usage-limit event;
- account-mode versus API-key mode signals;
- fields that identify conversation, run, or next user-message boundaries.

Remaining future work is limited to storage hardening, richer operator
diagnostics, and the separate disabled-by-default API-key compatibility mode.
