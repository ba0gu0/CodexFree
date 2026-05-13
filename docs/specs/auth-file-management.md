# Auth File Management Spec

## Status

In Progress.

Codex native auth files and flat Codex/CPA-compatible token records are covered
by the first pure normalization module. sub2api parsing remains draft until a
real sample file is provided.

## Supported Formats

- Codex authenticated `auth.json`.
- CPA format auth file.
- sub2api format auth file.

Sample files are still required before parsers can be marked Ready.

Current parser coverage:

- native Codex `auth.json` with `auth_mode = "chatgpt"` and nested `tokens`;
- flat token records with `id_token`, `access_token`, `refresh_token`,
  `account_id`, and `last_refresh`;
- CPA records declared through `type = "cpa"` or inferred from filename.

sub2api records are only accepted when they expose the same required token
fields as the flat Codex shape.

## Normalized Shape

The normalizer returns:

- safe metadata: format, label, account id, optional email, disabled state,
  optional expiry, last refresh timestamp, stable fingerprint, and warnings;
- canonical Codex account-login auth shape for later secure storage or export.

The fingerprint is derived from account id plus token values so duplicate files
can be detected without displaying raw secrets.

## Import

Batch import must:

- detect format;
- normalize account metadata;
- validate required fields without logging secrets;
- deduplicate accounts with stable identifiers where possible;
- mark unsupported or malformed files with actionable errors.

Parser errors must name the missing or invalid field but must not include token
values.

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
