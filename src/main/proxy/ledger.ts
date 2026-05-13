import Database from 'better-sqlite3'
import type { RecentRequest, RequestLedgerEntry } from './types'

export class ProxyLedger {
  private readonly sqlite: Database.Database

  constructor(databasePath: string) {
    this.sqlite = new Database(databasePath)
    this.sqlite.pragma('journal_mode = WAL')
    this.sqlite.exec(`
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
        raw_capture_path TEXT,
        error_message TEXT,
        conversation_key TEXT,
        started_at INTEGER NOT NULL,
        completed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS proxy_requests_started_at_idx
        ON proxy_requests(started_at);
    `)
  }

  insert(entry: RequestLedgerEntry): void {
    this.sqlite
      .prepare(`
        INSERT INTO proxy_requests (
          id, account_id, method, path, mode, outcome, status_code, duration_ms,
          request_bytes, response_bytes, streaming, upstream_host, outbound_mode,
          auth_header_present, cookie_header_present, auth_fingerprint,
          cookie_fingerprint, raw_capture_path, error_message, conversation_key,
          started_at, completed_at
        ) VALUES (
          @id, @accountId, @method, @path, @mode, @outcome, @statusCode,
          @durationMs, @requestBytes, @responseBytes, @streaming, @upstreamHost,
          @outboundMode, @authHeaderPresent, @cookieHeaderPresent,
          @authFingerprint, @cookieFingerprint, @rawCapturePath, @errorMessage,
          @conversationKey, @startedAt, @completedAt
        )
      `)
      .run({
        ...entry,
        accountId: entry.accountId ?? null,
        statusCode: entry.statusCode ?? null,
        streaming: entry.streaming ? 1 : 0,
        authHeaderPresent: entry.authHeaderPresent ? 1 : 0,
        cookieHeaderPresent: entry.cookieHeaderPresent ? 1 : 0,
        authFingerprint: entry.authFingerprint ?? null,
        cookieFingerprint: entry.cookieFingerprint ?? null,
        rawCapturePath: entry.rawCapturePath ?? null,
        errorMessage: entry.errorMessage ?? null,
        conversationKey: entry.conversationKey ?? null,
        startedAt: entry.startedAt.getTime(),
        completedAt: entry.completedAt.getTime()
      })
  }

  recent(limit = 20): RecentRequest[] {
    return this.sqlite
      .prepare(`
        SELECT
          id,
          method,
          path,
          outcome,
          status_code AS statusCode,
          duration_ms AS durationMs,
          streaming,
          upstream_host AS upstreamHost,
          outbound_mode AS outboundMode,
          raw_capture_path AS rawCapturePath,
          started_at AS startedAt
        FROM proxy_requests
        ORDER BY started_at DESC
        LIMIT ?
      `)
      .all(limit) as RecentRequest[]
  }
}
