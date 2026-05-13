import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  format: text('format', { enum: ['codex', 'cpa', 'sub2api'] }).notNull(),
  status: text('status', {
    enum: ['available', 'disabled', 'quota_exhausted', 'invalid']
  }).notNull(),
  fingerprint: text('fingerprint').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
})

export const proxyRequests = sqliteTable('proxy_requests', {
  id: text('id').primaryKey(),
  accountId: text('account_id').references(() => accounts.id),
  method: text('method').notNull(),
  path: text('path').notNull(),
  mode: text('mode', { enum: ['account', 'api_key', 'unknown'] }).notNull(),
  outcome: text('outcome', {
    enum: ['forwarded', 'rejected', 'quota_exhausted', 'failed']
  }).notNull(),
  statusCode: integer('status_code'),
  durationMs: integer('duration_ms').notNull(),
  requestBytes: integer('request_bytes').notNull(),
  responseBytes: integer('response_bytes').notNull(),
  streaming: integer('streaming', { mode: 'boolean' }).notNull(),
  upstreamHost: text('upstream_host').notNull(),
  outboundMode: text('outbound_mode', {
    enum: ['direct', 'http', 'https', 'socks4', 'socks5']
  }).notNull(),
  authHeaderPresent: integer('auth_header_present', { mode: 'boolean' }).notNull(),
  cookieHeaderPresent: integer('cookie_header_present', { mode: 'boolean' }).notNull(),
  authFingerprint: text('auth_fingerprint'),
  cookieFingerprint: text('cookie_fingerprint'),
  rawCapturePath: text('raw_capture_path'),
  errorMessage: text('error_message'),
  conversationKey: text('conversation_key'),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp_ms' })
})
