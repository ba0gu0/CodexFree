import { describe, expect, it } from 'vitest'
import type { RoutedAccount } from './account-pool'
import type { ProxyLedger } from './ledger'
import type { ManagedAccountRow } from './ledger-types'
import { AccountQuotaGuard } from './quota-guard'

const log = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
}

describe('account quota guard', () => {
  it('protects accounts when the secondary quota window reaches the guard line', async () => {
    const guard = new AccountQuotaGuard({
      agent: () => undefined,
      ledger: ledgerWithAccounts([
        managedAccountRow({
          accountId: 'team-account',
          lastUsageCheckedAt: Date.now(),
          planType: 'team',
          primaryUsedPercent: '10',
          rateLimitResetsAt: 1_780_927_748_000,
          secondaryRateLimitResetsAt: 1_781_496_691_000,
          secondaryUsedPercent: '99'
        })
      ]),
      log,
      usageUrl: () => 'https://chatgpt.com/backend-api/wham/usage'
    })

    await expect(guard.evaluate(routedAccount('team-account'))).resolves.toMatchObject({
      protectedByQuota: true,
      protectedWindow: 'secondary',
      secondaryUsedPercent: '99'
    })
  })
})

function ledgerWithAccounts(accounts: ManagedAccountRow[]): ProxyLedger {
  return {
    accounts: () => accounts
  } as unknown as ProxyLedger
}

function routedAccount(accountId: string): RoutedAccount {
  return {
    accountId,
    activeChanged: false,
    authorization: 'Bearer access-token',
    fingerprint: 'fingerprint',
    label: accountId,
    upstreamAccountId: accountId
  }
}

function managedAccountRow(overrides: Partial<ManagedAccountRow>): ManagedAccountRow {
  return {
    accountId: 'account-id',
    active: 0,
    email: null,
    exhaustedAt: null,
    fingerprint: 'fingerprint',
    label: 'Account',
    lastQuotaRefreshedAt: null,
    lastQuotaRefreshedResetAt: null,
    lastUsageCheckedAt: null,
    lastUsageError: null,
    planType: null,
    primaryUsedPercent: null,
    quotaResetAt: null,
    rateLimitResetsAt: null,
    refreshable: 1,
    secondaryRateLimitResetsAt: null,
    secondaryUsedPercent: null,
    sourceFormat: 'codex',
    status: 'available',
    updatedAt: 0,
    ...overrides
  }
}
