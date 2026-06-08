import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative } from 'node:path'
import Database from 'better-sqlite3'
import { resolveCodexSessionProviderTargetFromCodexHome } from './config'

export interface CodexSessionProviderRepairResult {
  backupDir: string
  changed: boolean
  configPath: string
  explicitProvider: boolean
  jsonlFilesChanged: number
  jsonlFilesChecked: number
  jsonlParseErrors: number
  sessionMetaChanged: number
  sqliteChanged: number
  sqliteChecked: number
  targetProvider: string
}

export interface CodexSessionProviderRepairInput {
  backupRootDir: string
  codexHomeDir?: string
}

interface JsonlRepairResult {
  filesChanged: number
  filesChecked: number
  parseErrors: number
  sessionMetaChanged: number
}

interface SqliteRepairResult {
  changed: number
  checked: number
}

export async function repairCodexSessionProvider(
  input: CodexSessionProviderRepairInput
): Promise<CodexSessionProviderRepairResult> {
  const codexHomeDir = input.codexHomeDir ?? join(homedir(), '.codex')
  const target = resolveCodexSessionProviderTargetFromCodexHome(codexHomeDir)
  const backupDir = join(
    input.backupRootDir,
    `${timestampForPath()}-${safePathPart(target.provider)}`
  )
  mkdirSync(backupDir, { recursive: true, mode: 0o700 })

  const sqliteResult = await repairStateDatabases(codexHomeDir, backupDir, target.provider)
  const jsonlResult = repairSessionJsonl(codexHomeDir, backupDir, target.provider)

  return {
    backupDir,
    changed: sqliteResult.changed > 0 || jsonlResult.filesChanged > 0,
    configPath: target.configPath,
    explicitProvider: target.explicit,
    jsonlFilesChanged: jsonlResult.filesChanged,
    jsonlFilesChecked: jsonlResult.filesChecked,
    jsonlParseErrors: jsonlResult.parseErrors,
    sessionMetaChanged: jsonlResult.sessionMetaChanged,
    sqliteChanged: sqliteResult.changed,
    sqliteChecked: sqliteResult.checked,
    targetProvider: target.provider
  }
}

async function repairStateDatabases(
  codexHomeDir: string,
  backupDir: string,
  targetProvider: string
): Promise<SqliteRepairResult> {
  if (!existsSync(codexHomeDir)) {
    return { changed: 0, checked: 0 }
  }

  let checked = 0
  let changed = 0
  for (const entry of readdirSync(codexHomeDir, { withFileTypes: true })) {
    if (!entry.isFile() || !/^state_.*\.sqlite$/.test(entry.name)) {
      continue
    }
    checked += 1
    const dbPath = join(codexHomeDir, entry.name)
    if (await repairStateDatabase(dbPath, backupDir, targetProvider)) {
      changed += 1
    }
  }
  return { changed, checked }
}

async function repairStateDatabase(
  dbPath: string,
  backupDir: string,
  targetProvider: string
): Promise<boolean> {
  const sqlite = new Database(dbPath, { timeout: 10_000 })
  try {
    if (!hasThreadsProviderColumn(sqlite)) {
      return false
    }
    const row = sqlite
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM threads
          WHERE model_provider IS NULL OR model_provider <> ?
        `
      )
      .get(targetProvider) as { count: number }
    if (row.count === 0) {
      return false
    }

    await sqlite.backup(join(backupDir, `${basename(dbPath)}.backup`))
    sqlite
      .prepare(
        `
          UPDATE threads
          SET model_provider = ?
          WHERE model_provider IS NULL OR model_provider <> ?
        `
      )
      .run(targetProvider, targetProvider)
    const integrity = sqlite.pragma('integrity_check', { simple: true }) as string
    if (integrity !== 'ok') {
      throw new Error(`SQLite integrity check failed for ${dbPath}: ${integrity}`)
    }
    return true
  } finally {
    sqlite.close()
  }
}

function hasThreadsProviderColumn(sqlite: Database.Database): boolean {
  const table = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'threads'")
    .get() as { name: string } | undefined
  if (!table) {
    return false
  }
  const columns = sqlite.prepare('PRAGMA table_info(threads)').all() as Array<{ name: string }>
  return columns.some((column) => column.name === 'model_provider')
}

function repairSessionJsonl(
  codexHomeDir: string,
  backupDir: string,
  targetProvider: string
): JsonlRepairResult {
  const sessionsDir = join(codexHomeDir, 'sessions')
  if (!existsSync(sessionsDir)) {
    return { filesChanged: 0, filesChecked: 0, parseErrors: 0, sessionMetaChanged: 0 }
  }

  let filesChanged = 0
  let filesChecked = 0
  let parseErrors = 0
  let sessionMetaChanged = 0
  for (const file of walkJsonlFiles(sessionsDir)) {
    filesChecked += 1
    const result = repairJsonlFile(file, sessionsDir, backupDir, targetProvider)
    if (result.changed) {
      filesChanged += 1
    }
    parseErrors += result.parseErrors
    sessionMetaChanged += result.sessionMetaChanged
  }
  return { filesChanged, filesChecked, parseErrors, sessionMetaChanged }
}

function repairJsonlFile(
  filePath: string,
  sessionsDir: string,
  backupDir: string,
  targetProvider: string
): { changed: boolean; parseErrors: number; sessionMetaChanged: number } {
  const original = readFileSync(filePath, 'utf8')
  const hadFinalNewline = original.endsWith('\n')
  const lines = original.split('\n')
  let changed = false
  let parseErrors = 0
  let sessionMetaChanged = 0

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line?.includes('"model_provider"')) {
      continue
    }

    const parsed = parseJsonLine(line)
    if (!parsed.ok) {
      parseErrors += 1
      continue
    }
    const record = parsed.value
    if (!isRecord(record) || record.type !== 'session_meta' || !isRecord(record.payload)) {
      continue
    }
    const currentProvider = record.payload.model_provider
    if (typeof currentProvider !== 'string' || currentProvider === targetProvider) {
      continue
    }

    record.payload.model_provider = targetProvider
    lines[index] = JSON.stringify(record)
    changed = true
    sessionMetaChanged += 1
  }

  if (!changed) {
    return { changed: false, parseErrors, sessionMetaChanged }
  }

  backupJsonlFile(filePath, sessionsDir, backupDir)
  let next = lines.join('\n')
  if (!hadFinalNewline && next.endsWith('\n')) {
    next = next.slice(0, -1)
  }
  writeFileSync(filePath, next, 'utf8')
  return { changed: true, parseErrors, sessionMetaChanged }
}

function walkJsonlFiles(directory: string, out: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      walkJsonlFiles(fullPath, out)
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      out.push(fullPath)
    }
  }
  return out
}

function backupJsonlFile(filePath: string, sessionsDir: string, backupDir: string): void {
  const destination = join(backupDir, 'sessions-jsonl', relative(sessionsDir, filePath))
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 })
  copyFileSync(filePath, destination)
}

function parseJsonLine(line: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(line) as unknown }
  } catch {
    return { ok: false }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function timestampForPath(): string {
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
}

function safePathPart(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_-]/g, '-')
}
