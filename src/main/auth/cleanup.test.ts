import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deleteImportedAuthFilesForAccounts, isCleanableUsageError } from './cleanup'

describe('auth cleanup', () => {
  it('treats usage check 401 and 402 errors as cleanable', () => {
    expect(isCleanableUsageError('usage check failed: 401')).toBe(true)
    expect(isCleanableUsageError('usage check failed: 402')).toBe(true)
    expect(isCleanableUsageError('usage check failed: 500')).toBe(false)
    expect(isCleanableUsageError(null)).toBe(false)
  })

  it('deletes imported auth files by normalized account id', () => {
    const directory = mkdtempSync(join(tmpdir(), 'codexfree-auth-cleanup-'))
    const accountAPath = join(directory, 'account-a.auth.json')
    const accountBPath = join(directory, 'account-b.auth.json')
    try {
      writeNativeAuthFile(accountAPath, 'account-a')
      writeNativeAuthFile(accountBPath, 'account-b')

      expect(deleteImportedAuthFilesForAccounts(directory, ['account-a'])).toBe(1)
      expect(existsSync(accountAPath)).toBe(false)
      expect(existsSync(accountBPath)).toBe(true)
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })
})

function writeNativeAuthFile(path: string, accountId: string): void {
  writeFileSync(
    path,
    `${JSON.stringify({
      OPENAI_API_KEY: null,
      auth_mode: 'chatgpt',
      last_refresh: '2026-06-10T00:00:00.000Z',
      tokens: {
        access_token: `access-${accountId}`,
        account_id: accountId,
        id_token: '',
        refresh_token: `refresh-${accountId}`
      }
    })}\n`
  )
}
