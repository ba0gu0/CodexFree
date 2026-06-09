import { checkAuthDirectoryUsage } from '../auth/usage-check'
import type { ProxyLedger } from '../proxy/ledger'
import type { ManagedAccountRow } from '../proxy/ledger-types'
import type { ProxyStatus } from '../proxy/types'

export interface QuotaResetRefresherOptions {
  authPoolDir: string
  intervalMs?: number
  ledger: ProxyLedger
  readUpstreamBaseUrl: () => string
  refreshAccountState: () => ProxyStatus
}

export interface QuotaResetRefreshStats {
  checked: number
  refreshed: number
  skipped: number
}

const defaultIntervalMs = 30 * 60 * 1000
const resetGraceMs = 5 * 60 * 1000

export class QuotaResetRefresher {
  private running = false
  private timer?: ReturnType<typeof setInterval>

  constructor(private readonly options: QuotaResetRefresherOptions) {}

  start(): void {
    this.stop()
    void this.runBackgroundRefresh()
    this.timer = setInterval(() => void this.runBackgroundRefresh(), this.intervalMs())
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }

  async refreshDueAccounts(now = new Date()): Promise<QuotaResetRefreshStats> {
    if (this.running) {
      return { checked: 0, refreshed: 0, skipped: 0 }
    }
    this.running = true
    try {
      const dueAccounts = dueQuotaRefreshAccounts(this.options.ledger.accounts(), now)
      if (dueAccounts.length === 0) {
        return { checked: 0, refreshed: 0, skipped: 0 }
      }
      const results = await checkAuthDirectoryUsage(this.options.authPoolDir, {
        accountIds: dueAccounts.map((account) => account.accountId),
        usageUrl: usageRefreshUrl(this.options.readUpstreamBaseUrl())
      })
      const resultByAccount = new Map(results.map((result) => [result.accountId, result]))
      let refreshed = 0
      let skipped = 0

      for (const account of dueAccounts) {
        const previousResetAt = account.rateLimitResetsAt
        if (previousResetAt === null) {
          skipped += 1
          continue
        }
        const result = resultByAccount.get(account.accountId)
        if (!result) {
          skipped += 1
          this.recordSkipped(account, 'auth file not found for quota refresh')
          continue
        }
        this.options.ledger.updateAccountUsage({
          accountId: result.accountId,
          email: result.email,
          label: result.label,
          lastUsageError: result.quotaUnavailable ? undefined : result.error,
          planType: result.planType,
          primaryUsedPercent: result.primaryUsedPercent,
          rateLimitResetsAt: result.rateLimitResetsAt,
          secondaryRateLimitResetsAt: result.secondaryRateLimitResetsAt,
          secondaryUsedPercent: result.secondaryUsedPercent
        })
        if (result.quotaUnavailable) {
          skipped += 1
          this.options.ledger.markQuotaRefreshed(
            account.accountId,
            result.rateLimitResetsAt ?? previousResetAt,
            now
          )
          continue
        }
        if (!result.ok) {
          skipped += 1
          this.recordSkipped(account, result.error ?? 'usage check failed')
          continue
        }
        this.options.ledger.markQuotaRefreshed(account.accountId, previousResetAt, now)
        refreshed += 1
        this.recordRefreshed(account, result.primaryUsedPercent, result.rateLimitResetsAt)
      }

      if (results.length > 0) {
        this.options.refreshAccountState()
      }
      return { checked: dueAccounts.length, refreshed, skipped }
    } finally {
      this.running = false
    }
  }

  private intervalMs(): number {
    return this.options.intervalMs ?? defaultIntervalMs
  }

  private async runBackgroundRefresh(): Promise<void> {
    try {
      await this.refreshDueAccounts()
    } catch (error) {
      this.options.ledger.recordLogEvent({
        eventType: 'quota',
        level: 'error',
        message: 'Quota reset refresh task failed',
        detail: {
          error: error instanceof Error ? error.message : String(error)
        }
      })
    }
  }

  private recordRefreshed(
    account: ManagedAccountRow,
    newUsedPercent: string | undefined,
    newResetAt: number | undefined
  ): void {
    this.options.ledger.recordLogEvent({
      accountId: account.accountId,
      eventType: 'quota',
      level: 'info',
      message: 'Quota reset window refreshed account usage',
      detail: {
        newResetAt,
        newUsedPercent,
        previousResetAt: account.rateLimitResetsAt,
        previousUsedPercent: account.primaryUsedPercent
      }
    })
  }

  private recordSkipped(account: ManagedAccountRow, reason: string): void {
    this.options.ledger.recordLogEvent({
      accountId: account.accountId,
      eventType: 'quota',
      level: 'warn',
      message: 'Quota reset refresh skipped account',
      detail: {
        previousResetAt: account.rateLimitResetsAt,
        previousUsedPercent: account.primaryUsedPercent,
        reason
      }
    })
  }
}

export function dueQuotaRefreshAccounts(
  accounts: ManagedAccountRow[],
  now = new Date()
): ManagedAccountRow[] {
  const nowMs = now.getTime()
  return accounts.filter((account) => {
    if (account.status === 'disabled' || account.rateLimitResetsAt === null) {
      return false
    }
    const dueAt = account.rateLimitResetsAt + resetGraceMs
    if (dueAt > nowMs) {
      return false
    }
    return account.lastQuotaRefreshedResetAt !== account.rateLimitResetsAt
  })
}

function usageRefreshUrl(upstreamBaseUrl: string): string {
  const upstream = new URL(upstreamBaseUrl)
  upstream.pathname = '/backend-api/wham/usage'
  upstream.search = ''
  return upstream.toString()
}
