import { describe, expect, it } from 'vitest'
import type {
  AccountPoolSnapshot,
  AccountUsageInput,
  LogEventInput,
  LogEventRow,
  ManagedAccountRow,
  ProtocolMessageRow,
  TurnSummaryRow
} from '../proxy/ledger-types'
import type { ProxyConfig, ProxyStatus } from '../proxy/types'
import { type AdminLedger, DaemonAdminServer } from './admin'

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
  outboundProxy: { mode: 'direct', url: '' },
  maxRequestBodyBytes: 0,
  rawCaptureEnabled: false,
  rawCaptureMaxBytes: 0,
  upstreamBaseUrl: 'https://chatgpt.com/backend-api/codex'
}

describe('daemon admin server', () => {
  it('requires the local admin token before returning status', async () => {
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

    try {
      const rejected = await fetch(`${status.endpoint}/status`)
      expect(rejected.status).toBe(401)

      const accepted = await fetch(`${status.endpoint}/status`, {
        headers: { authorization: 'Bearer secret-token' }
      })
      expect(accepted.status).toBe(200)
      await expect(accepted.json()).resolves.toMatchObject({
        proxy: { endpoint: 'http://127.0.0.1:33333/backend-api' }
      })
    } finally {
      await server.stop()
    }
  })

  it('accepts config updates only with the admin token', async () => {
    let savedConfig: ProxyConfig | undefined
    const service = fakeService()
    const server = new DaemonAdminServer({
      host: '127.0.0.1',
      ledger: fakeLedger(),
      port: 0,
      readConfig: () => proxyConfig,
      service,
      token: 'secret-token',
      writeConfig: (config) => {
        savedConfig = config
        return config
      }
    })
    const status = await server.start()

    try {
      const response = await fetch(`${status.endpoint}/config`, {
        body: JSON.stringify({ ...proxyConfig, listenPort: 44444 }),
        headers: {
          authorization: 'Bearer secret-token',
          'content-type': 'application/json'
        },
        method: 'PUT'
      })
      expect(response.status).toBe(200)
      expect(savedConfig?.listenPort).toBe(44444)
      await expect(response.json()).resolves.toMatchObject({
        config: { listenPort: 44444 }
      })
    } finally {
      await server.stop()
    }
  })

  it('does not expose daemon lifecycle control endpoints', async () => {
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

    try {
      for (const path of ['start', 'stop', 'restart']) {
        const response = await fetch(`${status.endpoint}/${path}`, {
          headers: { authorization: 'Bearer secret-token' },
          method: 'POST'
        })
        expect(response.status).toBe(404)
      }
    } finally {
      await server.stop()
    }
  })

  it('rejects oversized admin JSON bodies', async () => {
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

    try {
      const response = await fetch(`${status.endpoint}/config`, {
        body: JSON.stringify({ padding: 'x'.repeat(1_048_577) }),
        headers: {
          authorization: 'Bearer secret-token',
          'content-type': 'application/json'
        },
        method: 'PUT'
      })

      expect(response.status).toBe(413)
    } finally {
      await server.stop()
    }
  })

  it('returns shared daemon log events from the ledger', async () => {
    const server = new DaemonAdminServer({
      host: '127.0.0.1',
      ledger: fakeLedger([
        {
          accountId: 'account-1',
          conversationKey: null,
          createdAt: 1,
          detailJson: '{"path":"/backend-api/codex/models"}',
          eventType: 'request',
          id: 'log-1',
          level: 'info',
          message: 'HTTP forward',
          method: 'GET',
          path: '/backend-api/codex/models',
          requestId: 'request-1'
        }
      ]),
      port: 0,
      readConfig: () => proxyConfig,
      service: fakeService(),
      token: 'secret-token',
      writeConfig: (config) => config
    })
    const status = await server.start()

    try {
      const response = await fetch(`${status.endpoint}/log-events?limit=1`, {
        headers: { authorization: 'Bearer secret-token' }
      })
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({
        events: [{ id: 'log-1', message: 'HTTP forward' }]
      })
    } finally {
      await server.stop()
    }
  })

  it('returns parsed WSS protocol messages from the ledger', async () => {
    const server = new DaemonAdminServer({
      host: '127.0.0.1',
      ledger: fakeLedger(
        [],
        [
          {
            accountId: 'account-1',
            cachedInputTokens: null,
            callId: null,
            conversationKey: 'thread-1',
            createdAt: 1,
            direction: 'upstream-to-codex',
            id: 'msg-1',
            itemId: null,
            inputItemCount: null,
            inputTokens: null,
            kind: 'assistant',
            model: null,
            outputTokens: null,
            parentResponseId: null,
            path: '/backend-api/codex/responses',
            payloadBytes: null,
            previousResponseId: null,
            protocolType: null,
            reasoningTokens: null,
            requestId: 'request-1',
            responseId: null,
            sequenceNumber: null,
            summaryJson: null,
            text: 'AI 回复: ok',
            toolCount: null,
            totalTokens: null,
            truncated: null
          }
        ]
      ),
      port: 0,
      readConfig: () => proxyConfig,
      service: fakeService(),
      token: 'secret-token',
      writeConfig: (config) => config
    })
    const status = await server.start()

    try {
      const response = await fetch(`${status.endpoint}/protocol-messages?limit=1`, {
        headers: { authorization: 'Bearer secret-token' }
      })
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({
        messages: [{ id: 'msg-1', kind: 'assistant', text: 'AI 回复: ok' }]
      })
    } finally {
      await server.stop()
    }
  })

  it('syncs imported accounts and usage updates through the ledger', async () => {
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

    try {
      const syncResponse = await fetch(`${status.endpoint}/accounts/sync`, {
        body: JSON.stringify({
          accounts: [{ accountId: 'account-1', fingerprint: 'fp-1', label: 'user@example.com' }]
        }),
        headers: {
          authorization: 'Bearer secret-token',
          'content-type': 'application/json'
        },
        method: 'POST'
      })
      expect(syncResponse.status).toBe(200)
      await expect(syncResponse.json()).resolves.toMatchObject({
        accounts: [{ accountId: 'account-1', label: 'user@example.com' }]
      })

      const usageResponse = await fetch(`${status.endpoint}/accounts/usage`, {
        body: JSON.stringify({
          results: [{ accountId: 'account-1', planType: 'free', primaryUsedPercent: '42' }]
        }),
        headers: {
          authorization: 'Bearer secret-token',
          'content-type': 'application/json'
        },
        method: 'POST'
      })
      expect(usageResponse.status).toBe(200)
      await expect(usageResponse.json()).resolves.toMatchObject({
        accounts: [{ accountId: 'account-1', planType: 'free', primaryUsedPercent: '42' }]
      })
    } finally {
      await server.stop()
    }
  })

  it('updates account lifecycle state through admin write endpoints', async () => {
    const ledger = fakeLedger()
    ledger.syncAccountPool([
      { accountId: 'account-1', fingerprint: 'fp-1', label: 'user', sourceFormat: 'codex' }
    ])
    ledger.updateAccountUsage({ accountId: 'account-1', primaryUsedPercent: '100' })
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

    try {
      const resetResponse = await postAdmin(status.endpoint, 'reset-exhausted', {}, 'secret-token')
      await expect(resetResponse.json()).resolves.toMatchObject({ resetAccounts: 1 })

      const disableResponse = await postAdmin(
        status.endpoint,
        'disable',
        { accountId: 'account-1', disabled: true },
        'secret-token'
      )
      await expect(disableResponse.json()).resolves.toMatchObject({ updatedAccounts: 1 })

      const deleteResponse = await postAdmin(
        status.endpoint,
        'delete',
        { accountIds: ['account-1'] },
        'secret-token'
      )
      await expect(deleteResponse.json()).resolves.toMatchObject({
        accounts: [],
        deletedAccounts: 1
      })
    } finally {
      await server.stop()
    }
  })

  it('switches the active account and closes upgraded websocket connections', async () => {
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

    try {
      const response = await postAdmin(
        status.endpoint,
        'switch',
        { accountId: 'account-2' },
        'secret-token'
      )

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({
        result: { accountId: 'account-2', closedWebSockets: 1, switched: true }
      })
    } finally {
      await server.stop()
    }
  })

  it('records successful admin mutations in the ledger audit log', async () => {
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

    try {
      const response = await fetch(`${status.endpoint}/accounts/reset-exhausted`, {
        headers: { authorization: 'Bearer secret-token' },
        method: 'POST'
      })

      expect(response.status).toBe(200)
      expect(ledger.recentLogEvents()).toEqual([
        expect.objectContaining({
          level: 'info',
          message: 'Admin API mutation',
          method: 'POST',
          path: '/admin/accounts/reset-exhausted'
        })
      ])
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

function fakeLedger(
  events: LogEventRow[] = [],
  messages: ProtocolMessageRow[] = [],
  turns: TurnSummaryRow[] = []
): AdminLedger {
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
    recordLogEvent: (event: LogEventInput) => {
      events.unshift({
        accountId: event.accountId ?? null,
        conversationKey: event.conversationKey ?? null,
        createdAt: Date.now(),
        detailJson: event.detail === undefined ? null : JSON.stringify(event.detail),
        eventType: event.eventType ?? null,
        id: `log-${events.length + 1}`,
        level: event.level,
        message: event.message,
        method: event.method ?? null,
        path: event.path ?? null,
        requestId: event.requestId ?? null
      })
    },
    recentLogEvents: () => events,
    recentProtocolMessages: () => messages,
    recentTurnSummaries: () => turns,
    recent: () => [],
    requestSummary: () => ({
      captured: 0,
      failed: 0,
      forwarded: 0,
      purposeGroups: [],
      quota: 0,
      rejected: 0,
      total: 0
    }),
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
              lastUsageCheckedAt: 123,
              lastUsageError: input.lastUsageError ?? null,
              planType: input.planType ?? account.planType,
              primaryUsedPercent: input.primaryUsedPercent ?? account.primaryUsedPercent,
              rateLimitResetsAt: input.rateLimitResetsAt ?? account.rateLimitResetsAt,
              secondaryRateLimitResetsAt:
                input.secondaryRateLimitResetsAt ?? account.secondaryRateLimitResetsAt,
              secondaryUsedPercent: input.secondaryUsedPercent ?? account.secondaryUsedPercent,
              status:
                input.primaryUsedPercent === '100' || input.secondaryUsedPercent === '100'
                  ? 'exhausted'
                  : account.status
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

function postAdmin(
  endpoint: string,
  path: 'delete' | 'disable' | 'reset-exhausted' | 'switch',
  body: unknown,
  token: string
): Promise<Response> {
  return fetch(`${endpoint}/accounts/${path}`, {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    method: 'POST'
  })
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
