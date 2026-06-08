import type Database from 'better-sqlite3'

export function initializeLedgerSchema(sqlite: Database.Database): void {
  sqlite.pragma('journal_mode = WAL')
  sqlite.exec(`
    DROP TABLE IF EXISTS app_settings;
    CREATE TABLE IF NOT EXISTS proxy_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
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
      request_purpose TEXT,
      request_content_type TEXT,
      response_content_type TEXT,
      request_model TEXT,
      response_model TEXT,
      response_plan_type TEXT,
      response_primary_used_percent TEXT,
      response_rate_limit_reset_at INTEGER,
      response_active_limit TEXT,
      response_item_count INTEGER,
      request_input_item_count INTEGER,
      request_body_encoding TEXT,
      rpc_method TEXT,
      rpc_id TEXT,
      analytics_event_types TEXT,
      input_tokens INTEGER,
      cached_input_tokens INTEGER,
      output_tokens INTEGER,
      reasoning_tokens INTEGER,
      total_tokens INTEGER,
      token_usage_source TEXT,
      user_agent TEXT,
      originator TEXT,
      summary_json TEXT,
      codex_session_id TEXT,
      codex_thread_id TEXT,
      codex_turn_id TEXT,
      codex_turn_started_at INTEGER,
      codex_version TEXT,
      codex_runtime_os TEXT,
      codex_runtime_arch TEXT,
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
      email TEXT,
      fingerprint TEXT NOT NULL,
      source_format TEXT,
      status TEXT NOT NULL,
      exhausted_at INTEGER,
      quota_reset_at INTEGER,
      refreshable INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 0,
      local_auth INTEGER NOT NULL DEFAULT 0,
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
      protocol_type TEXT,
      sequence_number INTEGER,
      response_id TEXT,
      model TEXT,
      previous_response_id TEXT,
      parent_response_id TEXT,
      item_id TEXT,
      call_id TEXT,
      input_item_count INTEGER,
      tool_count INTEGER,
      input_tokens INTEGER,
      cached_input_tokens INTEGER,
      output_tokens INTEGER,
      reasoning_tokens INTEGER,
      total_tokens INTEGER,
      payload_bytes INTEGER,
      truncated INTEGER,
      summary_json TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS proxy_protocol_messages_request_idx
      ON proxy_protocol_messages(request_id, created_at);
    CREATE INDEX IF NOT EXISTS proxy_protocol_messages_conversation_idx
      ON proxy_protocol_messages(conversation_key, created_at);
    CREATE TABLE IF NOT EXISTS proxy_turn_summaries (
      id TEXT PRIMARY KEY,
      turn_key TEXT NOT NULL UNIQUE,
      request_id TEXT NOT NULL,
      conversation_key TEXT,
      account_id TEXT,
      codex_thread_id TEXT,
      codex_turn_id TEXT,
      response_id TEXT,
      parent_response_id TEXT,
      user_text TEXT,
      assistant_text TEXT,
      tool_call_count INTEGER NOT NULL DEFAULT 0,
      tool_result_count INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER,
      cached_input_tokens INTEGER,
      output_tokens INTEGER,
      reasoning_tokens INTEGER,
      total_tokens INTEGER,
      status TEXT,
      summary_json TEXT,
      started_at INTEGER,
      completed_at INTEGER,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS proxy_turn_summaries_request_idx
      ON proxy_turn_summaries(request_id, updated_at);
    CREATE INDEX IF NOT EXISTS proxy_turn_summaries_conversation_idx
      ON proxy_turn_summaries(conversation_key, updated_at);
    CREATE TABLE IF NOT EXISTS proxy_log_events (
      id TEXT PRIMARY KEY,
      level TEXT NOT NULL,
      event_type TEXT,
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
    ['source_format', 'ALTER TABLE proxy_accounts ADD COLUMN source_format TEXT'],
    ['email', 'ALTER TABLE proxy_accounts ADD COLUMN email TEXT'],
    ['plan_type', 'ALTER TABLE proxy_accounts ADD COLUMN plan_type TEXT'],
    ['primary_used_percent', 'ALTER TABLE proxy_accounts ADD COLUMN primary_used_percent TEXT'],
    ['secondary_used_percent', 'ALTER TABLE proxy_accounts ADD COLUMN secondary_used_percent TEXT'],
    ['rate_limit_resets_at', 'ALTER TABLE proxy_accounts ADD COLUMN rate_limit_resets_at INTEGER'],
    [
      'secondary_rate_limit_resets_at',
      'ALTER TABLE proxy_accounts ADD COLUMN secondary_rate_limit_resets_at INTEGER'
    ],
    [
      'last_quota_refreshed_at',
      'ALTER TABLE proxy_accounts ADD COLUMN last_quota_refreshed_at INTEGER'
    ],
    [
      'last_quota_refreshed_reset_at',
      'ALTER TABLE proxy_accounts ADD COLUMN last_quota_refreshed_reset_at INTEGER'
    ],
    [
      'last_usage_checked_at',
      'ALTER TABLE proxy_accounts ADD COLUMN last_usage_checked_at INTEGER'
    ],
    ['last_usage_error', 'ALTER TABLE proxy_accounts ADD COLUMN last_usage_error TEXT'],
    ['refreshable', 'ALTER TABLE proxy_accounts ADD COLUMN refreshable INTEGER NOT NULL DEFAULT 1'],
    ['active', 'ALTER TABLE proxy_accounts ADD COLUMN active INTEGER NOT NULL DEFAULT 0'],
    ['local_auth', 'ALTER TABLE proxy_accounts ADD COLUMN local_auth INTEGER NOT NULL DEFAULT 0']
  ])
  ensureColumns(sqlite, 'proxy_requests', [
    ['request_headers_json', 'ALTER TABLE proxy_requests ADD COLUMN request_headers_json TEXT'],
    ['response_headers_json', 'ALTER TABLE proxy_requests ADD COLUMN response_headers_json TEXT'],
    ['request_body_sample', 'ALTER TABLE proxy_requests ADD COLUMN request_body_sample TEXT'],
    ['response_body_sample', 'ALTER TABLE proxy_requests ADD COLUMN response_body_sample TEXT'],
    ['request_purpose', 'ALTER TABLE proxy_requests ADD COLUMN request_purpose TEXT'],
    ['request_content_type', 'ALTER TABLE proxy_requests ADD COLUMN request_content_type TEXT'],
    ['response_content_type', 'ALTER TABLE proxy_requests ADD COLUMN response_content_type TEXT'],
    ['request_model', 'ALTER TABLE proxy_requests ADD COLUMN request_model TEXT'],
    ['response_model', 'ALTER TABLE proxy_requests ADD COLUMN response_model TEXT'],
    ['response_plan_type', 'ALTER TABLE proxy_requests ADD COLUMN response_plan_type TEXT'],
    [
      'response_primary_used_percent',
      'ALTER TABLE proxy_requests ADD COLUMN response_primary_used_percent TEXT'
    ],
    [
      'response_rate_limit_reset_at',
      'ALTER TABLE proxy_requests ADD COLUMN response_rate_limit_reset_at INTEGER'
    ],
    ['response_active_limit', 'ALTER TABLE proxy_requests ADD COLUMN response_active_limit TEXT'],
    ['response_item_count', 'ALTER TABLE proxy_requests ADD COLUMN response_item_count INTEGER'],
    [
      'request_input_item_count',
      'ALTER TABLE proxy_requests ADD COLUMN request_input_item_count INTEGER'
    ],
    ['request_body_encoding', 'ALTER TABLE proxy_requests ADD COLUMN request_body_encoding TEXT'],
    ['rpc_method', 'ALTER TABLE proxy_requests ADD COLUMN rpc_method TEXT'],
    ['rpc_id', 'ALTER TABLE proxy_requests ADD COLUMN rpc_id TEXT'],
    ['analytics_event_types', 'ALTER TABLE proxy_requests ADD COLUMN analytics_event_types TEXT'],
    ['input_tokens', 'ALTER TABLE proxy_requests ADD COLUMN input_tokens INTEGER'],
    ['cached_input_tokens', 'ALTER TABLE proxy_requests ADD COLUMN cached_input_tokens INTEGER'],
    ['output_tokens', 'ALTER TABLE proxy_requests ADD COLUMN output_tokens INTEGER'],
    ['reasoning_tokens', 'ALTER TABLE proxy_requests ADD COLUMN reasoning_tokens INTEGER'],
    ['total_tokens', 'ALTER TABLE proxy_requests ADD COLUMN total_tokens INTEGER'],
    ['token_usage_source', 'ALTER TABLE proxy_requests ADD COLUMN token_usage_source TEXT'],
    ['user_agent', 'ALTER TABLE proxy_requests ADD COLUMN user_agent TEXT'],
    ['originator', 'ALTER TABLE proxy_requests ADD COLUMN originator TEXT'],
    ['summary_json', 'ALTER TABLE proxy_requests ADD COLUMN summary_json TEXT'],
    ['codex_session_id', 'ALTER TABLE proxy_requests ADD COLUMN codex_session_id TEXT'],
    ['codex_thread_id', 'ALTER TABLE proxy_requests ADD COLUMN codex_thread_id TEXT'],
    ['codex_turn_id', 'ALTER TABLE proxy_requests ADD COLUMN codex_turn_id TEXT'],
    [
      'codex_turn_started_at',
      'ALTER TABLE proxy_requests ADD COLUMN codex_turn_started_at INTEGER'
    ],
    ['codex_version', 'ALTER TABLE proxy_requests ADD COLUMN codex_version TEXT'],
    ['codex_runtime_os', 'ALTER TABLE proxy_requests ADD COLUMN codex_runtime_os TEXT'],
    ['codex_runtime_arch', 'ALTER TABLE proxy_requests ADD COLUMN codex_runtime_arch TEXT']
  ])
  ensureColumns(sqlite, 'proxy_log_events', [
    ['event_type', 'ALTER TABLE proxy_log_events ADD COLUMN event_type TEXT'],
    ['detail_json', 'ALTER TABLE proxy_log_events ADD COLUMN detail_json TEXT'],
    ['request_id', 'ALTER TABLE proxy_log_events ADD COLUMN request_id TEXT'],
    ['account_id', 'ALTER TABLE proxy_log_events ADD COLUMN account_id TEXT'],
    ['conversation_key', 'ALTER TABLE proxy_log_events ADD COLUMN conversation_key TEXT'],
    ['path', 'ALTER TABLE proxy_log_events ADD COLUMN path TEXT'],
    ['method', 'ALTER TABLE proxy_log_events ADD COLUMN method TEXT']
  ])
  ensureColumns(sqlite, 'proxy_protocol_messages', [
    ['protocol_type', 'ALTER TABLE proxy_protocol_messages ADD COLUMN protocol_type TEXT'],
    ['sequence_number', 'ALTER TABLE proxy_protocol_messages ADD COLUMN sequence_number INTEGER'],
    ['response_id', 'ALTER TABLE proxy_protocol_messages ADD COLUMN response_id TEXT'],
    ['model', 'ALTER TABLE proxy_protocol_messages ADD COLUMN model TEXT'],
    [
      'previous_response_id',
      'ALTER TABLE proxy_protocol_messages ADD COLUMN previous_response_id TEXT'
    ],
    [
      'parent_response_id',
      'ALTER TABLE proxy_protocol_messages ADD COLUMN parent_response_id TEXT'
    ],
    ['item_id', 'ALTER TABLE proxy_protocol_messages ADD COLUMN item_id TEXT'],
    ['call_id', 'ALTER TABLE proxy_protocol_messages ADD COLUMN call_id TEXT'],
    ['input_item_count', 'ALTER TABLE proxy_protocol_messages ADD COLUMN input_item_count INTEGER'],
    ['tool_count', 'ALTER TABLE proxy_protocol_messages ADD COLUMN tool_count INTEGER'],
    ['input_tokens', 'ALTER TABLE proxy_protocol_messages ADD COLUMN input_tokens INTEGER'],
    [
      'cached_input_tokens',
      'ALTER TABLE proxy_protocol_messages ADD COLUMN cached_input_tokens INTEGER'
    ],
    ['output_tokens', 'ALTER TABLE proxy_protocol_messages ADD COLUMN output_tokens INTEGER'],
    ['reasoning_tokens', 'ALTER TABLE proxy_protocol_messages ADD COLUMN reasoning_tokens INTEGER'],
    ['total_tokens', 'ALTER TABLE proxy_protocol_messages ADD COLUMN total_tokens INTEGER'],
    ['payload_bytes', 'ALTER TABLE proxy_protocol_messages ADD COLUMN payload_bytes INTEGER'],
    ['truncated', 'ALTER TABLE proxy_protocol_messages ADD COLUMN truncated INTEGER'],
    ['summary_json', 'ALTER TABLE proxy_protocol_messages ADD COLUMN summary_json TEXT']
  ])
  ensureColumns(sqlite, 'proxy_turn_summaries', [
    ['parent_response_id', 'ALTER TABLE proxy_turn_summaries ADD COLUMN parent_response_id TEXT'],
    ['summary_json', 'ALTER TABLE proxy_turn_summaries ADD COLUMN summary_json TEXT']
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
  const allowedTables = new Set([
    'proxy_accounts',
    'proxy_requests',
    'proxy_log_events',
    'proxy_protocol_messages',
    'proxy_turn_summaries',
    'proxy_settings'
  ])
  if (!allowedTables.has(table)) {
    throw new Error(`Unsupported migration table: ${table}`)
  }
}
