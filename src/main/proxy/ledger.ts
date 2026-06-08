import Database from 'better-sqlite3'
import {
  markAccountQuotaExhaustedInLedger,
  updateAccountUsageInLedger
} from './ledger-account-state'
import { initializeLedgerSchema } from './ledger-schema'
import { readRequestSummary, readUsageSummary } from './ledger-summary'
import type {
  AccountPoolSnapshot,
  AccountUsageInput,
  AccountUsageSummary,
  LogEventInput,
  LogEventRow,
  ManagedAccountRow,
  ProtocolMessageInput,
  ProtocolMessageRow,
  RoutingEventInput,
  TurnSummaryInput,
  TurnSummaryRow
} from './ledger-types'
import {
  clearLedgerTables,
  compactLedgerStorage,
  pruneLedgerTables,
  randomLedgerId,
  serializeLogDetail
} from './ledger-utils'
import type { QuotaExhaustionEvent } from './quota'
import type { RecentRequest, RequestLedgerEntry, RequestSummary, UsageSummary } from './types'

interface RoutingEventRow {
  accountId: string | null
  conversationKey: string | null
  createdAt: number
  eventType: string
  id: string
  reason: string
  requestId: string | null
}

interface QuotaEventRow {
  accountId: string | null
  activeLimit: string | null
  conversationKey: string | null
  createdAt: number
  id: string
  message: string
  planType: string | null
  primaryUsedPercent: string | null
  requestId: string | null
  resetsAt: number | null
  statusCode: number | null
}

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
          request_body_sample, response_body_sample, request_purpose, request_content_type,
          response_content_type, request_model, response_model, response_plan_type,
          response_primary_used_percent, response_rate_limit_reset_at, response_active_limit,
          response_item_count, request_input_item_count, request_body_encoding, rpc_method,
          rpc_id, analytics_event_types, input_tokens, cached_input_tokens, output_tokens,
          reasoning_tokens, total_tokens, token_usage_source, user_agent, originator,
          summary_json, codex_session_id, codex_thread_id, codex_turn_id, codex_turn_started_at,
          codex_version, codex_runtime_os, codex_runtime_arch, raw_capture_path, error_message,
          conversation_key,
          started_at, completed_at
        ) VALUES (
          @id, @accountId, @method, @path, @mode, @outcome, @statusCode,
          @durationMs, @requestBytes, @responseBytes, @streaming, @upstreamHost,
          @outboundMode, @authHeaderPresent, @cookieHeaderPresent,
          @authFingerprint, @cookieFingerprint, @requestHeadersJson, @responseHeadersJson,
          @requestBodySample, @responseBodySample, @requestPurpose, @requestContentType,
          @responseContentType, @requestModel, @responseModel, @responsePlanType,
          @responsePrimaryUsedPercent, @responseRateLimitResetAt, @responseActiveLimit,
          @responseItemCount, @requestInputItemCount, @requestBodyEncoding, @rpcMethod,
          @rpcId, @analyticsEventTypes, @inputTokens, @cachedInputTokens, @outputTokens,
          @reasoningTokens, @totalTokens, @tokenUsageSource, @userAgent, @originator,
          @summaryJson, @codexSessionId, @codexThreadId, @codexTurnId, @codexTurnStartedAt,
          @codexVersion, @codexRuntimeOs, @codexRuntimeArch, @rawCapturePath, @errorMessage,
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
        requestPurpose: entry.requestPurpose ?? null,
        requestContentType: entry.requestContentType ?? null,
        responseContentType: entry.responseContentType ?? null,
        requestModel: entry.requestModel ?? null,
        responseModel: entry.responseModel ?? null,
        responsePlanType: entry.responsePlanType ?? null,
        responsePrimaryUsedPercent: entry.responsePrimaryUsedPercent ?? null,
        responseRateLimitResetAt: entry.responseRateLimitResetAt ?? null,
        responseActiveLimit: entry.responseActiveLimit ?? null,
        responseItemCount: entry.responseItemCount ?? null,
        requestInputItemCount: entry.requestInputItemCount ?? null,
        requestBodyEncoding: entry.requestBodyEncoding ?? null,
        rpcMethod: entry.rpcMethod ?? null,
        rpcId: entry.rpcId ?? null,
        analyticsEventTypes: entry.analyticsEventTypes ?? null,
        inputTokens: entry.inputTokens ?? null,
        cachedInputTokens: entry.cachedInputTokens ?? null,
        outputTokens: entry.outputTokens ?? null,
        reasoningTokens: entry.reasoningTokens ?? null,
        totalTokens: entry.totalTokens ?? null,
        tokenUsageSource: entry.tokenUsageSource ?? null,
        userAgent: entry.userAgent ?? null,
        originator: entry.originator ?? null,
        summaryJson: entry.summaryJson ?? null,
        codexSessionId: entry.codexSessionId ?? null,
        codexThreadId: entry.codexThreadId ?? null,
        codexTurnId: entry.codexTurnId ?? null,
        codexTurnStartedAt: entry.codexTurnStartedAt ?? null,
        codexVersion: entry.codexVersion ?? null,
        codexRuntimeOs: entry.codexRuntimeOs ?? null,
        codexRuntimeArch: entry.codexRuntimeArch ?? null,
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
          account_id AS accountId,
          conversation_key AS conversationKey,
          method,
          mode,
          path,
          outcome,
          status_code AS statusCode,
          duration_ms AS durationMs,
          request_bytes AS requestBytes,
          response_bytes AS responseBytes,
          request_purpose AS requestPurpose,
          request_content_type AS requestContentType,
          response_content_type AS responseContentType,
          request_body_encoding AS requestBodyEncoding,
          request_model AS requestModel,
          response_model AS responseModel,
          response_plan_type AS responsePlanType,
          response_primary_used_percent AS responsePrimaryUsedPercent,
          response_rate_limit_reset_at AS responseRateLimitResetAt,
          response_active_limit AS responseActiveLimit,
          response_item_count AS responseItemCount,
          request_input_item_count AS requestInputItemCount,
          rpc_method AS rpcMethod,
          rpc_id AS rpcId,
          analytics_event_types AS analyticsEventTypes,
          input_tokens AS inputTokens,
          cached_input_tokens AS cachedInputTokens,
          output_tokens AS outputTokens,
          reasoning_tokens AS reasoningTokens,
          total_tokens AS totalTokens,
          token_usage_source AS tokenUsageSource,
          codex_session_id AS codexSessionId,
          codex_thread_id AS codexThreadId,
          codex_turn_id AS codexTurnId,
          codex_turn_started_at AS codexTurnStartedAt,
          codex_version AS codexVersion,
          codex_runtime_os AS codexRuntimeOs,
          codex_runtime_arch AS codexRuntimeArch,
          user_agent AS userAgent,
          originator,
          summary_json AS summaryJson,
          streaming,
          upstream_host AS upstreamHost,
          outbound_mode AS outboundMode,
          raw_capture_path AS rawCapturePath,
          error_message AS errorMessage,
          started_at AS startedAt
        FROM proxy_requests
        ORDER BY started_at DESC, completed_at DESC, id DESC
        LIMIT ?
      `)
      .all(limit) as RecentRequest[]
  }

  requestSummary(): RequestSummary {
    return readRequestSummary(this.sqlite.name)
  }

  usageSummary(): UsageSummary {
    return readUsageSummary(this.sqlite.name)
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
          account_id, label, email, fingerprint, source_format, status, exhausted_at,
          quota_reset_at, refreshable, updated_at
        ) VALUES (
          @accountId, @label, @email, @fingerprint, @sourceFormat, 'available', NULL, NULL,
          @refreshable, @updatedAt
        )
        ON CONFLICT(account_id) DO UPDATE SET
          label = CASE
            WHEN excluded.email IS NOT NULL THEN excluded.label
            WHEN proxy_accounts.email IS NULL THEN excluded.label
            ELSE proxy_accounts.label
          END,
          email = COALESCE(excluded.email, proxy_accounts.email),
          fingerprint = excluded.fingerprint,
          refreshable = excluded.refreshable,
          source_format = excluded.source_format,
          updated_at = excluded.updated_at
      `)
      for (const account of items) {
        statement.run({
          ...account,
          email: account.email ?? null,
          refreshable: account.refreshable === false ? 0 : 1,
          updatedAt: now
        })
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
          email,
          fingerprint,
          source_format AS sourceFormat,
          status,
          exhausted_at AS exhaustedAt,
          quota_reset_at AS quotaResetAt,
          plan_type AS planType,
          primary_used_percent AS primaryUsedPercent,
          secondary_used_percent AS secondaryUsedPercent,
          rate_limit_resets_at AS rateLimitResetsAt,
          secondary_rate_limit_resets_at AS secondaryRateLimitResetsAt,
          last_quota_refreshed_at AS lastQuotaRefreshedAt,
          last_quota_refreshed_reset_at AS lastQuotaRefreshedResetAt,
          last_usage_checked_at AS lastUsageCheckedAt,
          last_usage_error AS lastUsageError,
          refreshable,
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
          rate_limit_resets_at AS rateLimitResetsAt,
          secondary_rate_limit_resets_at AS secondaryRateLimitResetsAt,
          secondary_used_percent AS secondaryUsedPercent
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
          id, request_id, path, account_id, conversation_key, direction, kind, text,
          protocol_type, sequence_number, response_id, model, previous_response_id,
          parent_response_id, item_id, call_id, input_item_count, tool_count, input_tokens,
          cached_input_tokens, output_tokens, reasoning_tokens, total_tokens, payload_bytes,
          truncated, summary_json, created_at
        ) VALUES (
          @id, @requestId, @path, @accountId, @conversationKey, @direction, @kind, @text,
          @protocolType, @sequenceNumber, @responseId, @model, @previousResponseId,
          @parentResponseId, @itemId, @callId, @inputItemCount, @toolCount, @inputTokens,
          @cachedInputTokens, @outputTokens, @reasoningTokens, @totalTokens, @payloadBytes,
          @truncated, @summaryJson, @createdAt
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
        protocolType: input.protocolType ?? null,
        sequenceNumber: input.sequenceNumber ?? null,
        responseId: input.responseId ?? null,
        model: input.model ?? null,
        previousResponseId: input.previousResponseId ?? null,
        parentResponseId: input.parentResponseId ?? null,
        itemId: input.itemId ?? null,
        callId: input.callId ?? null,
        inputItemCount: input.inputItemCount ?? null,
        toolCount: input.toolCount ?? null,
        inputTokens: input.inputTokens ?? null,
        cachedInputTokens: input.cachedInputTokens ?? null,
        outputTokens: input.outputTokens ?? null,
        reasoningTokens: input.reasoningTokens ?? null,
        totalTokens: input.totalTokens ?? null,
        payloadBytes: input.payloadBytes ?? null,
        truncated: input.truncated === undefined ? null : input.truncated ? 1 : 0,
        summaryJson: input.summaryJson ?? null,
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
          protocol_type AS protocolType,
          sequence_number AS sequenceNumber,
          response_id AS responseId,
          model,
          previous_response_id AS previousResponseId,
          parent_response_id AS parentResponseId,
          item_id AS itemId,
          call_id AS callId,
          input_item_count AS inputItemCount,
          tool_count AS toolCount,
          input_tokens AS inputTokens,
          cached_input_tokens AS cachedInputTokens,
          output_tokens AS outputTokens,
          reasoning_tokens AS reasoningTokens,
          total_tokens AS totalTokens,
          payload_bytes AS payloadBytes,
          truncated,
          summary_json AS summaryJson,
          created_at AS createdAt
        FROM proxy_protocol_messages
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `)
      .all(limit) as ProtocolMessageRow[]
  }

  recordTurnSummary(input: TurnSummaryInput, updatedAt = new Date()): void {
    const now = updatedAt.getTime()
    const turnKey = turnSummaryKey(input)
    this.sqlite
      .prepare(`
        INSERT INTO proxy_turn_summaries (
          id, turn_key, request_id, conversation_key, account_id, codex_thread_id,
          codex_turn_id, response_id, parent_response_id, user_text, assistant_text,
          tool_call_count, tool_result_count, input_tokens, cached_input_tokens, output_tokens,
          reasoning_tokens, total_tokens, status, summary_json, started_at, completed_at,
          updated_at
        ) VALUES (
          @id, @turnKey, @requestId, @conversationKey, @accountId, @codexThreadId,
          @codexTurnId, @responseId, @parentResponseId, @userText, @assistantText,
          @toolCallCount, @toolResultCount, @inputTokens, @cachedInputTokens, @outputTokens,
          @reasoningTokens, @totalTokens, @status, @summaryJson, @startedAt, @completedAt,
          @updatedAt
        )
        ON CONFLICT(turn_key) DO UPDATE SET
          request_id = excluded.request_id,
          conversation_key = COALESCE(excluded.conversation_key, proxy_turn_summaries.conversation_key),
          account_id = COALESCE(excluded.account_id, proxy_turn_summaries.account_id),
          codex_thread_id = COALESCE(excluded.codex_thread_id, proxy_turn_summaries.codex_thread_id),
          codex_turn_id = COALESCE(excluded.codex_turn_id, proxy_turn_summaries.codex_turn_id),
          response_id = COALESCE(excluded.response_id, proxy_turn_summaries.response_id),
          parent_response_id = COALESCE(
            excluded.parent_response_id,
            proxy_turn_summaries.parent_response_id
          ),
          user_text = COALESCE(excluded.user_text, proxy_turn_summaries.user_text),
          assistant_text = COALESCE(excluded.assistant_text, proxy_turn_summaries.assistant_text),
          tool_call_count = proxy_turn_summaries.tool_call_count + excluded.tool_call_count,
          tool_result_count = proxy_turn_summaries.tool_result_count + excluded.tool_result_count,
          input_tokens = COALESCE(excluded.input_tokens, proxy_turn_summaries.input_tokens),
          cached_input_tokens = COALESCE(
            excluded.cached_input_tokens,
            proxy_turn_summaries.cached_input_tokens
          ),
          output_tokens = COALESCE(excluded.output_tokens, proxy_turn_summaries.output_tokens),
          reasoning_tokens = COALESCE(
            excluded.reasoning_tokens,
            proxy_turn_summaries.reasoning_tokens
          ),
          total_tokens = COALESCE(excluded.total_tokens, proxy_turn_summaries.total_tokens),
          status = COALESCE(excluded.status, proxy_turn_summaries.status),
          summary_json = COALESCE(excluded.summary_json, proxy_turn_summaries.summary_json),
          started_at = COALESCE(proxy_turn_summaries.started_at, excluded.started_at),
          completed_at = COALESCE(excluded.completed_at, proxy_turn_summaries.completed_at),
          updated_at = excluded.updated_at
      `)
      .run({
        id: randomLedgerId('turn'),
        turnKey,
        requestId: input.requestId,
        conversationKey: input.conversationKey ?? null,
        accountId: input.accountId ?? null,
        codexThreadId: input.codexThreadId ?? null,
        codexTurnId: input.codexTurnId ?? null,
        responseId: input.responseId ?? null,
        parentResponseId: input.parentResponseId ?? null,
        userText: input.userText ?? null,
        assistantText: input.assistantText ?? null,
        toolCallCount: input.toolCallDelta ?? 0,
        toolResultCount: input.toolResultDelta ?? 0,
        inputTokens: input.inputTokens ?? null,
        cachedInputTokens: input.cachedInputTokens ?? null,
        outputTokens: input.outputTokens ?? null,
        reasoningTokens: input.reasoningTokens ?? null,
        totalTokens: input.totalTokens ?? null,
        status: input.status ?? null,
        summaryJson: input.summaryJson ?? null,
        startedAt: input.startedAt ?? now,
        completedAt: input.completedAt ?? null,
        updatedAt: now
      })
  }

  recentTurnSummaries(limit = 50): TurnSummaryRow[] {
    return this.sqlite
      .prepare(`
        SELECT
          id,
          turn_key AS turnKey,
          request_id AS requestId,
          conversation_key AS conversationKey,
          account_id AS accountId,
          codex_thread_id AS codexThreadId,
          codex_turn_id AS codexTurnId,
          response_id AS responseId,
          parent_response_id AS parentResponseId,
          user_text AS userText,
          assistant_text AS assistantText,
          tool_call_count AS toolCallCount,
          tool_result_count AS toolResultCount,
          input_tokens AS inputTokens,
          cached_input_tokens AS cachedInputTokens,
          output_tokens AS outputTokens,
          reasoning_tokens AS reasoningTokens,
          total_tokens AS totalTokens,
          status,
          summary_json AS summaryJson,
          started_at AS startedAt,
          completed_at AS completedAt,
          updated_at AS updatedAt
        FROM proxy_turn_summaries
        ORDER BY updated_at DESC, id DESC
        LIMIT ?
      `)
      .all(limit) as TurnSummaryRow[]
  }

  recordLogEvent(input: LogEventInput, createdAt = new Date()): void {
    this.sqlite
      .prepare(`
        INSERT INTO proxy_log_events (
          id, level, event_type, message, detail_json, request_id, account_id,
          conversation_key, path, method, created_at
        ) VALUES (
          @id, @level, @eventType, @message, @detailJson, @requestId, @accountId,
          @conversationKey, @path, @method, @createdAt
        )
      `)
      .run({
        id: randomLedgerId('log'),
        level: input.level,
        eventType: input.eventType ?? null,
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
    const logRows = this.sqlite
      .prepare(`
        SELECT
          id,
          level,
          event_type AS eventType,
          message,
          detail_json AS detailJson,
          request_id AS requestId,
          account_id AS accountId,
          conversation_key AS conversationKey,
          path,
          method,
          created_at AS createdAt
        FROM proxy_log_events
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `)
      .all(limit) as LogEventRow[]
    const routingRows = this.sqlite
      .prepare(`
        SELECT
          id,
          request_id AS requestId,
          conversation_key AS conversationKey,
          account_id AS accountId,
          event_type AS eventType,
          reason,
          created_at AS createdAt
        FROM proxy_routing_events
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `)
      .all(limit) as RoutingEventRow[]
    const quotaRows = this.sqlite
      .prepare(`
        SELECT
          id,
          request_id AS requestId,
          conversation_key AS conversationKey,
          account_id AS accountId,
          status_code AS statusCode,
          plan_type AS planType,
          active_limit AS activeLimit,
          primary_used_percent AS primaryUsedPercent,
          resets_at AS resetsAt,
          message,
          created_at AS createdAt
        FROM proxy_quota_events
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `)
      .all(limit) as QuotaEventRow[]
    const structuredRows = [
      ...routingRows.map(routingEventToLogRow),
      ...quotaRows.map(quotaEventToLogRow)
    ].filter((row) => row.eventType !== 'request')
    const filteredLogRows = logRows.filter(
      (row) => !isDuplicatedByStructuredEvent(row, structuredRows)
    )
    const filteredStructuredRows = structuredRows.filter(
      (row) => !isRedundantStructuredRoutingEvent(row, filteredLogRows, structuredRows)
    )
    return [...filteredLogRows, ...filteredStructuredRows]
      .sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id))
      .slice(0, limit)
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

  markQuotaRefreshed(accountId: string, resetAt: number, refreshedAt = new Date()): void {
    this.sqlite
      .prepare(`
        UPDATE proxy_accounts
        SET last_quota_refreshed_at = @refreshedAt,
          last_quota_refreshed_reset_at = @resetAt,
          updated_at = @refreshedAt
        WHERE account_id = @accountId
      `)
      .run({
        accountId,
        resetAt,
        refreshedAt: refreshedAt.getTime()
      })
  }

  clear(): number {
    const deletedRequests = clearLedgerTables(this.sqlite)
    compactLedgerStorage(this.sqlite)
    return deletedRequests
  }

  pruneOldRecords(retentionMs = ProxyLedger.defaultRetentionMs, now = new Date()): number {
    return pruneLedgerTables(this.sqlite, new Date(now.getTime() - retentionMs))
  }

  close(): void {
    this.sqlite.close()
  }
}

function routingEventToLogRow(row: RoutingEventRow): LogEventRow {
  const eventType = routingLogEventType(row.eventType)
  return {
    accountId: row.accountId,
    conversationKey: row.conversationKey,
    createdAt: row.createdAt,
    detailJson: serializeLogDetail({
      eventType: row.eventType,
      reason: row.reason
    }),
    eventType,
    id: row.id,
    level:
      row.eventType === 'all_accounts_exhausted' || row.eventType === 'auth_failed'
        ? 'warn'
        : 'info',
    message: 'Routing event',
    method: null,
    path: null,
    requestId: row.requestId
  }
}

function routingLogEventType(eventType: RoutingEventRow['eventType']): LogEventRow['eventType'] {
  if (eventType === 'selected') {
    return 'request'
  }
  if (eventType === 'auth_failed') {
    return 'auth'
  }
  if (eventType === 'quota_exhausted' || eventType === 'all_accounts_exhausted') {
    return 'quota'
  }
  return 'account_switch'
}

function quotaEventToLogRow(row: QuotaEventRow): LogEventRow {
  return {
    accountId: row.accountId,
    conversationKey: row.conversationKey,
    createdAt: row.createdAt,
    detailJson: serializeLogDetail({
      activeLimit: row.activeLimit,
      message: row.message,
      planType: row.planType,
      primaryUsedPercent: row.primaryUsedPercent,
      resetsAt: row.resetsAt,
      statusCode: row.statusCode
    }),
    eventType: 'quota',
    id: row.id,
    level: 'warn',
    message: 'Quota event',
    method: null,
    path: null,
    requestId: row.requestId
  }
}

function isDuplicatedByStructuredEvent(row: LogEventRow, structuredRows: LogEventRow[]): boolean {
  if (row.message === 'Usage limit reached; marking account exhausted' && !row.requestId) {
    return true
  }
  if (!isStructuredDuplicateCandidate(row)) {
    return false
  }
  return structuredRows.some(
    (structured) =>
      row.eventType === structured.eventType &&
      row.accountId === structured.accountId &&
      sameRequestOrCloseInTime(row, structured)
  )
}

function isRedundantStructuredRoutingEvent(
  row: LogEventRow,
  logRows: LogEventRow[],
  structuredRows: LogEventRow[]
): boolean {
  if (row.message !== 'Routing event') {
    return false
  }
  if (row.eventType === 'auth') {
    return logRows.some(
      (logRow) =>
        logRow.eventType === 'auth' &&
        logRow.accountId === row.accountId &&
        sameRequestOrCloseInTime(logRow, row)
    )
  }
  if (row.eventType === 'quota' && row.detailJson?.includes('"eventType":"quota_exhausted"')) {
    return structuredRows.some(
      (structured) =>
        structured.message === 'Quota event' &&
        structured.accountId === row.accountId &&
        sameRequestOrCloseInTime(structured, row)
    )
  }
  return false
}

function isStructuredDuplicateCandidate(row: LogEventRow): boolean {
  return (
    row.message === 'Usage limit reached; marking account exhausted' ||
    row.message === 'WSS lifecycle' ||
    row.message === 'Active account selected' ||
    row.message === 'Switched active account after usage limit' ||
    row.message === 'Switched active account after auth failure'
  )
}

function sameRequestOrCloseInTime(left: LogEventRow, right: LogEventRow): boolean {
  if (left.requestId && right.requestId && left.requestId === right.requestId) {
    return true
  }
  return Math.abs(left.createdAt - right.createdAt) <= 2_000
}

function turnSummaryKey(input: TurnSummaryInput): string {
  if (input.turnKey) {
    return input.turnKey
  }
  const stableParts = [
    input.conversationKey,
    input.codexThreadId,
    input.codexTurnId,
    input.responseId,
    input.parentResponseId
  ].filter((value): value is string => Boolean(value))
  if (stableParts.length > 0) {
    return stableParts.join(':')
  }
  return input.requestId
}
