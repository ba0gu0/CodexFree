import type { ProxyLedger } from './ledger'
import { buildUsageLimitReachedPayload } from './quota'

export interface TerminalQuotaPayload {
  accountId?: string
  body: Buffer
}

export function createTerminalQuotaPayload(
  ledger: ProxyLedger,
  incomingAccountId: string | undefined
): TerminalQuotaPayload {
  const accountId = selectTerminalQuotaAccountId(ledger, incomingAccountId)
  const usage = ledger.accountUsageSummary(accountId)
  return {
    accountId,
    body: Buffer.from(
      JSON.stringify(
        buildUsageLimitReachedPayload({
          activeLimit: quotaPayloadWindow(usage),
          planType: usage?.planType,
          primaryUsedPercent: quotaPayloadUsedPercent(usage) ?? '100',
          resetsAt: quotaPayloadResetAt(usage)
        })
      )
    )
  }
}

function quotaPayloadWindow(
  usage: ReturnType<ProxyLedger['accountUsageSummary']>
): string | undefined {
  const primary = quotaPercentNumber(usage?.primaryUsedPercent)
  const secondary = quotaPercentNumber(usage?.secondaryUsedPercent)
  if (secondary !== undefined && (primary === undefined || secondary >= primary)) {
    return 'secondary'
  }
  return primary === undefined ? undefined : 'primary'
}

function quotaPayloadUsedPercent(
  usage: ReturnType<ProxyLedger['accountUsageSummary']>
): string | undefined {
  return quotaPayloadWindow(usage) === 'secondary'
    ? (usage?.secondaryUsedPercent ?? undefined)
    : (usage?.primaryUsedPercent ?? undefined)
}

function quotaPayloadResetAt(
  usage: ReturnType<ProxyLedger['accountUsageSummary']>
): number | undefined {
  return quotaPayloadWindow(usage) === 'secondary'
    ? (usage?.secondaryRateLimitResetsAt ?? undefined)
    : (usage?.rateLimitResetsAt ?? undefined)
}

function quotaPercentNumber(value: string | null | undefined): number | undefined {
  if (!value) {
    return undefined
  }
  const numeric = Number.parseFloat(value)
  return Number.isFinite(numeric) ? numeric : undefined
}

function selectTerminalQuotaAccountId(
  ledger: ProxyLedger,
  incomingAccountId: string | undefined
): string | undefined {
  const activeAccountId = ledger.activeAccountId()
  if (activeAccountId) {
    return activeAccountId
  }
  const accounts = ledger.accounts()
  return (
    accounts.find((account) => account.status === 'exhausted')?.accountId ??
    accounts.find((account) => account.status === 'available')?.accountId ??
    incomingAccountId
  )
}
