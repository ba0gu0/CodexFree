import type Database from 'better-sqlite3'
import type { AccountUsageInput } from './ledger-types'
import { epochSecondsToMillis, isPercentExhausted, randomLedgerId } from './ledger-utils'
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
  const transaction = sqlite.transaction(() => {
    sqlite
      .prepare(`
        UPDATE proxy_accounts
        SET status = 'exhausted',
            active = 0,
            exhausted_at = @completedAt,
            quota_reset_at = @quotaResetAt,
            updated_at = @completedAt
        WHERE account_id = @accountId
      `)
      .run({
        accountId: input.accountId,
        completedAt,
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
        primaryUsedPercent: input.event.primaryUsedPercent ?? null,
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
  const isExhausted = isPercentExhausted(primaryUsedPercent) ? 1 : 0
  sqlite
    .prepare(`
      UPDATE proxy_accounts
      SET label = CASE
            WHEN @email IS NOT NULL THEN @label
            ELSE label
          END,
          email = COALESCE(@email, email),
          plan_type = @planType,
          primary_used_percent = @primaryUsedPercent,
          secondary_used_percent = @secondaryUsedPercent,
          rate_limit_resets_at = @rateLimitResetsAt,
          quota_reset_at = COALESCE(@rateLimitResetsAt, quota_reset_at),
          status = CASE
            WHEN status = 'disabled' THEN status
            WHEN @isExhausted = 1 THEN 'exhausted'
            ELSE 'available'
          END,
          exhausted_at = CASE
            WHEN status != 'disabled' AND @isExhausted = 1 THEN @checkedAt
            WHEN status != 'disabled' THEN NULL
            ELSE exhausted_at
          END,
          active = CASE
            WHEN status != 'disabled' AND @isExhausted = 1 THEN 0
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
      secondaryUsedPercent: input.secondaryUsedPercent ?? null,
      rateLimitResetsAt: input.rateLimitResetsAt ?? null,
      lastUsageError: input.lastUsageError ?? null,
      isExhausted,
      checkedAt: checkedAt.getTime()
    })
}
