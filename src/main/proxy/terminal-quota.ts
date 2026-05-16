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
          planType: usage?.planType,
          primaryUsedPercent: usage?.primaryUsedPercent ?? '100',
          resetsAt: usage?.rateLimitResetsAt
        })
      )
    )
  }
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
