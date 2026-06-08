import type { RequestOptions } from 'node:http'
import { checkAccountUsageByAuthorization } from '../auth/usage-check'
import type { RoutedAccount } from './account-pool'
import type { ProxyLedger } from './ledger'
import type { ManagedAccountRow } from './ledger-types'
import { isPercentQuotaProtected } from './ledger-utils'
import type { ProxyServiceLog } from './service-context'

export interface AccountQuotaEvaluation {
  error?: string
  planType?: string
  primaryUsedPercent?: string
  protectedWindow?: 'primary' | 'secondary'
  protectedByQuota: boolean
  rateLimitResetsAt?: number
  secondaryRateLimitResetsAt?: number
  secondaryUsedPercent?: string
  source: 'cache' | 'error' | 'remote'
}

interface AccountQuotaGuardOptions {
  agent: () => RequestOptions['agent']
  ledger: ProxyLedger
  log: ProxyServiceLog
  usageUrl: () => string
}

export class AccountQuotaGuard {
  private static readonly freshnessMs = 60_000
  private readonly checks = new Map<string, Promise<AccountQuotaEvaluation>>()

  constructor(private readonly options: AccountQuotaGuardOptions) {}

  async evaluate(account: RoutedAccount): Promise<AccountQuotaEvaluation> {
    const cached = this.cachedEvaluation(account.accountId, true)
    if (cached) {
      return cached
    }
    if (!this.accountRow(account.accountId)) {
      return { protectedByQuota: false, source: 'cache' }
    }
    const existing = this.checks.get(account.accountId)
    if (existing) {
      return existing
    }
    const promise = this.checkRemoteUsage(account).finally(() => {
      if (this.checks.get(account.accountId) === promise) {
        this.checks.delete(account.accountId)
      }
    })
    this.checks.set(account.accountId, promise)
    return promise
  }

  private async checkRemoteUsage(account: RoutedAccount): Promise<AccountQuotaEvaluation> {
    const result = await checkAccountUsageByAuthorization({
      accountId: account.accountId,
      agent: this.options.agent(),
      authorization: account.authorization,
      label: account.label,
      upstreamAccountId: account.upstreamAccountId,
      usageUrl: this.options.usageUrl()
    })
    this.updateUsage(result)
    if (!result.ok) {
      this.options.log.warn('Quota guard usage check failed', {
        accountId: account.accountId,
        error: result.error,
        statusCode: result.statusCode
      })
      return (
        this.cachedEvaluation(account.accountId, false) ?? {
          error: result.error,
          protectedByQuota: false,
          source: 'error'
        }
      )
    }

    const fallback = this.cachedEvaluation(account.accountId, false)
    const primaryUsedPercent = result.primaryUsedPercent ?? fallback?.primaryUsedPercent
    const secondaryUsedPercent = result.secondaryUsedPercent ?? fallback?.secondaryUsedPercent
    const protectedWindow = quotaProtectedWindow(primaryUsedPercent, secondaryUsedPercent)
    return {
      planType: result.planType ?? fallback?.planType,
      primaryUsedPercent,
      protectedByQuota: protectedWindow !== undefined,
      protectedWindow,
      rateLimitResetsAt: result.rateLimitResetsAt ?? fallback?.rateLimitResetsAt,
      secondaryRateLimitResetsAt:
        result.secondaryRateLimitResetsAt ?? fallback?.secondaryRateLimitResetsAt,
      secondaryUsedPercent,
      source: 'remote'
    }
  }

  private updateUsage(result: Awaited<ReturnType<typeof checkAccountUsageByAuthorization>>): void {
    const ledger = this.options.ledger as ProxyLedger & {
      updateAccountUsage?: ProxyLedger['updateAccountUsage']
    }
    ledger.updateAccountUsage?.({
      accountId: result.accountId,
      email: result.email,
      label: result.label,
      lastUsageError: result.ok ? undefined : result.error,
      planType: result.planType,
      primaryUsedPercent: result.primaryUsedPercent,
      rateLimitResetsAt: result.rateLimitResetsAt,
      secondaryRateLimitResetsAt: result.secondaryRateLimitResetsAt,
      secondaryUsedPercent: result.secondaryUsedPercent
    })
  }

  private cachedEvaluation(
    accountId: string,
    requireFresh: boolean
  ): AccountQuotaEvaluation | undefined {
    const row = this.accountRow(accountId)
    if (!row) {
      return undefined
    }
    if (requireFresh) {
      if (!row.lastUsageCheckedAt) {
        return undefined
      }
      const ageMs = Date.now() - row.lastUsageCheckedAt
      if (ageMs > AccountQuotaGuard.freshnessMs) {
        return undefined
      }
    }
    const primaryUsedPercent = row.primaryUsedPercent ?? undefined
    const secondaryUsedPercent = row.secondaryUsedPercent ?? undefined
    const protectedWindow = quotaProtectedWindow(primaryUsedPercent, secondaryUsedPercent)
    return {
      planType: row.planType ?? undefined,
      primaryUsedPercent,
      protectedByQuota: protectedWindow !== undefined,
      protectedWindow,
      rateLimitResetsAt: row.rateLimitResetsAt ?? undefined,
      secondaryRateLimitResetsAt: row.secondaryRateLimitResetsAt ?? undefined,
      secondaryUsedPercent,
      source: 'cache'
    }
  }

  private accountRow(accountId: string): ManagedAccountRow | undefined {
    const ledger = this.options.ledger as ProxyLedger & { accounts?: () => ManagedAccountRow[] }
    return ledger.accounts?.().find((account) => account.accountId === accountId)
  }
}

function quotaProtectedWindow(
  primaryUsedPercent: string | undefined,
  secondaryUsedPercent: string | undefined
): AccountQuotaEvaluation['protectedWindow'] {
  if (isPercentQuotaProtected(primaryUsedPercent)) {
    return 'primary'
  }
  if (isPercentQuotaProtected(secondaryUsedPercent)) {
    return 'secondary'
  }
  return undefined
}
