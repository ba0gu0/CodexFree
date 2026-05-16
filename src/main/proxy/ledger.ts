import Database from 'better-sqlite3'
import {
  markAccountQuotaExhaustedInLedger,
  updateAccountUsageInLedger
} from './ledger-account-state'
import { initializeLedgerSchema } from './ledger-schema'
import type {
  AccountPoolSnapshot,
  AccountUsageInput,
  AccountUsageSummary,
  LogEventInput,
  LogEventRow,
  ManagedAccountRow,
  ProtocolMessageInput,
  ProtocolMessageRow,
  RoutingEventInput
} from './ledger-types'
import {
  clearLedgerTables,
  pruneLedgerTables,
  randomLedgerId,
  serializeLogDetail
} from './ledger-utils'
import type { QuotaExhaustionEvent } from './quota'
import type { RecentRequest, RequestLedgerEntry } from './types'

export class ProxyLedger {
  private static readonly defaultRetentionMs = 30 * 24 * 60 * 60 * 1000
  private readonly sqlite: Database.Database

  constructor(databasePath: string) {
    this.sqlite = new Database(databasePath)
    initializeLedgerSchema(this.sqlite)
    this.pruneOldRecords()
  }

  insert(entry: RequestLedgerEntry): void {
    this.sqlite
      .prepare(`
        INSERT INTO proxy_requests (
          id, account_id, method, path, mode, outcome, status_code, duration_ms,
          request_bytes, response_bytes, streaming, upstream_host, outbound_mode,
          auth_header_present, cookie_header_present, auth_fingerprint,
          cookie_fingerprint, request_headers_json, response_headers_json,
          request_body_sample, response_body_sample, raw_capture_path,
          error_message, conversation_key,
          started_at, completed_at
        ) VALUES (
          @id, @accountId, @method, @path, @mode, @outcome, @statusCode,
          @durationMs, @requestBytes, @responseBytes, @streaming, @upstreamHost,
          @outboundMode, @authHeaderPresent, @cookieHeaderPresent,
          @authFingerprint, @cookieFingerprint, @requestHeadersJson, @responseHeadersJson,
          @requestBodySample, @responseBodySample, @rawCapturePath, @errorMessage,
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
        requestHeadersJson: entry.requestHeadersJson ?? null,
        responseHeadersJson: entry.responseHeadersJson ?? null,
        requestBodySample: entry.requestBodySample ?? null,
        responseBodySample: entry.responseBodySample ?? null,
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

  markQuotaExhausted(id: string, errorMessage: string, completedAt: Date): void {
    this.sqlite
      .prepare(`
        UPDATE proxy_requests
        SET outcome = 'quota_exhausted',
            status_code = 429,
            error_message = @errorMessage,
            completed_at = @completedAt
        WHERE id = @id
      `)
      .run({
        id,
        errorMessage,
        completedAt: completedAt.getTime()
      })
  }

  syncAccountPool(accounts: AccountPoolSnapshot[]): void {
    const now = Date.now()
    const transaction = this.sqlite.transaction((items: AccountPoolSnapshot[]) => {
      const statement = this.sqlite.prepare(`
        INSERT INTO proxy_accounts (
          account_id, label, fingerprint, status, exhausted_at, quota_reset_at, updated_at
        ) VALUES (
          @accountId, @label, @fingerprint, 'available', NULL, NULL, @updatedAt
        )
        ON CONFLICT(account_id) DO UPDATE SET
          label = excluded.label,
          fingerprint = excluded.fingerprint,
          updated_at = excluded.updated_at
      `)
      for (const account of items) {
        statement.run({ ...account, updatedAt: now })
      }
      const accountIds = new Set(items.map((account) => account.accountId))
      const existingRows = this.sqlite
        .prepare('SELECT account_id AS accountId FROM proxy_accounts')
        .all() as { accountId: string }[]
      const deleteStatement = this.sqlite.prepare('DELETE FROM proxy_accounts WHERE account_id = ?')
      for (const row of existingRows) {
        if (!accountIds.has(row.accountId)) {
          deleteStatement.run(row.accountId)
        }
      }
    })
    transaction(accounts)
  }

  exhaustedAccountIds(): string[] {
    const rows = this.sqlite
      .prepare("SELECT account_id AS accountId FROM proxy_accounts WHERE status = 'exhausted'")
      .all() as { accountId: string }[]

    return rows.map((row) => row.accountId)
  }

  disabledAccountIds(): string[] {
    const rows = this.sqlite
      .prepare("SELECT account_id AS accountId FROM proxy_accounts WHERE status = 'disabled'")
      .all() as { accountId: string }[]

    return rows.map((row) => row.accountId)
  }

  accounts(): ManagedAccountRow[] {
    return this.sqlite
      .prepare(`
        SELECT
          account_id AS accountId,
          label,
          fingerprint,
          status,
          exhausted_at AS exhaustedAt,
          quota_reset_at AS quotaResetAt,
          plan_type AS planType,
          primary_used_percent AS primaryUsedPercent,
          secondary_used_percent AS secondaryUsedPercent,
          rate_limit_resets_at AS rateLimitResetsAt,
          last_usage_checked_at AS lastUsageCheckedAt,
          last_usage_error AS lastUsageError,
          active,
          updated_at AS updatedAt
        FROM proxy_accounts
        ORDER BY active DESC, label, account_id
      `)
      .all() as ManagedAccountRow[]
  }

  activeAccountId(): string | undefined {
    const row = this.sqlite
      .prepare('SELECT account_id AS accountId FROM proxy_accounts WHERE active = 1 LIMIT 1')
      .get() as { accountId: string } | undefined

    return row?.accountId
  }

  accountUsageSummary(accountId: string | undefined): AccountUsageSummary | undefined {
    if (!accountId) {
      return undefined
    }

    return this.sqlite
      .prepare(`
        SELECT
          plan_type AS planType,
          primary_used_percent AS primaryUsedPercent,
          rate_limit_resets_at AS rateLimitResetsAt
        FROM proxy_accounts
        WHERE account_id = ?
      `)
      .get(accountId) as AccountUsageSummary | undefined
  }

  setActiveAccount(accountId: string): number {
    const now = Date.now()
    return this.sqlite.transaction(() => {
      this.sqlite.prepare('UPDATE proxy_accounts SET active = 0 WHERE active = 1').run()
      return this.sqlite
        .prepare(`
          UPDATE proxy_accounts
          SET active = 1,
              updated_at = @updatedAt
          WHERE account_id = @accountId AND status = 'available'
        `)
        .run({ accountId, updatedAt: now }).changes
    })()
  }

  deleteAccounts(accountIds: string[]): number {
    if (accountIds.length === 0) {
      return 0
    }

    const transaction = this.sqlite.transaction((ids: string[]) => {
      const statement = this.sqlite.prepare('DELETE FROM proxy_accounts WHERE account_id = ?')
      let deleted = 0
      for (const accountId of ids) {
        deleted += statement.run(accountId).changes
      }
      return deleted
    })

    return transaction(accountIds)
  }

  resetExhaustedAccounts(accountIds?: string[]): number {
    const now = Date.now()
    if (accountIds && accountIds.length > 0) {
      const transaction = this.sqlite.transaction((ids: string[]) => {
        const statement = this.sqlite.prepare(`
          UPDATE proxy_accounts
          SET status = 'available',
              active = 0,
              exhausted_at = NULL,
              quota_reset_at = NULL,
              updated_at = @updatedAt
          WHERE account_id = @accountId AND status = 'exhausted'
        `)
        let changed = 0
        for (const accountId of ids) {
          changed += statement.run({ accountId, updatedAt: now }).changes
        }
        return changed
      })
      return transaction(accountIds)
    }

    return this.sqlite
      .prepare(`
        UPDATE proxy_accounts
        SET status = 'available',
            active = 0,
            exhausted_at = NULL,
            quota_reset_at = NULL,
            updated_at = @updatedAt
        WHERE status = 'exhausted'
      `)
      .run({ updatedAt: now }).changes
  }

  setAccountDisabled(accountId: string, disabled: boolean): number {
    return this.sqlite
      .prepare(`
        UPDATE proxy_accounts
        SET status = @status,
            active = CASE WHEN @status = 'disabled' THEN 0 ELSE active END,
            updated_at = @updatedAt
        WHERE account_id = @accountId
      `)
      .run({
        accountId,
        status: disabled ? 'disabled' : 'available',
        updatedAt: Date.now()
      }).changes
  }

  recordRoutingEvent(input: RoutingEventInput, createdAt = new Date()): void {
    this.sqlite
      .prepare(`
        INSERT INTO proxy_routing_events (
          id, request_id, conversation_key, account_id, event_type, reason, created_at
        ) VALUES (
          @id, @requestId, @conversationKey, @accountId, @eventType, @reason, @createdAt
        )
      `)
      .run({
        id: randomLedgerId('route'),
        requestId: input.requestId,
        conversationKey: input.conversationKey ?? null,
        accountId: input.accountId ?? null,
        eventType: input.eventType,
        reason: input.reason,
        createdAt: createdAt.getTime()
      })
  }

  recordProtocolMessage(input: ProtocolMessageInput, createdAt = new Date()): void {
    this.sqlite
      .prepare(`
        INSERT INTO proxy_protocol_messages (
          id, request_id, path, account_id, conversation_key, direction, kind, text, created_at
        ) VALUES (
          @id, @requestId, @path, @accountId, @conversationKey, @direction, @kind, @text,
          @createdAt
        )
      `)
      .run({
        id: randomLedgerId('msg'),
        requestId: input.requestId,
        path: input.path,
        accountId: input.accountId ?? null,
        conversationKey: input.conversationKey ?? null,
        direction: input.direction,
        kind: input.kind,
        text: input.text,
        createdAt: createdAt.getTime()
      })
  }

  recentProtocolMessages(limit = 50): ProtocolMessageRow[] {
    return this.sqlite
      .prepare(`
        SELECT
          id,
          request_id AS requestId,
          path,
          account_id AS accountId,
          conversation_key AS conversationKey,
          direction,
          kind,
          text,
          created_at AS createdAt
        FROM proxy_protocol_messages
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .all(limit) as ProtocolMessageRow[]
  }

  recordLogEvent(input: LogEventInput, createdAt = new Date()): void {
    this.sqlite
      .prepare(`
        INSERT INTO proxy_log_events (
          id, level, message, detail_json, request_id, account_id, conversation_key, path,
          method, created_at
        ) VALUES (
          @id, @level, @message, @detailJson, @requestId, @accountId, @conversationKey,
          @path, @method, @createdAt
        )
      `)
      .run({
        id: randomLedgerId('log'),
        level: input.level,
        message: input.message,
        detailJson: serializeLogDetail(input.detail),
        requestId: input.requestId ?? null,
        accountId: input.accountId ?? null,
        conversationKey: input.conversationKey ?? null,
        path: input.path ?? null,
        method: input.method ?? null,
        createdAt: createdAt.getTime()
      })
  }

  recentLogEvents(limit = 50): LogEventRow[] {
    return this.sqlite
      .prepare(`
        SELECT
          id,
          level,
          message,
          detail_json AS detailJson,
          request_id AS requestId,
          account_id AS accountId,
          conversation_key AS conversationKey,
          path,
          method,
          created_at AS createdAt
        FROM proxy_log_events
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .all(limit) as LogEventRow[]
  }

  markAccountQuotaExhausted(
    accountId: string | undefined,
    requestId: string,
    conversationKey: string | undefined,
    event: QuotaExhaustionEvent,
    message: string,
    completedAt: Date
  ): void {
    markAccountQuotaExhaustedInLedger(this.sqlite, {
      accountId,
      requestId,
      conversationKey,
      event,
      message,
      completedAt
    })
  }

  updateAccountUsage(input: AccountUsageInput, checkedAt = new Date()): void {
    updateAccountUsageInLedger(this.sqlite, input, checkedAt)
  }

  clear(): number {
    return clearLedgerTables(this.sqlite)
  }

  pruneOldRecords(retentionMs = ProxyLedger.defaultRetentionMs, now = new Date()): number {
    return pruneLedgerTables(this.sqlite, new Date(now.getTime() - retentionMs))
  }

  close(): void {
    this.sqlite.close()
  }
}
