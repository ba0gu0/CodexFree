# Security Checklist

## Auth Secrets

- Never log raw auth file contents.
- Never log authorization headers, cookies, access tokens, or refresh tokens.
- Protocol-shaped `.http` packets may be captured only when an explicit debug
  setting is enabled for local analysis.
- Protocol-shaped `.http` captures contain raw authorization headers and
  must be treated as secrets.
- Debug raw capture must write outside the repository into the app data
  `raw-captures` directory and must be disabled by default.
- Mask secrets in UI by default.
- Keep imported auth files out of git.
- Define encryption or platform credential storage before production use.

## Proxy Safety

- Reject API-key mode requests on the normal account-login proxy.
- Keep any future API-key compatibility service on a separate port with an
  explicit off-by-default switch and a visible account-ban/detection warning.
- Treat local compatibility API keys as secrets and never log them.
- Forward account-mode request bodies unchanged.
- Enforce a local request body size limit before forwarding upstream.
- Mutate only upstream authentication headers.
- Do not add diagnostic headers containing account identifiers unless explicitly
  approved.
- Keep quota and auth switching decisions auditable without storing secrets.
- Record successful admin write operations in the ledger audit log.

## Account Protection

- Treat unknown request shapes as blocked until packet evidence proves they are
  account-mode compatible.
- Do not retry quota-exhausted requests in a loop.
- Do not mix auth state across concurrently active runs.
- Avoid behavior that could look like automated abuse or token sharing beyond
  the user's local account pool management.

## Local Machine Safety

- Do not overwrite existing `~/.codex/config.toml` or `~/.codex/auth.json`
  without backup and explicit user confirmation.
- Generated placeholder auth files must be clearly marked as local proxy tokens.
- Local certificate generation and trust-store changes require explicit user
  confirmation.
