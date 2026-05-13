# Transparent Proxy MVP Spec

## Status

Ready.

## Goal

Start a local forwarding service that can observe real Codex traffic before the
account-mode packet contract is fully finalized.

## Scope

- Listen on a configurable host and port.
- Forward `/v1/*` requests to a configurable upstream base URL.
- Support outbound modes: direct, HTTP proxy, HTTPS proxy, SOCKS4, SOCKS5.
- Preserve request body bytes.
- Preserve streaming responses.
- Record redacted request metadata in SQLite.
- Write four protocol-shaped HTTP packet files only when explicit debug capture
  is enabled.

## Defaults

- Listen host: `0.0.0.0`.
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
surfaces through the local proxy:

- `GET /v1/models?client_version=0.130.0`
- `GET /v1/responses` with `connection: Upgrade` and WebSocket beta headers
- `POST /v1/responses` with `accept: text/event-stream` fallback

The proxy records `chatgpt-account-id` as account metadata and records
`thread_id`, `session_id`, or `x-client-request-id` as the conversation key.

When `openai_base_url` is set, Codex emits local OpenAI-compatible paths such as
`/v1/models` and `/v1/responses`. The proxy maps those to the ChatGPT account
upstream paths observed in HAR:

- `/v1/models` -> `/backend-api/codex/models`
- `/v1/responses` -> `/backend-api/codex/responses`
