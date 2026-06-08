# Security Policy

CodexFree is a local desktop tool for managing Codex/ChatGPT account auth files and forwarding
account-mode traffic through a local proxy. It is not affiliated with OpenAI, ChatGPT, or Codex.

## Supported Versions

CodexFree is currently published as an alpha source release. Security fixes target the current
default branch unless a maintained release branch is explicitly announced.

## Reporting a Vulnerability

Prefer GitHub Security Advisories when reporting vulnerabilities. If that is not available, open a
public issue only with a minimal description and no secrets, then coordinate privately before
sharing any sensitive material.

Never attach or paste:

- real `auth.json` files;
- access tokens, refresh tokens, cookies, or authorization headers;
- raw capture files that may include request or response headers;
- local SQLite databases or exported account-pool data.

If a reproduction needs request data, redact tokens, account IDs, cookies, emails, and any
conversation content first.

## Security Scope

Reports are especially useful when they affect:

- secret redaction in logs, UI, exports, or raw captures;
- local proxy/admin authentication and access control;
- accidental writes to `~/.codex/auth.json` or `~/.codex/config.toml`;
- unsafe persistence of imported account auth files;
- packaging rules that accidentally include `test`, `dist`, captures, databases, or local secrets.

## Usage Boundary

Only import and use accounts or auth files that you own or are authorized to use. Account sharing,
quota pooling, and proxying may violate upstream service terms or trigger account restrictions.
CodexFree cannot prevent those external account risks.
