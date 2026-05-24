import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CodexChatGptAuth } from '../auth/normalize'
import { ProxyLedger } from '../proxy/ledger'
import type { ProxyStatus } from '../proxy/types'
import { TokenRefreshMaintainer } from './token-refresh'

describe('token refresh maintainer', () => {
  it('refreshes due refreshable tokens and reloads the account pool', async () => {
    const root = mkdtempSync(join(tmpdir(), 'codexfree-token-refresh-'))
    const authPoolDir = join(root, 'auth')
    const authPath = join(authPoolDir, 'account-a.json')
    writeAuthFile(authPath, {
      accessToken: 'old-access',
      accountId: 'account-a',
      refreshToken: 'refresh-token'
    })
    const ledger = new ProxyLedger(join(root, 'ledger.sqlite'))
    let poolReloads = 0

    try {
      const maintainer = new TokenRefreshMaintainer({
        authPoolDir,
        ledger,
        refreshAccountPool: () => {
          poolReloads += 1
          return proxyStatus()
        },
        refresher: async (auth: CodexChatGptAuth, now: Date) => ({
          ...auth,
          tokens: {
            ...auth.tokens,
            access_token: 'new-access',
            refresh_token: 'new-refresh'
          },
          last_refresh: now.toISOString()
        })
      })

      await expect(
        maintainer.refreshDueTokens(new Date('2026-05-23T00:00:00.000Z'))
      ).resolves.toMatchObject({ checked: 1, refreshed: 1, skipped: 0 })

      const stored = JSON.parse(readFileSync(authPath, 'utf8'))
      expect(stored.tokens.access_token).toBe('new-access')
      expect(stored.tokens.refresh_token).toBe('new-refresh')
      expect(stored.refreshable).toBe(true)
      expect(poolReloads).toBe(1)
      expect(ledger.recentLogEvents(1)[0]?.message).toBe('Account access token refreshed')
    } finally {
      ledger.close()
    }
  })

  it('skips access-token-only accounts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'codexfree-token-refresh-'))
    const authPath = join(root, 'auth', 'account-a.json')
    writeAuthFile(authPath, {
      accessToken: 'old-access',
      accountId: 'account-a',
      refreshToken: ''
    })
    const ledger = new ProxyLedger(join(root, 'ledger.sqlite'))

    try {
      const maintainer = new TokenRefreshMaintainer({
        authPoolDir: join(root, 'auth'),
        ledger,
        refreshAccountPool: () => proxyStatus(),
        refresher: async () => {
          throw new Error('should not refresh access-token-only accounts')
        }
      })

      await expect(maintainer.refreshDueTokens()).resolves.toMatchObject({
        checked: 0,
        refreshed: 0,
        skipped: 0
      })
      const stored = JSON.parse(readFileSync(authPath, 'utf8'))
      expect(stored.tokens.access_token).toBe('old-access')
    } finally {
      ledger.close()
    }
  })
})

function writeAuthFile(
  path: string,
  input: { accessToken: string; accountId: string; refreshToken: string }
): void {
  const directory = path.slice(0, path.lastIndexOf('/'))
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  writeFileSync(
    path,
    `${JSON.stringify({
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens: {
        id_token: '',
        access_token: input.accessToken,
        refresh_token: input.refreshToken,
        account_id: input.accountId
      },
      last_refresh: '2026-05-01T00:00:00.000Z'
    })}\n`,
    { mode: 0o600 }
  )
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
