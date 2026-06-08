import { recordField, stringField } from './json-utils'
import type { AccountUsageInput } from './ledger-types'

export interface UsageSnapshot extends Omit<AccountUsageInput, 'accountId'> {
  exhausted: boolean
}

export function extractUsageResponse(
  body: Record<string, unknown> | undefined
): Omit<AccountUsageInput, 'accountId'> {
  const rateLimit = recordField(body, 'rate_limit')
  const primaryWindow = recordField(rateLimit, 'primary_window')
  const secondaryWindow = recordField(rateLimit, 'secondary_window')
  return {
    planType: usagePlanType(body),
    primaryUsedPercent:
      stringField(body, 'primary_used_percent') ?? stringField(primaryWindow, 'used_percent'),
    secondaryUsedPercent:
      stringField(body, 'secondary_used_percent') ?? stringField(secondaryWindow, 'used_percent'),
    rateLimitResetsAt: usageResetMillis(body, primaryWindow),
    secondaryRateLimitResetsAt: usageResetMillis({}, secondaryWindow)
  }
}

function usagePlanType(body: Record<string, unknown> | undefined): string | undefined {
  const account = recordField(body, 'account')
  const user = recordField(body, 'user')
  const subscription = recordField(body, 'subscription')
  const rateLimit = recordField(body, 'rate_limit')
  return (
    stringField(body, 'plan_type') ??
    stringField(body, 'chatgpt_plan_type') ??
    stringField(body, 'account_type') ??
    stringField(body, 'planType') ??
    stringField(body, 'plan') ??
    stringField(account, 'plan_type') ??
    stringField(account, 'chatgpt_plan_type') ??
    stringField(account, 'account_type') ??
    stringField(account, 'plan') ??
    stringField(user, 'plan_type') ??
    stringField(user, 'account_type') ??
    stringField(subscription, 'plan_type') ??
    stringField(subscription, 'plan') ??
    stringField(rateLimit, 'plan_type')
  )
}

export function usageResetMillis(
  body: Record<string, unknown> | undefined,
  primaryWindow?: Record<string, unknown>
): number | undefined {
  const value =
    primaryWindow?.reset_at ??
    body?.rate_limit_reset_at ??
    body?.primary_reset_at ??
    body?.resets_at ??
    body?.quota_reset_at
  if (typeof value === 'number') {
    return value > 10_000_000_000 ? value : value * 1000
  }
  if (typeof value !== 'string') {
    return undefined
  }
  const numeric = Number.parseInt(value, 10)
  if (!Number.isFinite(numeric)) {
    return undefined
  }
  return numeric > 10_000_000_000 ? numeric : numeric * 1000
}

export function isUsageQuotaProtected(...values: Array<string | undefined>): boolean {
  return values.some((value) => {
    if (!value) {
      return false
    }
    const numeric = Number.parseFloat(value)
    return Number.isFinite(numeric) && numeric >= 95
  })
}
