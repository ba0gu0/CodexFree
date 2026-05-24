import { describe, expect, it } from 'vitest'
import type {
  AccountPoolSnapshot,
  AccountUsageInput,
  LogEventRow,
  ManagedAccountRow,
  ProtocolMessageRow,
  TurnSummaryRow
} from '../proxy/ledger-types'
import type { ProxyConfig, ProxyStatus } from '../proxy/types'
import { type AdminLedger, DaemonAdminServer } from './admin'
import { DaemonAdminClient } from './client'

const proxyStatus: ProxyStatus = {
  authPoolAccounts: 0,
  authPoolAvailableAccounts: 0,
  authPoolDisabledAccounts: 0,
  authPoolEnabled: true,
  authPoolExhaustedAccounts: 0,
  endpoint: 'http://127.0.0.1:33333/backend-api',
  openaiBaseUrl: 'http://127.0.0.1:33333/backend-api/codex',
  openaiCompatibleEndpoint: 'http://127.0.0.1:33333/v1',
  outboundMode: 'direct',
  rawCaptureDir: '/tmp/codexfree-test',
  rawCaptureEnabled: false,
  running: true,
  upstreamBaseUrl: 'https://chatgpt.com/backend-api/codex'
}

const proxyConfig: ProxyConfig = {
  authPool: { directory: '/tmp/auth-pool', enabled: true },
  listenHost: '127.0.0.1',
  listenPort: 33333,
  codexConfigMonitorEnabled: false,
  outboundProxy: { mode: 'direct', url: '' },
  maxRequestBodyBytes: 0,
  rawCaptureEnabled: false,
  rawCaptureMaxBytes: 0,
  upstreamBaseUrl: 'https://chatgpt.com/backend-api/codex'
}

describe('daemon admin client', () => {
  it('reads status, logs, and protocol messages through the admin API', async () => {
    const server = new DaemonAdminServer({
      host: '127.0.0.1',
      ledger: fakeLedger(),
      port: 0,
      readConfig: () => proxyConfig,
      service: fakeService(),
      token: 'secret-token',
      writeConfig: (config) => config
    })
    const status = await server.start()
    const client = new DaemonAdminClient({ endpoint: status.endpoint, token: 'secret-token' })

    try {
      await expect(client.status()).resolves.toMatchObject({
        proxy: { endpoint: 'http://127.0.0.1:33333/backend-api' }
      })
      await expect(client.logEvents()).resolves.toMatchObject({ events: [] })
      await expect(client.protocolMessages()).resolves.toMatchObject({ messages: [] })
    } finally {
      await server.stop()
    }
  })

  it('writes account pool state through the admin API client', async () => {
    const ledger = fakeLedger()
    const server = new DaemonAdminServer({
      host: '127.0.0.1',
      ledger,
      port: 0,
      readConfig: () => proxyConfig,
      service: fakeService(),
      token: 'secret-token',
      writeConfig: (config) => config
    })
    const status = await server.start()
    const client = new DaemonAdminClient({ endpoint: status.endpoint, token: 'secret-token' })

    try {
      await expect(
        client.syncAccounts([
          { accountId: 'account-1', fingerprint: 'fp-1', label: 'user', sourceFormat: 'codex' }
        ])
      ).resolves.toMatchObject({ accounts: [{ accountId: 'account-1' }] })
      await expect(
        client.updateAccountUsage([
          { accountId: 'account-1', planType: 'free', primaryUsedPercent: '100' }
        ])
      ).resolves.toMatchObject({
        accounts: [{ accountId: 'account-1', primaryUsedPercent: '100' }]
      })
      await expect(client.resetExhaustedAccounts()).resolves.toMatchObject({
        resetAccounts: 1
      })
      await expect(client.setAccountDisabled('account-1', true)).resolves.toMatchObject({
        updatedAccounts: 1
      })
      await expect(client.deleteAccounts(['account-1'])).resolves.toMatchObject({
        accounts: [],
        deletedAccounts: 1
      })
    } finally {
      await server.stop()
    }
  })

  it('saves config separately from proxy reload', async () => {
    let currentConfig = proxyConfig
    const service = fakeService()
    const server = new DaemonAdminServer({
      host: '127.0.0.1',
      ledger: fakeLedger(),
      port: 0,
      readConfig: () => currentConfig,
      service,
      token: 'secret-token',
      writeConfig: (config) => {
        currentConfig = config
        return currentConfig
      }
    })
    const status = await server.start()
    const client = new DaemonAdminClient({ endpoint: status.endpoint, token: 'secret-token' })

    try {
      await expect(
        client.updateConfig({ ...proxyConfig, listenPort: 44444 })
      ).resolves.toMatchObject({ config: { listenPort: 44444 } })
    } finally {
      await server.stop()
    }
  })

  it('includes admin response bodies in request errors', async () => {
    const server = new DaemonAdminServer({
      host: '127.0.0.1',
      ledger: fakeLedger(),
      port: 0,
      readConfig: () => proxyConfig,
      service: fakeService(),
      token: 'secret-token',
      writeConfig: (config) => config
    })
    const status = await server.start()
    const client = new DaemonAdminClient({ endpoint: status.endpoint, token: 'wrong-token' })

    try {
      await expect(client.status()).rejects.toThrow('admin_auth_required')
    } finally {
      await server.stop()
    }
  })
})

function fakeService() {
  return {
    rawCaptureDir: '/tmp/codexfree-test',
    refreshAccountPool: () => proxyStatus,
    refreshAccountState: () => proxyStatus,
    removeAccountsFromPool: () => proxyStatus,
    status: () => proxyStatus,
    switchActiveAccountAndCloseWebSockets: (accountId?: string) => ({
      accountId: accountId ?? 'account-2',
      closedWebSockets: 1,
      switched: true
    })
  }
}

function fakeLedger(): AdminLedger {
  let accounts: ManagedAccountRow[] = []
  return {
    accounts: (): ManagedAccountRow[] => accounts,
    clear: () => 0,
    deleteAccounts: (accountIds: string[]) => {
      const before = accounts.length
      const deletedIds = new Set(accountIds)
      accounts = accounts.filter((account) => !deletedIds.has(account.accountId))
      return before - accounts.length
    },
    recent: () => [],
    recentLogEvents: (): LogEventRow[] => [],
    recentProtocolMessages: (): ProtocolMessageRow[] => [],
    recentTurnSummaries: (): TurnSummaryRow[] => [],
    requestSummary: () => ({
      captured: 0,
      failed: 0,
      forwarded: 0,
      purposeGroups: [],
      quota: 0,
      rejected: 0,
      total: 0
    }),
    recordLogEvent: () => undefined,
    resetExhaustedAccounts: () => {
      const exhausted = accounts.filter((account) => account.status === 'exhausted').length
      accounts = accounts.map((account) => ({
        ...account,
        exhaustedAt: null,
        status: account.status === 'exhausted' ? 'available' : account.status
      }))
      return exhausted
    },
    setAccountDisabled: (accountId: string, disabled: boolean) => {
      let updated = 0
      accounts = accounts.map((account) => {
        if (account.accountId !== accountId) {
          return account
        }
        updated += 1
        return { ...account, status: disabled ? 'disabled' : 'available' }
      })
      return updated
    },
    syncAccountPool: (snapshots: AccountPoolSnapshot[]) => {
      accounts = snapshots.map(toAccountRow)
    },
    updateAccountUsage: (input: AccountUsageInput) => {
      accounts = accounts.map((account) =>
        account.accountId === input.accountId
          ? {
              ...account,
              planType: input.planType ?? account.planType,
              primaryUsedPercent: input.primaryUsedPercent ?? account.primaryUsedPercent,
              status: input.primaryUsedPercent === '100' ? 'exhausted' : account.status
            }
          : account
      )
    },
    usageSummary: () => ({
      accountGroups: [],
      averageDurationMs: null,
      dayGroups: [],
      failed: 0,
      hourGroups: [],
      modelGroups: [],
      requestBytes: 0,
      requestsWithUsage: 0,
      responseBytes: 0,
      sourceGroups: [],
      successful: 0,
      tokenTotal: 0,
      total: 0,
      turnGroups: []
    })
  }
}

function toAccountRow(account: AccountPoolSnapshot): ManagedAccountRow {
  return {
    accountId: account.accountId,
    active: 0,
    email: account.email ?? null,
    exhaustedAt: null,
    fingerprint: account.fingerprint,
    label: account.label,
    lastQuotaRefreshedAt: null,
    lastQuotaRefreshedResetAt: null,
    lastUsageCheckedAt: null,
    lastUsageError: null,
    planType: null,
    primaryUsedPercent: null,
    quotaResetAt: null,
    rateLimitResetsAt: null,
    refreshable: account.refreshable === false ? 0 : 1,
    secondaryRateLimitResetsAt: null,
    secondaryUsedPercent: null,
    sourceFormat: account.sourceFormat,
    status: 'available',
    updatedAt: 1
  }
}
