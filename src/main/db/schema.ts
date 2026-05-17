import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const proxySettings = sqliteTable('proxy_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
})

export const proxyAccounts = sqliteTable('proxy_accounts', {
  accountId: text('account_id').primaryKey(),
  label: text('label').notNull(),
  email: text('email'),
  fingerprint: text('fingerprint').notNull(),
  status: text('status', { enum: ['available', 'exhausted', 'disabled'] }).notNull(),
  exhaustedAt: integer('exhausted_at', { mode: 'timestamp_ms' }),
  quotaResetAt: integer('quota_reset_at', { mode: 'timestamp_ms' }),
  planType: text('plan_type'),
  primaryUsedPercent: text('primary_used_percent'),
  secondaryUsedPercent: text('secondary_used_percent'),
  rateLimitResetsAt: integer('rate_limit_resets_at', { mode: 'timestamp_ms' }),
  lastUsageCheckedAt: integer('last_usage_checked_at', { mode: 'timestamp_ms' }),
  lastUsageError: text('last_usage_error'),
  active: integer('active', { mode: 'boolean' }).notNull().default(false),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
})

export const proxyRequests = sqliteTable('proxy_requests', {
  id: text('id').primaryKey(),
  accountId: text('account_id'),
  method: text('method').notNull(),
  path: text('path').notNull(),
  mode: text('mode', { enum: ['account', 'account_passthrough', 'api_key', 'unknown'] }).notNull(),
  outcome: text('outcome', {
    enum: ['forwarded', 'rejected', 'quota_exhausted', 'failed']
  }).notNull(),
  statusCode: integer('status_code'),
  durationMs: integer('duration_ms').notNull(),
  requestBytes: integer('request_bytes').notNull(),
  responseBytes: integer('response_bytes').notNull(),
  streaming: integer('streaming', { mode: 'boolean' }).notNull(),
  upstreamHost: text('upstream_host').notNull(),
  outboundMode: text('outbound_mode').notNull(),
  authHeaderPresent: integer('auth_header_present', { mode: 'boolean' }).notNull(),
  cookieHeaderPresent: integer('cookie_header_present', { mode: 'boolean' }).notNull(),
  authFingerprint: text('auth_fingerprint'),
  cookieFingerprint: text('cookie_fingerprint'),
  requestHeadersJson: text('request_headers_json'),
  responseHeadersJson: text('response_headers_json'),
  requestBodySample: text('request_body_sample'),
  responseBodySample: text('response_body_sample'),
  rawCapturePath: text('raw_capture_path'),
  errorMessage: text('error_message'),
  conversationKey: text('conversation_key'),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp_ms' })
})

export const proxyRoutingEvents = sqliteTable('proxy_routing_events', {
  id: text('id').primaryKey(),
  requestId: text('request_id').notNull(),
  conversationKey: text('conversation_key'),
  accountId: text('account_id'),
  eventType: text('event_type').notNull(),
  reason: text('reason').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
})

export const proxyQuotaEvents = sqliteTable('proxy_quota_events', {
  id: text('id').primaryKey(),
  requestId: text('request_id').notNull(),
  conversationKey: text('conversation_key'),
  accountId: text('account_id'),
  statusCode: integer('status_code'),
  planType: text('plan_type'),
  activeLimit: text('active_limit'),
  primaryUsedPercent: text('primary_used_percent'),
  resetsAt: integer('resets_at', { mode: 'timestamp_ms' }),
  message: text('message').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
})

export const proxyProtocolMessages = sqliteTable('proxy_protocol_messages', {
  id: text('id').primaryKey(),
  requestId: text('request_id').notNull(),
  path: text('path').notNull(),
  accountId: text('account_id'),
  conversationKey: text('conversation_key'),
  direction: text('direction').notNull(),
  kind: text('kind').notNull(),
  text: text('text').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
})

export const proxyLogEvents = sqliteTable('proxy_log_events', {
  id: text('id').primaryKey(),
  level: text('level').notNull(),
  eventType: text('event_type'),
  message: text('message').notNull(),
  detailJson: text('detail_json'),
  requestId: text('request_id'),
  accountId: text('account_id'),
  conversationKey: text('conversation_key'),
  path: text('path'),
  method: text('method'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
})
