# Desktop UI Spec

## Status

Draft.

## Main Layout

Use an operations-console layout rather than a marketing layout.

Use Tailwind CSS and Coss UI components. Coss UI follows shadcn-style component
installation and uses Base UI primitives; do not use Radix UI as the default
primitive layer.

Recommended primary navigation:

- Dashboard
- Accounts
- Proxy
- Requests
- Usage
- Settings

## Dashboard

Show:

- proxy running state;
- active account;
- available account count;
- quota-exhausted count;
- recent switching events;
- request volume summary.

## Accounts

Support:

- batch import;
- batch export;
- format filter;
- status filter;
- enable and disable;
- batch usage query;
- masked secret details;
- per-account request and quota history.

## Requests

Support:

- request timeline;
- account used;
- upstream outcome;
- quota detection marker;
- API-key rejection marker;
- conversation or run grouping after packet evidence confirms identifiers.

## Settings

Support:

- display local proxy endpoint;
- helper for `~/.codex/config.toml` setup;
- placeholder `~/.codex/auth.json` generation workflow;
- SQLite data retention settings;
- local certificate status and setup instructions.

## Component Rules

- Use Coss UI components before creating local primitives.
- Use `lucide-react` icons for action buttons and status markers.
- Keep account tokens and auth fields masked by default.
- Use dense, scan-friendly tables for accounts, requests, and usage records.
- Avoid marketing-style cards and hero sections in the app shell.
