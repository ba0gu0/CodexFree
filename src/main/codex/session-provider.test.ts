import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { repairCodexSessionProvider } from './session-provider'

describe('Codex session provider repair', () => {
  it('syncs SQLite threads and session_meta JSONL to the current config provider', async () => {
    await withCodexHome(async ({ backupRootDir, codexHomeDir }) => {
      writeFileSync(join(codexHomeDir, 'config.toml'), 'model_provider = "codex"\n')
      writeStateDatabase(join(codexHomeDir, 'state_5.sqlite'), 'openai')
      const sessionPath = writeSessionJsonl(codexHomeDir, [
        JSON.stringify({
          type: 'session_meta',
          payload: { id: 'session-1', model_provider: 'openai' }
        }),
        JSON.stringify({
          type: 'response_item',
          payload: { text: 'model_provider should stay openai' }
        }),
        ''
      ])

      const result = await repairCodexSessionProvider({ backupRootDir, codexHomeDir })

      expect(result).toMatchObject({
        changed: true,
        explicitProvider: true,
        jsonlFilesChanged: 1,
        jsonlParseErrors: 0,
        sessionMetaChanged: 1,
        sqliteChanged: 1,
        sqliteChecked: 1,
        targetProvider: 'codex'
      })
      expect(readThreadProviders(join(codexHomeDir, 'state_5.sqlite'))).toEqual(['codex'])
      const lines = readFileSync(sessionPath, 'utf8').trimEnd().split('\n')
      expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
        payload: { model_provider: 'codex' },
        type: 'session_meta'
      })
      expect(JSON.parse(lines[1] ?? '{}')).toMatchObject({
        payload: { text: 'model_provider should stay openai' },
        type: 'response_item'
      })
      expect(existsSync(join(result.backupDir, 'state_5.sqlite.backup'))).toBe(true)
      expect(
        existsSync(join(result.backupDir, 'sessions-jsonl', '2026', '06', '08', 'session.jsonl'))
      ).toBe(true)
    })
  })

  it('uses Codex default openai provider when model_provider is absent', async () => {
    await withCodexHome(async ({ backupRootDir, codexHomeDir }) => {
      writeFileSync(
        join(codexHomeDir, 'config.toml'),
        'chatgpt_base_url = "http://127.0.0.1:33333/backend-api"\n'
      )
      writeStateDatabase(join(codexHomeDir, 'state_5.sqlite'), 'codex')

      const result = await repairCodexSessionProvider({ backupRootDir, codexHomeDir })

      expect(result).toMatchObject({
        explicitProvider: false,
        sqliteChanged: 1,
        targetProvider: 'openai'
      })
      expect(readThreadProviders(join(codexHomeDir, 'state_5.sqlite'))).toEqual(['openai'])
    })
  })
})

async function withCodexHome(
  run: (paths: { backupRootDir: string; codexHomeDir: string }) => Promise<void>
): Promise<void> {
  const tempDir = mkdtempSync(join(tmpdir(), 'codexfree-session-provider-'))
  try {
    const codexHomeDir = join(tempDir, '.codex')
    const backupRootDir = join(tempDir, 'backups')
    mkdirSync(codexHomeDir)
    mkdirSync(backupRootDir)
    await run({ backupRootDir, codexHomeDir })
  } finally {
    rmSync(tempDir, { force: true, recursive: true })
  }
}

function writeStateDatabase(path: string, provider: string): void {
  const sqlite = new Database(path)
  try {
    sqlite.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, model_provider TEXT);')
    sqlite
      .prepare('INSERT INTO threads (id, model_provider) VALUES (?, ?)')
      .run('thread-1', provider)
  } finally {
    sqlite.close()
  }
}

function writeSessionJsonl(codexHomeDir: string, lines: string[]): string {
  const sessionDir = join(codexHomeDir, 'sessions', '2026', '06', '08')
  mkdirSync(sessionDir, { recursive: true })
  const sessionPath = join(sessionDir, 'session.jsonl')
  writeFileSync(sessionPath, lines.join('\n'))
  return sessionPath
}

function readThreadProviders(path: string): string[] {
  const sqlite = new Database(path, { readonly: true })
  try {
    const rows = sqlite
      .prepare('SELECT model_provider AS provider FROM threads ORDER BY id')
      .all() as Array<{ provider: string }>
    return rows.map((row) => row.provider)
  } finally {
    sqlite.close()
  }
}
