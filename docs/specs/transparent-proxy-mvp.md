# Transparent Proxy MVP Spec

## Status

Ready.

## Goal

Start a local forwarding service that can observe real Codex traffic before the
account-mode packet contract is fully finalized.

## Scope

- Listen on a configurable host and port.
- Forward `/backend-api/codex/*` requests to a configurable upstream base URL.
- Treat `/v1/*` as future API-key compatibility scope, not account-login proxy
  default behavior.
- Support outbound modes: direct, HTTP proxy, HTTPS proxy, SOCKS4, SOCKS5.
- Preserve request body bytes.
- Preserve streaming responses.
- Record redacted request metadata in SQLite.
- Write four protocol-shaped HTTP packet files only when explicit debug capture
  is enabled.

## Defaults

- Listen host: `127.0.0.1`.
- Listen port: `33333`.
- Upstream base URL: `https://chatgpt.com/backend-api/codex`.
- Outbound mode: direct.
- Debug raw capture: disabled.
- Raw capture directory: system temp directory, under `CodexFree/raw-captures`.

## Ledger Fields

The ledger records request id, method, path, mode, outcome, status code,
duration, byte counts, streaming flag, upstream host, outbound mode, auth
presence flags, and short SHA-256 fingerprints for sensitive header values.

The ledger must not store raw tokens, raw cookies, raw authorization headers, or
raw auth files.

## Debug Raw Capture

When enabled, raw capture writes one request and one response packet for each
side of the proxy:

- `codex-inbound-request.http`: Codex client request to CodexFree.
- `codex-downstream-response.http`: CodexFree response back to Codex.
- `chatgpt-outbound-request.http`: CodexFree request to ChatGPT upstream.
- `chatgpt-upstream-response.http`: ChatGPT upstream response to CodexFree.

Each file uses HTTP protocol shape: start line, headers, blank line, and body
sample when available. The raw capture no longer writes extra `.json` or `.bin`
files.

This is for local protocol analysis only and must never write inside the repo.

## Non-Goals

- No auth header replacement.
- No quota switching.
- No API-key/account-mode enforcement.
- No HAR parser in this milestone.

## Codex 0.130 Observation

Container validation with `codex-cli 0.130.0` confirmed these account-mode
surfaces through the local proxy when using the preferred backend config:

- `GET /backend-api/codex/models?client_version=0.130.0`
- `GET /backend-api/codex/responses` with `connection: Upgrade` and WebSocket
  beta headers
- `POST /backend-api/codex/responses` with `accept: text/event-stream` fallback

The proxy records `chatgpt-account-id` as account metadata and records
`thread_id`, `session_id`, or `x-client-request-id` as the conversation key.

When `openai_base_url` is set to `/backend-api/codex`, Codex emits the same path
family observed in HAR. A future API-key compatibility mode can expose
OpenAI-style `/v1/models` and `/v1/responses`, but that mode must return
OpenAI-standard response shapes and stay separate from account-login proxying.
For example:

- `/v1/models` fetches upstream account models and converts them to the standard
  OpenAI model-list response shape.
- `/v1/responses` adapts a stateless OpenAI-style request to the account
  `/backend-api/codex/responses` flow.
