# Proxy Service Spec

## Status

Draft.

## Goal

Expose a local `/v1` endpoint that Codex can use as `openai_base_url` while the
proxy forwards account-login traffic through managed auth files.

## Required Behavior

- Listen on `https://127.0.0.1:55555/v1`.
- Accept only Codex account-mode traffic.
- Reject API-key mode traffic.
- Do not modify request body bytes.
- Replace only upstream authentication-related headers.
- Preserve streaming behavior expected by Codex.
- Record request metadata and routing outcome in SQLite.

## Quota Switching

When quota exhaustion is detected:

- mark the current auth file unavailable for future eligible requests;
- keep the current in-flight run bound to its original auth;
- select a replacement auth file for the next eligible user-message request;
- write an audit event with account, request, and detection reason metadata.

## Packet Evidence Required

Implementation cannot be Ready until Yakit exports identify:

- normal request and response shape;
- streaming request and response details;
- quota-exhaustion status, body, and headers;
- account-mode versus API-key mode signals;
- fields that identify conversation, run, or next user-message boundaries.
