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
    planType: stringField(body, 'plan_type'),
    primaryUsedPercent:
      stringField(body, 'primary_used_percent') ?? stringField(primaryWindow, 'used_percent'),
    secondaryUsedPercent:
      stringField(body, 'secondary_used_percent') ?? stringField(secondaryWindow, 'used_percent'),
    rateLimitResetsAt: usageResetMillis(body, primaryWindow)
  }
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

export function isUsageExhausted(value: string | undefined): boolean {
  if (!value) {
    return false
  }
  const numeric = Number.parseFloat(value)
  return Number.isFinite(numeric) && numeric >= 100
}
