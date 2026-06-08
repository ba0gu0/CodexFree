import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  type CodexTopLevelConfigSnapshot,
  restoreCodexConfigSnapshot,
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

      const result = writeCodexConfigFile(proxyInput, home)

      expect(result.changed).toBe(true)
      expect(result.backupPath).not.toBeNull()
      expect(result.snapshot).toMatchObject({
        chatgptBaseUrl: 'http://old/backend-api',
        modelProvider: 'codex',
        openaiBaseUrl: 'http://old/backend-api/codex'
      })
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
        backupPath: null,
        changed: false,
        path: configPath,
        snapshot: null
      })
      expect(readFileSync(configPath, 'utf8')).toBe(content)
      expect(readdirSync(codexDir).filter((name) => name.includes('codexfree-backup'))).toEqual([])
    })
  })

  it('restores only the tracked top-level config values from a snapshot', () => {
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
      const snapshot: CodexTopLevelConfigSnapshot = {
        capturedAt: 1,
        chatgptBaseUrl: null,
        modelProvider: 'codex',
        openaiBaseUrl: null,
        path: configPath
      }

      const result = restoreCodexConfigSnapshot(snapshot, home)

      expect(result.changed).toBe(true)
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
