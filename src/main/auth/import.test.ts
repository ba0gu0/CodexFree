import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { importAuthFilesToDirectory } from './import'

describe('auth file import', () => {
  it('sanitizes account ids before constructing managed file names', () => {
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

    const result = importAuthFilesToDirectory([source], target)

    expect(result.imported).toBe(1)
    expect(result.accounts[0].fileName).toBe('user-example.test-..-..-outside.auth.json')
    expect(readFileSync(join(target, result.accounts[0].fileName), 'utf8')).toContain(
      '"account_id": "../../outside"'
    )
  })
})
