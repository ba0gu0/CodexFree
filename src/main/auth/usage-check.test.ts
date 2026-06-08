import { mkdtempSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkAccountUsageByAuthorization, checkAuthDirectoryUsage } from './usage-check'

describe('account usage check', () => {
  it('creates an empty managed auth directory before scanning', async () => {
    const directory = join(mkdtempSync(join(tmpdir(), 'codexfree-usage-')), 'missing-auth-pool')

    await expect(checkAuthDirectoryUsage(directory)).resolves.toEqual([])
  })

  it('checks only selected account ids', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'codexfree-selected-usage-'))
    writeAuthFile(directory, 'account-a')
    writeAuthFile(directory, 'account-b')
    const checkedIds: string[] = []
    const server = http.createServer((request, response) => {
      const accountId = String(request.headers['chatgpt-account-id'])
      checkedIds.push(accountId ?? '')
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          email: `${accountId}@example.test`,
          plan_type: 'free',
          primary_used_percent: '12'
        })
      )
    })
    await listen(server)

    try {
      const progress: Array<{ accountId?: string; completed: number; total: number }> = []
      const results = await checkAuthDirectoryUsage(directory, {
        accountIds: ['account-b'],
        onProgress: ({ accountId, completed, total }) =>
          progress.push({ accountId, completed, total }),
        usageUrl: usageUrl(server)
      })

      expect(results.map((result) => result.accountId)).toEqual(['account-b'])
      expect(checkedIds).toEqual(['account-b'])
      expect(progress).toEqual([{ accountId: 'account-b', completed: 1, total: 1 }])
    } finally {
      await closeServer(server)
    }
  })

  it('parses wham usage fields captured in HAR files', async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          account_id: 'user-bJ0csBURmlZaYIRKq6LmjXdI',
          email: 'bellaallen20@chatgpt-money.chat',
          plan_type: 'free',
          rate_limit: {
            allowed: true,
            limit_reached: false,
            primary_window: {
              used_percent: 95,
              limit_window_seconds: 604800,
              reset_after_seconds: 489641,
              reset_at: 1779066511
            },
            secondary_window: {
              used_percent: 20,
              reset_at: 1778742511
            }
          },
          rate_limit_reached_type: null
        })
      )
    })
    await listen(server)

    try {
      const result = await checkAccountUsageByAuthorization({
        accountId: 'account-from-auth-file',
        authorization: 'Bearer access-token',
        label: 'captured usage',
        usageUrl: usageUrl(server)
      })

      expect(result).toMatchObject({
        accountId: 'account-from-auth-file',
        email: 'bellaallen20@chatgpt-money.chat',
        ok: true,
        planType: 'free',
        primaryUsedPercent: '95',
        rateLimitResetsAt: 1779066511000,
        secondaryRateLimitResetsAt: 1778742511000,
        secondaryUsedPercent: '20',
        statusCode: 200
      })
    } finally {
      await closeServer(server)
    }
  })

  it('can resolve account id from usage without sending account header', async () => {
    let accountHeader: string | string[] | undefined
    const server = http.createServer((request, response) => {
      accountHeader = request.headers['chatgpt-account-id']
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          account_id: 'resolved-account',
          email: 'resolved@example.test',
          plan_type: 'free'
        })
      )
    })
    await listen(server)

    try {
      const result = await checkAccountUsageByAuthorization({
        authorization: 'Bearer access-token',
        label: 'token-only',
        usageUrl: usageUrl(server)
      })

      expect(accountHeader).toBeUndefined()
      expect(result).toMatchObject({
        accountId: 'resolved-account',
        email: 'resolved@example.test',
        ok: true,
        planType: 'free'
      })
    } finally {
      await closeServer(server)
    }
  })

  it('returns a timeout result when usage does not respond before the limit', async () => {
    const server = http.createServer(() => {
      // Keep the socket open so the client-side timeout path is exercised.
    })
    await listen(server)

    try {
      const result = await checkAccountUsageByAuthorization({
        accountId: 'slow-account',
        authorization: 'Bearer access-token',
        label: 'slow usage',
        timeoutMs: 20,
        usageUrl: usageUrl(server)
      })

      expect(result).toMatchObject({
        accountId: 'slow-account',
        error: 'usage check timeout after 20ms',
        ok: false
      })
    } finally {
      await closeServer(server)
    }
  })
})

function writeAuthFile(directory: string, accountId: string): void {
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

function usageUrl(server: http.Server): string {
  const address = server.address()
  if (typeof address !== 'object' || address === null) {
    throw new Error('Expected usage test server to listen on a TCP address')
  }
  return `http://127.0.0.1:${address.port}/backend-api/wham/usage`
}
