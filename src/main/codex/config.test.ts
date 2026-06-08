import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  listCodexConfigBackupFileNames,
  restoreCodexConfigBackup,
  writeCodexConfigFile
} from './config'

const proxyInput = {
  chatgptBaseUrl: 'http://127.0.0.1:33333/backend-api',
  openaiBaseUrl: 'http://127.0.0.1:33333/backend-api/codex'
}

describe('Codex config writer', () => {
  it('removes only top-level model_provider while preserving provider definitions', () => {
    withHome((home) => {
      const configPath = writeCodexConfig(
        home,
        [
          'model_provider = "codex"',
          'chatgpt_base_url = "http://old/backend-api"',
          'openai_base_url = "http://old/backend-api/codex"',
          '',
          '[model_providers.codex]',
          'name = "codex"',
          'base_url = "https://api.baoguo.site/v1"',
          '',
          '[profiles.default]',
          'model_provider = "profile-provider"',
          'approval_policy = "never"'
        ].join('\n')
      )
      writeFileSync(join(home, '.codex', 'auth.json'), '{"tokens":{"access_token":"old"}}\n')

      const result = writeCodexConfigFile(proxyInput, home)

      expect(result.changed).toBe(true)
      expect(result.backupPath).not.toBeNull()
      expect(result.backupPath?.endsWith('-codexfree-config.toml')).toBe(true)
      expect(result.authBackupPath?.endsWith('-codexfree-auth.json')).toBe(true)
      expect(readFileSync(result.authBackupPath ?? '', 'utf8')).toContain('old')
      expect(readFileSync(configPath, 'utf8')).toBe(
        [
          'chatgpt_base_url = "http://127.0.0.1:33333/backend-api"',
          'openai_base_url = "http://127.0.0.1:33333/backend-api/codex"',
          '',
          '[model_providers.codex]',
          'name = "codex"',
          'base_url = "https://api.baoguo.site/v1"',
          '',
          '[profiles.default]',
          'model_provider = "profile-provider"',
          'approval_policy = "never"',
          ''
        ].join('\n')
      )
    })
  })

  it('skips backup and rewrite when Codex proxy config is already current', () => {
    withHome((home) => {
      const codexDir = join(home, '.codex')
      const content = [
        'chatgpt_base_url = "http://127.0.0.1:33333/backend-api"',
        'openai_base_url = "http://127.0.0.1:33333/backend-api/codex"',
        '',
        '[model_providers.codex]',
        'base_url = "https://api.baoguo.site/v1"',
        ''
      ].join('\n')
      const configPath = writeCodexConfig(home, content)

      const result = writeCodexConfigFile(proxyInput, home)

      expect(result).toMatchObject({
        authBackupPath: null,
        backupPath: null,
        changed: false,
        path: configPath
      })
      expect(readFileSync(configPath, 'utf8')).toBe(content)
      expect(readdirSync(codexDir).filter((name) => name.includes('codexfree-config'))).toEqual([])
    })
  })

  it('restores a selected CodexFree config backup as a whole file', () => {
    withHome((home) => {
      const configPath = writeCodexConfig(
        home,
        [
          'chatgpt_base_url = "http://127.0.0.1:33333/backend-api"',
          'openai_base_url = "http://127.0.0.1:33333/backend-api/codex"',
          '',
          '[model_providers.codex]',
          'base_url = "https://api.baoguo.site/v1"'
        ].join('\n')
      )
      writeFileSync(
        join(home, '.codex', '20260608T010203-codexfree-config.toml'),
        [
          'model_provider = "codex"',
          '',
          '[model_providers.codex]',
          'base_url = "https://api.baoguo.site/v1"',
          ''
        ].join('\n')
      )

      expect(listCodexConfigBackupFileNames(home)).toEqual([
        '20260608T010203-codexfree-config.toml'
      ])

      const result = restoreCodexConfigBackup('20260608T010203-codexfree-config.toml', home)

      expect(result.changed).toBe(true)
      expect(result.restoredFileName).toBe('20260608T010203-codexfree-config.toml')
      expect(readFileSync(configPath, 'utf8')).toBe(
        [
          'model_provider = "codex"',
          '',
          '[model_providers.codex]',
          'base_url = "https://api.baoguo.site/v1"',
          ''
        ].join('\n')
      )
    })
  })
})

function withHome(run: (home: string) => void): void {
  const home = mkdtempSync(join(tmpdir(), 'codexfree-config-'))
  try {
    run(home)
  } finally {
    rmSync(home, { force: true, recursive: true })
  }
}

function writeCodexConfig(home: string, content: string): string {
  const codexDir = join(home, '.codex')
  mkdirSync(codexDir)
  const configPath = join(codexDir, 'config.toml')
  writeFileSync(configPath, content.endsWith('\n') ? content : `${content}\n`)
  return configPath
}
