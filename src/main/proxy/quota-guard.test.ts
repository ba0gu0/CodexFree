import http from 'node:http'
import { describe, expect, it } from 'vitest'
import type { RoutedAccount } from './account-pool'
import type { ProxyLedger } from './ledger'
import type { AccountUsageInput, ManagedAccountRow } from './ledger-types'
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

  it('treats remote usage 402 as quota protection without warning', async () => {
    const account = managedAccountRow({
      accountId: 'team-account',
      planType: 'team'
    })
    const usageUpdates: AccountUsageInput[] = []
    const warnings: unknown[] = []
    const server = http.createServer((_request, response) => {
      response.writeHead(402, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          account_id: 'team-account',
          plan_type: 'team',
          rate_limit: {
            primary_window: {
              reset_at: 1780927748
            }
          }
        })
      )
    })
    await listen(server)

    try {
      const guard = new AccountQuotaGuard({
        agent: () => undefined,
        ledger: {
          accounts: () => [account],
          updateAccountUsage: (input: AccountUsageInput) => usageUpdates.push(input)
        } as unknown as ProxyLedger,
        log: {
          ...log,
          warn: (...args: unknown[]) => warnings.push(args)
        },
        usageUrl: () => usageUrl(server)
      })

      await expect(guard.evaluate(routedAccount('team-account'))).resolves.toMatchObject({
        primaryUsedPercent: '100',
        protectedByQuota: true,
        protectedWindow: 'primary',
        source: 'remote'
      })
      expect(usageUpdates[0]).toMatchObject({
        accountId: 'team-account',
        lastUsageError: 'usage check failed: 402',
        primaryUsedPercent: '100'
      })
      expect(warnings).toEqual([])
    } finally {
      await closeServer(server)
    }
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

function listen(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

function usageUrl(server: http.Server): string {
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Expected quota guard usage server to listen on a TCP address')
  }
  return `http://127.0.0.1:${address.port}/backend-api/wham/usage`
}
