import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs'
import { basename, join } from 'node:path'

export type CodexBackupKind = 'auth' | 'config'

export interface CodexFileRestoreResult {
  backupFileName: string | null
  path: string
  replaced: boolean
  restoredFileName: string
}

const backupSpecs: Record<CodexBackupKind, { fileName: string; suffix: string }> = {
  auth: { fileName: 'auth.json', suffix: 'codexfree-auth.json' },
  config: { fileName: 'config.toml', suffix: 'codexfree-config.toml' }
}

export function sourceCodexFilePath(codexDir: string, kind: CodexBackupKind): string {
  return join(codexDir, backupSpecs[kind].fileName)
}

export function nextCodexBackupFileName(
  codexDir: string,
  kind: CodexBackupKind,
  date = new Date()
): string {
  for (let offsetSeconds = 0; offsetSeconds < 60; offsetSeconds += 1) {
    const fileName = codexBackupFileName(kind, new Date(date.getTime() + offsetSeconds * 1000))
    if (!existsSync(join(codexDir, fileName))) {
      return fileName
    }
  }
  throw new Error(`Cannot create CodexFree ${kind} backup name because recent names are occupied`)
}

export function listCodexBackupFileNames(codexDir: string, kind: CodexBackupKind): string[] {
  if (!existsSync(codexDir)) {
    return []
  }
  const pattern = codexBackupPattern(kind)
  return readdirSync(codexDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left))
}

export function backupCodexFile(codexDir: string, kind: CodexBackupKind): string | null {
  const sourcePath = sourceCodexFilePath(codexDir, kind)
  if (!existsSync(sourcePath)) {
    return null
  }
  mkdirSync(codexDir, { recursive: true, mode: 0o700 })
  const backupPath = join(codexDir, nextCodexBackupFileName(codexDir, kind))
  copyFileSync(sourcePath, backupPath)
  chmodSync(backupPath, 0o600)
  return backupPath
}

export function renameCodexFileToBackup(codexDir: string, kind: CodexBackupKind): string {
  const sourcePath = sourceCodexFilePath(codexDir, kind)
  if (!existsSync(sourcePath)) {
    throw new Error(`Cannot rename Codex ${kind} file because "${sourcePath}" does not exist`)
  }
  mkdirSync(codexDir, { recursive: true, mode: 0o700 })
  const backupPath = join(codexDir, nextCodexBackupFileName(codexDir, kind))
  renameSync(sourcePath, backupPath)
  chmodSync(backupPath, 0o600)
  return backupPath
}

export function restoreCodexFileBackup(
  codexDir: string,
  kind: CodexBackupKind,
  backupFileName: string
): CodexFileRestoreResult {
  const backups = listCodexBackupFileNames(codexDir, kind)
  if (!backups.includes(backupFileName)) {
    throw new Error(`Cannot restore Codex ${kind} backup because "${backupFileName}" is not known`)
  }

  const sourcePath = sourceCodexFilePath(codexDir, kind)
  const backupPath = join(codexDir, backupFileName)
  const replaced = existsSync(sourcePath)
  const currentBackupPath = replaced ? backupCodexFile(codexDir, kind) : null
  copyFileSync(backupPath, sourcePath)
  chmodSync(sourcePath, 0o600)

  return {
    backupFileName: currentBackupPath ? basename(currentBackupPath) : null,
    path: sourcePath,
    replaced,
    restoredFileName: backupFileName
  }
}

export function codexBackupFileName(kind: CodexBackupKind, date: Date): string {
  const stamp = date.toISOString().replaceAll('-', '').replaceAll(':', '').slice(0, 15)
  return `${stamp}-${backupSpecs[kind].suffix}`
}

function codexBackupPattern(kind: CodexBackupKind): RegExp {
  return new RegExp(`^\\d{8}T\\d{6}-${escapeRegExp(backupSpecs[kind].suffix)}$`)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
