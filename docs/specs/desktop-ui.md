# Desktop UI Spec

## Status

Initial mode. The current renderer is only a shell placeholder while the app UI
is planned for a clean refactor. This document describes the target structure
for that refactor, not a completed renderer implementation.

## Main Layout

Use an operations-console layout rather than a marketing layout.

Use Tailwind CSS and Coss UI components. Coss UI follows shadcn-style component
installation and uses Base UI primitives; do not use Radix UI as the default
primitive layer.

## Renderer Architecture

Renderer code must follow this structure:

- `src/renderer/src/App.tsx` owns shell state, view routing, locale/theme, and
  IPC refresh wiring only.
- `src/renderer/src/components/` holds reusable shell, table, panel, badge,
  form, and layout primitives.
- `src/renderer/src/pages/` holds one page module per primary view.
- `src/renderer/src/data/` holds derived models, grouping helpers, and
  formatting helpers.
- `src/renderer/src/i18n/` holds view-copy selection and locale-specific copy.
- `src/renderer/src/assets/` holds global CSS only.

The renderer must not keep all page markup in a single large file. View-specific
data derivation must live outside the page component.

## UI Component Policy

- Prefer Coss UI components first.
- If Coss UI does not provide the needed component or behavior, use the shadcn
  component from the same `components/ui/` layer.
- Keep the component layer source-owned in the repo; do not invent parallel
  local primitives for Button, Card, Table, Badge, Input, Switch, Tabs, or
  similar controls when Coss/shadcn equivalents exist.
- Use `lucide-react` icons for action buttons and status markers.
- Keep account tokens and auth fields masked by default.
- Use dense, scan-friendly tables for accounts, requests, and usage records.
- Avoid marketing-style cards and hero sections in the app shell.

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
- proxy request body size limit (`maxRequestBodyBytes`);
- local certificate status and setup instructions.

## Component Rules

- Use Coss UI components before creating local primitives.
- Use shadcn UI only when Coss UI lacks the needed primitive or pattern.
