import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writePlaceholderAuthFile } from './placeholder'

interface PlaceholderAuthFixture {
  auth_mode: string
  tokens: {
    access_token: string
    account_id: string
    id_token: string
    refresh_token: string
  }
}

describe('placeholder auth writer', () => {
  it('writes a JWT-shaped ID token while keeping placeholder token markers', () => {
    const home = mkdtempSync(join(tmpdir(), 'codexfree-auth-'))
    try {
      const result = writePlaceholderAuthFile(home)
      const auth = JSON.parse(readFileSync(result.path, 'utf8')) as PlaceholderAuthFixture
      const [header, payload, signature] = auth.tokens.id_token.split('.')

      expect(auth.auth_mode).toBe('chatgpt')
      expect(auth.tokens.account_id).toMatch(/^placeholder-/)
      expect(auth.tokens.access_token).toMatch(/^placeholder\./)
      expect(auth.tokens.refresh_token).toMatch(/^placeholder\./)
      expect(signature).toMatch(/^placeholder-/)
      expect(readJwtPart(header)).toMatchObject({ alg: 'none', typ: 'JWT' })
      expect(readJwtPart(payload)).toMatchObject({
        iss: 'https://auth.openai.com',
        sub: auth.tokens.account_id,
        'https://api.openai.com/profile': {
          email: 'placeholder@codexfree.local'
        }
      })
    } finally {
      rmSync(home, { force: true, recursive: true })
    }
  })

  it('backs up existing auth with the CodexFree auth backup name', () => {
    const home = mkdtempSync(join(tmpdir(), 'codexfree-auth-'))
    try {
      const codexDir = join(home, '.codex')
      mkdirSync(codexDir)
      writeFileSync(join(codexDir, 'auth.json'), '{"old":true}\n', { flag: 'wx' })

      const result = writePlaceholderAuthFile(home)

      expect(result.backedUp).toBe(true)
      expect(result.backupPath?.endsWith('-codexfree-auth.json')).toBe(true)
      expect(readFileSync(result.backupPath ?? '', 'utf8')).toContain('"old":true')
    } finally {
      rmSync(home, { force: true, recursive: true })
    }
  })
})

function readJwtPart(part: string | undefined): unknown {
  if (!part) {
    throw new Error('JWT part is missing')
  }
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as unknown
}
