import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeCodexConfigFile } from './placeholder'

describe('codex config writer', () => {
  it('keeps managed Codex URLs at the top-level and removes model_provider', () => {
    const home = mkdtempSync(join(tmpdir(), 'codexfree-config-'))
    try {
      const codexDir = join(home, '.codex')
      const configPath = join(codexDir, 'config.toml')
      mkdirSync(codexDir)
      writeFileSync(
        configPath,
        [
          '[profiles.default]',
          'model_provider = "old"',
          'approval_policy = "never"',
          'chatgpt_base_url = "http://old/backend-api"'
        ].join('\n')
      )

      const result = writeCodexConfigFile(
        {
          chatgptBaseUrl: 'http://127.0.0.1:33333/backend-api',
          openaiBaseUrl: 'http://127.0.0.1:33333/backend-api/codex'
        },
        home
      )

      expect(result.changed).toBe(true)
      expect(result.backupPath).not.toBeNull()
      expect(readFileSync(configPath, 'utf8')).toBe(
        [
          'chatgpt_base_url = "http://127.0.0.1:33333/backend-api"',
          'openai_base_url = "http://127.0.0.1:33333/backend-api/codex"',
          '',
          '[profiles.default]',
          'approval_policy = "never"',
          ''
        ].join('\n')
      )
    } finally {
      rmSync(home, { force: true, recursive: true })
    }
  })

  it('skips backup and rewrite when Codex config is already current', () => {
    const home = mkdtempSync(join(tmpdir(), 'codexfree-config-'))
    try {
      const codexDir = join(home, '.codex')
      const configPath = join(codexDir, 'config.toml')
      mkdirSync(codexDir)
      const content = [
        'chatgpt_base_url = "http://127.0.0.1:33333/backend-api"',
        'openai_base_url = "http://127.0.0.1:33333/backend-api/codex"',
        '',
        '[profiles.default]',
        'approval_policy = "never"',
        ''
      ].join('\n')
      writeFileSync(configPath, content)

      const result = writeCodexConfigFile(
        {
          chatgptBaseUrl: 'http://127.0.0.1:33333/backend-api',
          openaiBaseUrl: 'http://127.0.0.1:33333/backend-api/codex'
        },
        home
      )

      expect(result).toMatchObject({ backupPath: null, changed: false, path: configPath })
      expect(readFileSync(configPath, 'utf8')).toBe(content)
      expect(readdirSync(codexDir).filter((name) => name.includes('codexfree-backup'))).toEqual([])
    } finally {
      rmSync(home, { force: true, recursive: true })
    }
  })
})
