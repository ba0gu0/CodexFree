import type { ProxyLedger } from './ledger'

interface AccountUsageReader {
  accountUsageSummary?: ProxyLedger['accountUsageSummary']
}

export function formatAccountUsageText(
  ledger: AccountUsageReader,
  accountId: string | undefined
): string | undefined {
  const usage = ledger.accountUsageSummary?.(accountId)
  if (!usage) {
    return undefined
  }

  const used = usage.primaryUsedPercent ?? 'unknown'
  const reset = usage.rateLimitResetsAt
    ? new Date(usage.rateLimitResetsAt).toISOString()
    : 'unknown'
  return `${usage.planType ?? 'plan?'} used=${used} reset=${reset}`
}
