import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ProxyLedger } from '../proxy/ledger'
import type { ManagedAccountRow } from '../proxy/ledger-types'
import type { ProxyStatus } from '../proxy/types'
import { dueQuotaRefreshAccounts, QuotaResetRefresher } from './quota-refresh'

describe('quota reset refresher', () => {
  it('selects only accounts whose reset window is due and not already refreshed', () => {
    const now = new Date('2026-05-21T00:10:00.000Z')
    const resetAt = Date.parse('2026-05-21T00:00:00.000Z')

    expect(
      dueQuotaRefreshAccounts(
        [
          accountRow('due', { rateLimitResetsAt: resetAt }),
          accountRow('not-due', { rateLimitResetsAt: Date.parse('2026-05-21T00:08:00.000Z') }),
          accountRow('refreshed', {
            lastQuotaRefreshedResetAt: resetAt,
            rateLimitResetsAt: resetAt
          }),
          accountRow('disabled', { rateLimitResetsAt: resetAt, status: 'disabled' })
        ],
        now
      ).map((account) => account.accountId)
    ).toEqual(['due'])
  })

  it('refreshes due account usage once per reset window', async () => {
    const root = mkdtempSync(join(tmpdir(), 'codexfree-quota-refresh-'))
    const authPoolDir = join(root, 'auth')
    const ledger = new ProxyLedger(join(root, 'ledger.sqlite'))
    const resetAt = Math.floor((Date.now() - 10 * 60 * 1000) / 1000) * 1000
    writeAuthFile(authPoolDir, 'account-a')
    ledger.syncAccountPool([
      {
        accountId: 'account-a',
        fingerprint: 'fingerprint-a',
        label: 'account-a',
        refreshable: true,
        sourceFormat: 'codex'
      }
    ])
    ledger.updateAccountUsage({
      accountId: 'account-a',
      planType: 'free',
      primaryUsedPercent: '100',
      rateLimitResetsAt: resetAt
    })

    const checkedAccounts: string[] = []
    const server = http.createServer((request, response) => {
      checkedAccounts.push(String(request.headers['chatgpt-account-id']))
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          email: 'account-a@example.test',
          plan_type: 'free',
          rate_limit: {
            primary_window: {
              reset_at: Math.floor((Date.now() + 7 * 24 * 60 * 60 * 1000) / 1000),
              used_percent: 1
            }
          }
        })
      )
    })
    await listen(server)

    try {
      const refresher = new QuotaResetRefresher({
        authPoolDir,
        ledger,
        readUpstreamBaseUrl: () => `${serverOrigin(server)}/backend-api/codex`,
        refreshAccountState: () => proxyStatus()
      })

      await expect(refresher.refreshDueAccounts()).resolves.toMatchObject({
        checked: 1,
        refreshed: 1,
        skipped: 0
      })
      await expect(refresher.refreshDueAccounts()).resolves.toMatchObject({
        checked: 0,
        refreshed: 0,
        skipped: 0
      })

      const account = ledger.accounts()[0]
      expect(checkedAccounts).toEqual(['account-a'])
      expect(account.status).toBe('available')
      expect(account.email).toBe('account-a@example.test')
      expect(account.primaryUsedPercent).toBe('1')
      expect(account.lastQuotaRefreshedResetAt).toBe(resetAt)
      expect(ledger.recentLogEvents(1)[0]?.message).toBe(
        'Quota reset window refreshed account usage'
      )
    } finally {
      await closeServer(server)
      ledger.close()
    }
  })

  it('cleans usage 402 refreshes without writing skipped events', async () => {
    const root = mkdtempSync(join(tmpdir(), 'codexfree-quota-refresh-402-'))
    const authPoolDir = join(root, 'auth')
    const ledger = new ProxyLedger(join(root, 'ledger.sqlite'))
    const resetAt = Math.floor((Date.now() - 10 * 60 * 1000) / 1000) * 1000
    writeAuthFile(authPoolDir, 'account-a')
    ledger.syncAccountPool([
      {
        accountId: 'account-a',
        fingerprint: 'fingerprint-a',
        label: 'account-a',
        refreshable: true,
        sourceFormat: 'codex'
      }
    ])
    ledger.updateAccountUsage({
      accountId: 'account-a',
      planType: 'team',
      primaryUsedPercent: '100',
      rateLimitResetsAt: resetAt
    })

    const checkedAccounts: string[] = []
    const server = http.createServer((request, response) => {
      checkedAccounts.push(String(request.headers['chatgpt-account-id']))
      response.writeHead(402, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          account_id: 'account-a',
          plan_type: 'team',
          rate_limit: {
            primary_window: {
              reset_at: Math.floor(resetAt / 1000)
            }
          }
        })
      )
    })
    await listen(server)

    try {
      const refresher = new QuotaResetRefresher({
        authPoolDir,
        ledger,
        readUpstreamBaseUrl: () => `${serverOrigin(server)}/backend-api/codex`,
        refreshAccountState: () => proxyStatus()
      })

      await expect(refresher.refreshDueAccounts()).resolves.toMatchObject({
        checked: 1,
        refreshed: 0,
        skipped: 1
      })
      await expect(refresher.refreshDueAccounts()).resolves.toMatchObject({
        checked: 0,
        refreshed: 0,
        skipped: 0
      })

      const account = ledger.accounts()[0]
      expect(checkedAccounts).toEqual(['account-a'])
      expect(account.status).toBe('exhausted')
      expect(account.lastUsageError).toBe('usage check failed: 402')
      expect(account.primaryUsedPercent).toBe('100')
      expect(account.lastQuotaRefreshedResetAt).toBe(resetAt)
      expect(ledger.recentLogEvents(5)).toEqual([])
    } finally {
      await closeServer(server)
      ledger.close()
    }
  })
})

function accountRow(
  accountId: string,
  overrides: Partial<ManagedAccountRow> = {}
): ManagedAccountRow {
  return {
    accountId,
    active: 0,
    email: null,
    exhaustedAt: null,
    fingerprint: `${accountId}-fingerprint`,
    label: accountId,
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

function writeAuthFile(directory: string, accountId: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  writeFileSync(
    join(directory, `${accountId}.json`),
    `${JSON.stringify({
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens: {
        id_token: 'id-token',
        access_token: `access-${accountId}`,
        refresh_token: `refresh-${accountId}`,
        account_id: accountId
      },
      last_refresh: '2026-05-19T00:00:00.000Z'
    })}\n`
  )
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

function serverOrigin(server: http.Server): string {
  const address = server.address()
  if (typeof address !== 'object' || address === null) {
    throw new Error('Expected server to listen on a TCP address')
  }
  return `http://127.0.0.1:${address.port}`
}

function proxyStatus(): ProxyStatus {
  return {
    authPoolAccounts: 1,
    authPoolAvailableAccounts: 1,
    authPoolDisabledAccounts: 0,
    authPoolEnabled: true,
    authPoolExhaustedAccounts: 0,
    endpoint: 'http://127.0.0.1:33333',
    openaiBaseUrl: 'http://127.0.0.1:33333/backend-api',
    openaiCompatibleEndpoint: 'http://127.0.0.1:33333/backend-api/codex',
    outboundMode: 'direct',
    rawCaptureDir: '',
    rawCaptureEnabled: false,
    running: true,
    upstreamBaseUrl: 'https://chatgpt.com/backend-api/codex'
  }
}
