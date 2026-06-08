import type Database from 'better-sqlite3'
import type { AccountUsageInput } from './ledger-types'
import { epochSecondsToMillis, isPercentQuotaProtected, randomLedgerId } from './ledger-utils'
import type { QuotaExhaustionEvent } from './quota'

export interface MarkAccountQuotaExhaustedInput {
  accountId: string | undefined
  requestId: string
  conversationKey: string | undefined
  event: QuotaExhaustionEvent
  message: string
  completedAt: Date
}

export function markAccountQuotaExhaustedInLedger(
  sqlite: Database.Database,
  input: MarkAccountQuotaExhaustedInput
): void {
  if (!input.accountId) {
    return
  }

  const completedAt = input.completedAt.getTime()
  const quotaResetAt = epochSecondsToMillis(input.event.resetsAt)
  const primaryUsedPercent = input.event.primaryUsedPercent ?? '100'
  const transaction = sqlite.transaction(() => {
    sqlite
      .prepare(`
        UPDATE proxy_accounts
        SET status = 'exhausted',
            active = 0,
            exhausted_at = @completedAt,
            quota_reset_at = @quotaResetAt,
            plan_type = COALESCE(@planType, plan_type),
            primary_used_percent = @primaryUsedPercent,
            rate_limit_resets_at = COALESCE(@quotaResetAt, rate_limit_resets_at),
            last_usage_checked_at = @completedAt,
            updated_at = @completedAt
        WHERE account_id = @accountId
      `)
      .run({
        accountId: input.accountId,
        completedAt,
        planType: input.event.planType ?? null,
        primaryUsedPercent,
        quotaResetAt
      })
    sqlite
      .prepare(`
        INSERT INTO proxy_routing_events (
          id, request_id, conversation_key, account_id, event_type, reason, created_at
        ) VALUES (
          @id, @requestId, @conversationKey, @accountId, 'quota_exhausted', @reason, @createdAt
        )
      `)
      .run({
        id: randomLedgerId('route'),
        requestId: input.requestId,
        conversationKey: input.conversationKey ?? null,
        accountId: input.accountId,
        reason: input.event.errorType,
        createdAt: completedAt
      })
    sqlite
      .prepare(`
        INSERT INTO proxy_quota_events (
          id, request_id, conversation_key, account_id, status_code, plan_type,
          active_limit, primary_used_percent, resets_at, message, created_at
        ) VALUES (
          @id, @requestId, @conversationKey, @accountId, @statusCode, @planType,
          @activeLimit, @primaryUsedPercent, @resetsAt, @message, @createdAt
        )
      `)
      .run({
        id: randomLedgerId('quota'),
        requestId: input.requestId,
        conversationKey: input.conversationKey ?? null,
        accountId: input.accountId,
        statusCode: input.event.statusCode,
        planType: input.event.planType ?? null,
        activeLimit: input.event.activeLimit ?? null,
        primaryUsedPercent,
        resetsAt: quotaResetAt,
        message: input.message,
        createdAt: completedAt
      })
  })
  transaction()
}

export function updateAccountUsageInLedger(
  sqlite: Database.Database,
  input: AccountUsageInput,
  checkedAt: Date
): void {
  const primaryUsedPercent = input.primaryUsedPercent ?? null
  const secondaryUsedPercent = input.secondaryUsedPercent ?? null
  const hasUsageResult =
    input.primaryUsedPercent !== undefined || input.secondaryUsedPercent !== undefined
  const isQuotaProtected = isPercentQuotaProtected(primaryUsedPercent, secondaryUsedPercent) ? 1 : 0
  sqlite
    .prepare(`
      UPDATE proxy_accounts
      SET label = CASE
            WHEN @email IS NOT NULL THEN @label
            ELSE label
          END,
          email = COALESCE(@email, email),
          plan_type = CASE WHEN @hasUsageResult = 1 THEN @planType ELSE plan_type END,
          primary_used_percent = CASE
            WHEN @hasUsageResult = 1 THEN @primaryUsedPercent
            ELSE primary_used_percent
          END,
          secondary_used_percent = CASE
            WHEN @hasUsageResult = 1 THEN @secondaryUsedPercent
            ELSE secondary_used_percent
          END,
          rate_limit_resets_at = CASE
            WHEN @hasUsageResult = 1 THEN @rateLimitResetsAt
            ELSE rate_limit_resets_at
          END,
          secondary_rate_limit_resets_at = CASE
            WHEN @hasUsageResult = 1 THEN @secondaryRateLimitResetsAt
            ELSE secondary_rate_limit_resets_at
          END,
          quota_reset_at = CASE
            WHEN @hasUsageResult = 1 THEN COALESCE(@rateLimitResetsAt, quota_reset_at)
            ELSE quota_reset_at
          END,
          status = CASE
            WHEN status = 'disabled' THEN status
            WHEN @hasUsageResult = 0 THEN status
            WHEN @isQuotaProtected = 1 THEN 'exhausted'
            ELSE 'available'
          END,
          exhausted_at = CASE
            WHEN status != 'disabled' AND @hasUsageResult = 0 THEN exhausted_at
            WHEN status != 'disabled' AND @isQuotaProtected = 1 THEN @checkedAt
            WHEN status != 'disabled' AND @hasUsageResult = 1 THEN NULL
            ELSE exhausted_at
          END,
          active = CASE
            WHEN status != 'disabled' AND @isQuotaProtected = 1 THEN 0
            ELSE active
          END,
          last_usage_checked_at = @checkedAt,
          last_usage_error = @lastUsageError,
          updated_at = @checkedAt
      WHERE account_id = @accountId
    `)
    .run({
      accountId: input.accountId,
      email: input.email ?? null,
      label: input.email ?? input.label ?? null,
      planType: input.planType ?? null,
      primaryUsedPercent,
      secondaryUsedPercent,
      rateLimitResetsAt: input.rateLimitResetsAt ?? null,
      secondaryRateLimitResetsAt: input.secondaryRateLimitResetsAt ?? null,
      lastUsageError: input.lastUsageError ?? null,
      hasUsageResult: hasUsageResult ? 1 : 0,
      isQuotaProtected,
      checkedAt: checkedAt.getTime()
    })
}
