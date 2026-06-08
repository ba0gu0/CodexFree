import Database from 'better-sqlite3'
import type { CodexTopLevelConfigSnapshot } from './config'

const codexConfigSnapshotKey = 'codex.config.snapshot'

export interface CodexConfigSnapshotSaveResult {
  snapshot: CodexTopLevelConfigSnapshot
}

export function saveCodexConfigSnapshot(
  databasePath: string,
  snapshot: CodexTopLevelConfigSnapshot
): CodexConfigSnapshotSaveResult {
  const sqlite = new Database(databasePath)
  try {
    ensureProxySettingsTable(sqlite)
    upsertSetting(sqlite, codexConfigSnapshotKey, JSON.stringify(snapshot))
    return { snapshot }
  } finally {
    sqlite.close()
  }
}

export function readCodexConfigSnapshot(databasePath: string): CodexTopLevelConfigSnapshot | null {
  const sqlite = new Database(databasePath)
  try {
    ensureProxySettingsTable(sqlite)
    const row = sqlite
      .prepare('SELECT value FROM proxy_settings WHERE key = ?')
      .get(codexConfigSnapshotKey) as { value: string } | undefined
    if (!row) {
      return null
    }
    return parseSnapshot(row.value)
  } finally {
    sqlite.close()
  }
}

function parseSnapshot(value: string): CodexTopLevelConfigSnapshot {
  const parsed = JSON.parse(value) as unknown
  if (!isRecord(parsed)) {
    throw new Error('Saved Codex config snapshot is not an object')
  }
  return {
    capturedAt: numberField(parsed, 'capturedAt'),
    chatgptBaseUrl: nullableStringField(parsed, 'chatgptBaseUrl'),
    modelProvider: nullableStringField(parsed, 'modelProvider'),
    openaiBaseUrl: nullableStringField(parsed, 'openaiBaseUrl'),
    path: stringField(parsed, 'path')
  }
}

function ensureProxySettingsTable(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS proxy_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
}

function upsertSetting(sqlite: Database.Database, key: string, value: string): void {
  sqlite
    .prepare(
      `
        INSERT INTO proxy_settings (key, value, updated_at)
        VALUES (@key, @value, @updatedAt)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `
    )
    .run({
      key,
      updatedAt: Date.now(),
      value
    })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string') {
    throw new Error(`Saved Codex config snapshot field "${key}" is invalid`)
  }
  return value
}

function nullableStringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  if (value === null) {
    return null
  }
  if (typeof value !== 'string') {
    throw new Error(`Saved Codex config snapshot field "${key}" is invalid`)
  }
  return value
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Saved Codex config snapshot field "${key}" is invalid`)
  }
  return value
}
