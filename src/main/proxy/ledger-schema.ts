import type Database from 'better-sqlite3'

export function initializeLedgerSchema(sqlite: Database.Database): void {
  sqlite.pragma('journal_mode = WAL')
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS proxy_requests (
      id TEXT PRIMARY KEY,
      account_id TEXT,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      mode TEXT NOT NULL,
      outcome TEXT NOT NULL,
      status_code INTEGER,
      duration_ms INTEGER NOT NULL,
      request_bytes INTEGER NOT NULL,
      response_bytes INTEGER NOT NULL,
      streaming INTEGER NOT NULL,
      upstream_host TEXT NOT NULL,
      outbound_mode TEXT NOT NULL,
      auth_header_present INTEGER NOT NULL,
      cookie_header_present INTEGER NOT NULL,
      auth_fingerprint TEXT,
      cookie_fingerprint TEXT,
      request_headers_json TEXT,
      response_headers_json TEXT,
      request_body_sample TEXT,
      response_body_sample TEXT,
      raw_capture_path TEXT,
      error_message TEXT,
      conversation_key TEXT,
      started_at INTEGER NOT NULL,
      completed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS proxy_requests_started_at_idx
      ON proxy_requests(started_at);
    CREATE TABLE IF NOT EXISTS proxy_accounts (
      account_id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      status TEXT NOT NULL,
      exhausted_at INTEGER,
      quota_reset_at INTEGER,
      active INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS proxy_routing_events (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      conversation_key TEXT,
      account_id TEXT,
      event_type TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS proxy_routing_events_request_idx
      ON proxy_routing_events(request_id);
    CREATE TABLE IF NOT EXISTS proxy_quota_events (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      conversation_key TEXT,
      account_id TEXT,
      status_code INTEGER,
      plan_type TEXT,
      active_limit TEXT,
      primary_used_percent TEXT,
      resets_at INTEGER,
      message TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS proxy_quota_events_account_idx
      ON proxy_quota_events(account_id, created_at);
    CREATE TABLE IF NOT EXISTS proxy_protocol_messages (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      path TEXT NOT NULL,
      account_id TEXT,
      conversation_key TEXT,
      direction TEXT NOT NULL,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS proxy_protocol_messages_request_idx
      ON proxy_protocol_messages(request_id, created_at);
    CREATE INDEX IF NOT EXISTS proxy_protocol_messages_conversation_idx
      ON proxy_protocol_messages(conversation_key, created_at);
    CREATE TABLE IF NOT EXISTS proxy_log_events (
      id TEXT PRIMARY KEY,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      detail_json TEXT,
      request_id TEXT,
      account_id TEXT,
      conversation_key TEXT,
      path TEXT,
      method TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS proxy_log_events_created_at_idx
      ON proxy_log_events(created_at);
  `)
  ensureColumns(sqlite, 'proxy_accounts', [
    ['plan_type', 'ALTER TABLE proxy_accounts ADD COLUMN plan_type TEXT'],
    ['primary_used_percent', 'ALTER TABLE proxy_accounts ADD COLUMN primary_used_percent TEXT'],
    ['secondary_used_percent', 'ALTER TABLE proxy_accounts ADD COLUMN secondary_used_percent TEXT'],
    ['rate_limit_resets_at', 'ALTER TABLE proxy_accounts ADD COLUMN rate_limit_resets_at INTEGER'],
    [
      'last_usage_checked_at',
      'ALTER TABLE proxy_accounts ADD COLUMN last_usage_checked_at INTEGER'
    ],
    ['last_usage_error', 'ALTER TABLE proxy_accounts ADD COLUMN last_usage_error TEXT'],
    ['active', 'ALTER TABLE proxy_accounts ADD COLUMN active INTEGER NOT NULL DEFAULT 0']
  ])
  ensureColumns(sqlite, 'proxy_requests', [
    ['request_headers_json', 'ALTER TABLE proxy_requests ADD COLUMN request_headers_json TEXT'],
    ['response_headers_json', 'ALTER TABLE proxy_requests ADD COLUMN response_headers_json TEXT'],
    ['request_body_sample', 'ALTER TABLE proxy_requests ADD COLUMN request_body_sample TEXT'],
    ['response_body_sample', 'ALTER TABLE proxy_requests ADD COLUMN response_body_sample TEXT']
  ])
  ensureColumns(sqlite, 'proxy_log_events', [
    ['detail_json', 'ALTER TABLE proxy_log_events ADD COLUMN detail_json TEXT'],
    ['request_id', 'ALTER TABLE proxy_log_events ADD COLUMN request_id TEXT'],
    ['account_id', 'ALTER TABLE proxy_log_events ADD COLUMN account_id TEXT'],
    ['conversation_key', 'ALTER TABLE proxy_log_events ADD COLUMN conversation_key TEXT'],
    ['path', 'ALTER TABLE proxy_log_events ADD COLUMN path TEXT'],
    ['method', 'ALTER TABLE proxy_log_events ADD COLUMN method TEXT']
  ])
}

function ensureColumns(
  sqlite: Database.Database,
  table: string,
  statements: ReadonlyArray<readonly [string, string]>
): void {
  assertSafeTableName(table)
  const columns = new Set(
    (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
      (column) => column.name
    )
  )
  for (const [name, statement] of statements) {
    if (!columns.has(name)) {
      sqlite.exec(statement)
    }
  }
}

function assertSafeTableName(table: string): void {
  const allowedTables = new Set(['proxy_accounts', 'proxy_requests', 'proxy_log_events'])
  if (!allowedTables.has(table)) {
    throw new Error(`Unsupported migration table: ${table}`)
  }
}
