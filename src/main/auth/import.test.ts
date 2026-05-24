import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { importAuthFilesToDirectory, readImportedAuthAccounts } from './import'

describe('auth file import', () => {
  it('sanitizes account ids before constructing managed file names', async () => {
    const root = mkdtempSync(join(tmpdir(), 'codexfree-import-'))
    const source = join(root, 'source.json')
    const target = join(root, 'target')
    writeFileSync(
      source,
      JSON.stringify({
        auth_mode: 'chatgpt',
        OPENAI_API_KEY: null,
        tokens: {
          id_token: 'id-token',
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          account_id: '../../outside'
        },
        last_refresh: '2026-05-14T00:00:00.000Z',
        email: 'user@example.test'
      })
    )

    const result = await importAuthFilesToDirectory([source], target)

    expect(result.imported).toBe(1)
    expect(result.accounts[0].fileName).toBe('user-example.test-..-..-outside.auth.json')
    expect(readFileSync(join(target, result.accounts[0].fileName), 'utf8')).toContain(
      '"account_id": "../../outside"'
    )
  })

  it('overwrites existing auth files by account id with the latest token', async () => {
    const root = mkdtempSync(join(tmpdir(), 'codexfree-import-'))
    const firstSource = join(root, 'first.json')
    const secondSource = join(root, 'second.json')
    const target = join(root, 'target')
    writeAuthFile(firstSource, {
      accessToken: 'old-token',
      accountId: 'same-account',
      email: 'old@example.test'
    })
    writeAuthFile(secondSource, {
      accessToken: 'new-token',
      accountId: 'same-account',
      email: 'new@example.test'
    })

    const first = await importAuthFilesToDirectory([firstSource], target)
    const second = await importAuthFilesToDirectory([secondSource], target)

    expect(first.imported).toBe(1)
    expect(second.imported).toBe(1)
    expect(existsSync(join(target, first.accounts[0].fileName))).toBe(false)
    const stored = readFileSync(join(target, second.accounts[0].fileName), 'utf8')
    expect(stored).toContain('"access_token": "new-token"')
    expect(stored).not.toContain('"access_token": "old-token"')
    expect(readImportedAuthAccounts(target).map((account) => account.accountId)).toEqual([
      'same-account'
    ])
  })

  it('resolves access-token-only imports through usage precheck', async () => {
    const root = mkdtempSync(join(tmpdir(), 'codexfree-import-'))
    const source = join(root, 'token-only.json')
    const target = join(root, 'target')
    writeFileSync(source, JSON.stringify({ access_token: 'access-token' }))
    const server = http.createServer((request, response) => {
      expect(request.headers.authorization).toBe('Bearer access-token')
      expect(request.headers['chatgpt-account-id']).toBeUndefined()
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
      const result = await importAuthFilesToDirectory([source], target, {
        usageUrl: usageUrl(server)
      })

      expect(result.imported).toBe(1)
      expect(result.accounts[0]).toMatchObject({
        accountId: 'resolved-account',
        email: 'resolved@example.test',
        fileName: 'resolved-example.test-resolved-account.auth.json'
      })
      const stored = JSON.parse(readFileSync(join(target, result.accounts[0].fileName), 'utf8'))
      expect(stored.refreshable).toBe(false)
      expect(stored.tokens.account_id).toBe('resolved-account')
      expect(stored.tokens.access_token).toBe('access-token')
    } finally {
      await closeServer(server)
    }
  })
})

function writeAuthFile(
  path: string,
  input: {
    accessToken: string
    accountId: string
    email: string
  }
): void {
  writeFileSync(
    path,
    JSON.stringify({
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens: {
        id_token: 'id-token',
        access_token: input.accessToken,
        refresh_token: `refresh-${input.accessToken}`,
        account_id: input.accountId
      },
      last_refresh: '2026-05-14T00:00:00.000Z',
      email: input.email
    })
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
