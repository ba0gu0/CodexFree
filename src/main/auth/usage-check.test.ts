import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkAuthDirectoryUsage } from './usage-check'

describe('account usage check', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates an empty managed auth directory before scanning', async () => {
    const directory = join(mkdtempSync(join(tmpdir(), 'codexfree-usage-')), 'missing-auth-pool')

    await expect(checkAuthDirectoryUsage(directory)).resolves.toEqual([])
  })

  it('checks only selected account ids', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'codexfree-selected-usage-'))
    writeAuthFile(directory, 'account-a')
    writeAuthFile(directory, 'account-b')
    const checkedIds: string[] = []

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const accountId = headerValue(init?.headers, 'chatgpt-account-id')
        checkedIds.push(accountId ?? '')
        return Response.json({
          email: `${accountId}@example.test`,
          plan_type: 'free',
          primary_used_percent: '12'
        })
      })
    )

    const progress: Array<{ accountId?: string; completed: number; total: number }> = []
    const results = await checkAuthDirectoryUsage(directory, {
      accountIds: ['account-b'],
      onProgress: ({ accountId, completed, total }) =>
        progress.push({ accountId, completed, total })
    })

    expect(results.map((result) => result.accountId)).toEqual(['account-b'])
    expect(checkedIds).toEqual(['account-b'])
    expect(progress).toEqual([{ accountId: 'account-b', completed: 1, total: 1 }])
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

function headerValue(headers: HeadersInit | undefined, key: string): string | undefined {
  if (!headers || headers instanceof Headers || Array.isArray(headers)) {
    return undefined
  }
  return headers[key]
}
