import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  inspectCodexAuth,
  inspectCodexConfig,
  renameCodexAuthForRelogin,
  restoreCodexAuthBackup,
  type SetupTargetConfig,
  writeImportedAccountToCodexAuth
} from './setup-assistant'

const target: SetupTargetConfig = {
  chatgptBaseUrl: 'http://127.0.0.1:33333/backend-api',
  openaiBaseUrl: 'http://127.0.0.1:33333/backend-api/codex'
}

describe('setup assistant Codex config inspection', () => {
  it('detects current top-level Codex base URLs', () => {
    withHome((home) => {
      writeCodexConfig(
        home,
        [
          'chatgpt_base_url = "http://127.0.0.1:33333/backend-api"',
          'openai_base_url = "http://127.0.0.1:33333/backend-api/codex"',
          '',
          '[profiles.default]',
          'approval_policy = "never"'
        ].join('\n')
      )

      expect(inspectCodexConfig(target, home).health).toBe('current')
    })
  })

  it('detects config written under the wrong TOML table', () => {
    withHome((home) => {
      writeCodexConfig(
        home,
        [
          '[profiles.default]',
          'chatgpt_base_url = "http://127.0.0.1:33333/backend-api"',
          'openai_base_url = "http://127.0.0.1:33333/backend-api/codex"'
        ].join('\n')
      )

      expect(inspectCodexConfig(target, home).health).toBe('wrong_table')
    })
  })

  it('detects stale port while preserving account-mode paths', () => {
    withHome((home) => {
      writeCodexConfig(
        home,
        [
          'chatgpt_base_url = "http://127.0.0.1:44444/backend-api"',
          'openai_base_url = "http://127.0.0.1:44444/backend-api/codex"'
        ].join('\n')
      )

      expect(inspectCodexConfig(target, home).health).toBe('port_mismatch')
    })
  })

  it('does not treat provider definitions as top-level model_provider drift', () => {
    withHome((home) => {
      writeCodexConfig(
        home,
        [
          'chatgpt_base_url = "http://127.0.0.1:33333/backend-api"',
          'openai_base_url = "http://127.0.0.1:33333/backend-api/codex"',
          '',
          '[model_providers.codex]',
          'name = "codex"',
          'base_url = "https://api.baoguo.site/v1"'
        ].join('\n')
      )

      expect(inspectCodexConfig(target, home)).toMatchObject({
        hasModelProvider: false,
        health: 'current'
      })
    })
  })
})

describe('setup assistant Codex auth inspection', () => {
  it('does not treat placeholder auth as a completed Codex login', () => {
    withHome((home) => {
      const accountId = 'placeholder-account'
      writeAuth(
        home,
        JSON.stringify({
          auth_mode: 'chatgpt',
          tokens: {
            id_token: jwtForAccount(accountId),
            access_token: 'placeholder.access',
            account_id: accountId,
            refresh_token: 'placeholder.refresh'
          }
        })
      )

      expect(inspectCodexAuth(home).health).toBe('placeholder')
    })
  })

  it('detects Codex API-key login mode as a rename candidate', () => {
    withHome((home) => {
      writeAuth(
        home,
        JSON.stringify({
          OPENAI_API_KEY: 'sk-test',
          auth_mode: 'api-key'
        })
      )

      expect(inspectCodexAuth(home).health).toBe('api_key_mode')
    })
  })

  it('renames auth.json for relogin without writing a replacement file', () => {
    withHome((home) => {
      writeAuth(
        home,
        JSON.stringify({
          auth_mode: 'chatgpt',
          tokens: {
            access_token: 'real-access',
            account_id: 'account-id',
            refresh_token: 'real-refresh'
          }
        })
      )

      const result = renameCodexAuthForRelogin(home)
      const codexDir = join(home, '.codex')

      expect(result.health).toBe('missing')
      expect(readFileSync(join(codexDir, result.backupFileName), 'utf8')).toContain('real-access')
    })
  })

  it('writes an imported account to Codex auth after backing up the current file', () => {
    withHome((home) => {
      const importedDir = join(home, 'imported-auth')
      mkdirSync(importedDir)
      writeImportedAuth(importedDir, 'pool.auth.json', {
        accountId: 'pool-account',
        accessToken: 'pool-access',
        refreshToken: 'pool-refresh'
      })
      writeAuth(
        home,
        JSON.stringify({
          auth_mode: 'chatgpt',
          tokens: {
            access_token: 'old-access',
            account_id: 'old-account',
            refresh_token: 'old-refresh'
          }
        })
      )

      const result = writeImportedAccountToCodexAuth('pool-account', importedDir, home)
      const codexDir = join(home, '.codex')

      expect(result).toMatchObject({
        accountId: 'pool-account',
        replaced: true
      })
      expect(result.backupFileName).toMatch(/^\d{8}T\d{6}-codexfree-auth\.json$/)
      expect(inspectCodexAuth(home).health).toBe('codex_login_like')
      expect(inspectCodexAuth(home).backupFileNames).toContain(result.backupFileName)
      expect(readFileSync(join(codexDir, 'auth.json'), 'utf8')).toContain('pool-access')
      expect(readFileSync(join(codexDir, result.backupFileName), 'utf8')).toContain('old-access')
    })
  })

  it('restores the latest Codex auth backup after backing up the current file', () => {
    withHome((home) => {
      writeAuth(
        home,
        JSON.stringify({
          auth_mode: 'chatgpt',
          tokens: {
            access_token: 'current-access',
            account_id: 'current-account',
            refresh_token: 'current-refresh'
          }
        })
      )
      const codexDir = join(home, '.codex')
      writeFileSync(
        join(codexDir, '20260608T010203-codexfree-auth.json'),
        JSON.stringify({
          auth_mode: 'chatgpt',
          tokens: {
            access_token: 'backup-access',
            account_id: 'backup-account',
            refresh_token: 'backup-refresh'
          }
        })
      )

      const result = restoreCodexAuthBackup('20260608T010203-codexfree-auth.json', home)

      expect(result).toMatchObject({
        replaced: true,
        restoredFileName: '20260608T010203-codexfree-auth.json'
      })
      expect(readFileSync(join(codexDir, 'auth.json'), 'utf8')).toContain('backup-access')
      expect(result.backupFileName).not.toBeNull()
      expect(readFileSync(join(codexDir, result.backupFileName ?? ''), 'utf8')).toContain(
        'current-access'
      )
    })
  })
})

function withHome(run: (home: string) => void): void {
  const home = mkdtempSync(join(tmpdir(), 'codexfree-setup-'))
  try {
    run(home)
  } finally {
    rmSync(home, { force: true, recursive: true })
  }
}

function writeCodexConfig(home: string, content: string): void {
  const codexDir = join(home, '.codex')
  mkdirSync(codexDir)
  writeFileSync(join(codexDir, 'config.toml'), `${content}\n`)
}

function writeAuth(home: string, content: string): void {
  const codexDir = join(home, '.codex')
  mkdirSync(codexDir)
  writeFileSync(join(codexDir, 'auth.json'), `${content}\n`)
}

function writeImportedAuth(
  directory: string,
  fileName: string,
  input: { accountId: string; accessToken: string; refreshToken: string }
): void {
  writeFileSync(
    join(directory, fileName),
    `${JSON.stringify({
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens: {
        id_token: 'id-token',
        access_token: input.accessToken,
        refresh_token: input.refreshToken,
        account_id: input.accountId
      },
      last_refresh: '2026-06-08T00:00:00.000Z'
    })}\n`
  )
}

function jwtForAccount(accountId: string): string {
  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url')
  return [
    encode({ alg: 'none', typ: 'JWT' }),
    encode({
      iss: 'https://auth.openai.com',
      sub: accountId,
      'https://api.openai.com/profile': {
        email: 'placeholder@codexfree.local'
      }
    }),
    'placeholder-signature'
  ].join('.')
}
