# Auth File Management Spec

## Status

Draft.

## Supported Formats

- Codex authenticated `auth.json`.
- CPA format auth file.
- sub2api format auth file.

Sample files are still required before parsers can be marked Ready.

## Import

Batch import must:

- detect format;
- normalize account metadata;
- validate required fields without logging secrets;
- deduplicate accounts with stable identifiers where possible;
- mark unsupported or malformed files with actionable errors.

## Export

Batch export must support:

- Codex `auth.json` format;
- CPA format;
- sub2api format.

Export must not include disabled accounts unless the user explicitly selects
them.

## Usage Query

The UI should support batch quota or usage queries for selected accounts and
store results in SQLite with timestamp, status, and error reason.
