import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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

  it('imports recursive CPA export files with wrapped auth records', async () => {
    const root = mkdtempSync(join(tmpdir(), 'codexfree-import-'))
    const sourceDirectory = join(root, 'source-cpa')
    const nested = join(sourceDirectory, 'nested')
    const target = join(root, 'target')
    mkdirSync(nested, { recursive: true })
    writeFileSync(
      join(nested, 'cpa-export.json'),
      JSON.stringify({
        accounts: [
          {
            access_token: 'team-access-token',
            id_token: fakeJwt({
              email: 'team@example.test',
              'https://api.openai.com/auth': {
                chatgpt_account_id: 'team-account',
                chatgpt_plan_type: 'team'
              }
            }),
            type: 'codex'
          },
          {
            token_data: {
              access_token: 'pro-access-token',
              id_token: fakeJwt({
                email: 'pro@example.test',
                'https://api.openai.com/auth': {
                  chatgpt_account_id: 'pro-account',
                  chatgpt_plan_type: 'pro'
                }
              })
            },
            type: 'codex'
          }
        ]
      })
    )

    const result = await importAuthFilesToDirectory([sourceDirectory], target)

    expect(result.imported).toBe(2)
    expect(result.errors).toEqual([])
    expect(result.accounts.map((account) => account.accountId).sort()).toEqual([
      expect.stringMatching(/^pro-account:user:/),
      expect.stringMatching(/^team-account:user:/)
    ])
    const storedTeam = JSON.parse(readFileSync(join(target, result.accounts[0].fileName), 'utf8'))
    const storedPro = JSON.parse(readFileSync(join(target, result.accounts[1].fileName), 'utf8'))
    expect([storedTeam.plan_type, storedPro.plan_type].sort()).toEqual(['pro', 'team'])
    expect([storedTeam.tokens.account_id, storedPro.tokens.account_id].sort()).toEqual([
      'pro-account',
      'team-account'
    ])
  })

  it('keeps separate team users that share one upstream account id', async () => {
    const root = mkdtempSync(join(tmpdir(), 'codexfree-import-'))
    const firstSource = join(root, 'first-team.json')
    const secondSource = join(root, 'second-team.json')
    const target = join(root, 'target')
    writeFlatTeamAuthFile(firstSource, 'shared-team-account', 'first@example.test')
    writeFlatTeamAuthFile(secondSource, 'shared-team-account', 'second@example.test')

    const result = await importAuthFilesToDirectory([firstSource, secondSource], target)

    expect(result.imported).toBe(2)
    expect(result.errors).toEqual([])
    expect(
      readImportedAuthAccounts(target)
        .map((account) => account.email)
        .sort()
    ).toEqual(['first@example.test', 'second@example.test'])
    expect(
      readImportedAuthAccounts(target)
        .map((account) => account.accountId)
        .sort()
    ).toEqual([
      expect.stringMatching(/^shared-team-account:user:/),
      expect.stringMatching(/^shared-team-account:user:/)
    ])
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

function writeFlatTeamAuthFile(path: string, upstreamAccountId: string, email: string): void {
  writeFileSync(
    path,
    JSON.stringify({
      access_token: `access-${email}`,
      account_id: upstreamAccountId,
      email,
      id_token: fakeJwt({
        email,
        'https://api.openai.com/auth': {
          chatgpt_account_id: upstreamAccountId,
          chatgpt_plan_type: 'team'
        }
      }),
      refresh_token: `refresh-${email}`,
      type: 'codex'
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

function fakeJwt(payload: Record<string, unknown>): string {
  return ['header', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'signature'].join(
    '.'
  )
}
