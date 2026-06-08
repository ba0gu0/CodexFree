import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface CodexConfigWriteInput {
  chatgptBaseUrl: string
  openaiBaseUrl: string
}

export interface CodexTopLevelConfigSnapshot {
  capturedAt: number
  chatgptBaseUrl: string | null
  modelProvider: string | null
  openaiBaseUrl: string | null
  path: string
}

export interface CodexConfigWriteResult {
  backupPath: string | null
  changed: boolean
  path: string
  snapshot: CodexTopLevelConfigSnapshot | null
}

export interface CodexConfigRestoreResult {
  backupPath: string | null
  changed: boolean
  path: string
  snapshot: CodexTopLevelConfigSnapshot
}

export interface CodexSessionProviderTarget {
  configPath: string
  explicit: boolean
  provider: string
}

type ManagedTopLevelKey = 'chatgpt_base_url' | 'openai_base_url' | 'model_provider'

interface TopLevelAssignment {
  key: ManagedTopLevelKey
  value: string | null
}

export function writeCodexConfigFile(
  input: CodexConfigWriteInput,
  homeDirectory = homedir()
): CodexConfigWriteResult {
  const codexDirectory = join(homeDirectory, '.codex')
  const configPath = join(codexDirectory, 'config.toml')
  mkdirSync(codexDirectory, { recursive: true, mode: 0o700 })

  const existing = existsSync(configPath) ? readFileSync(configPath, 'utf8') : ''
  if (existing && codexConfigContentLooksCurrent(existing, input)) {
    return { backupPath: null, changed: false, path: configPath, snapshot: null }
  }
  const snapshot = snapshotTopLevelCodexConfig(configPath, existing)
  const next = upsertCodexProxyBaseUrls(existing, input)
  if (existing === next) {
    return { backupPath: null, changed: false, path: configPath, snapshot: null }
  }
  const backupPath = backupExistingConfigFile(configPath)
  writeFileSync(configPath, next, { encoding: 'utf8', mode: 0o600 })
  chmodSync(configPath, 0o600)
  return { backupPath, changed: true, path: configPath, snapshot }
}

export function restoreCodexConfigSnapshot(
  snapshot: CodexTopLevelConfigSnapshot,
  homeDirectory = homedir()
): CodexConfigRestoreResult {
  const codexDirectory = join(homeDirectory, '.codex')
  const configPath = join(codexDirectory, 'config.toml')
  mkdirSync(codexDirectory, { recursive: true, mode: 0o700 })

  const existing = existsSync(configPath) ? readFileSync(configPath, 'utf8') : ''
  const next = restoreTopLevelCodexConfig(existing, snapshot)
  if (existing === next) {
    return { backupPath: null, changed: false, path: configPath, snapshot }
  }
  const backupPath = backupExistingConfigFile(configPath)
  writeFileSync(configPath, next, { encoding: 'utf8', mode: 0o600 })
  chmodSync(configPath, 0o600)
  return { backupPath, changed: true, path: configPath, snapshot }
}

export function readCurrentCodexTopLevelConfig(
  homeDirectory = homedir()
): CodexTopLevelConfigSnapshot {
  const configPath = join(homeDirectory, '.codex', 'config.toml')
  const content = existsSync(configPath) ? readFileSync(configPath, 'utf8') : ''
  return snapshotTopLevelCodexConfig(configPath, content)
}

export function resolveCodexSessionProviderTarget(
  homeDirectory = homedir()
): CodexSessionProviderTarget {
  return resolveCodexSessionProviderTargetFromConfigPath(
    join(homeDirectory, '.codex', 'config.toml')
  )
}

export function resolveCodexSessionProviderTargetFromCodexHome(
  codexHomeDir: string
): CodexSessionProviderTarget {
  return resolveCodexSessionProviderTargetFromConfigPath(join(codexHomeDir, 'config.toml'))
}

function resolveCodexSessionProviderTargetFromConfigPath(
  configPath: string
): CodexSessionProviderTarget {
  if (!existsSync(configPath)) {
    throw new Error(`Codex config not found: ${configPath}`)
  }
  const content = readFileSync(configPath, 'utf8')
  const modelProvider = topLevelValue(content, 'model_provider')
  return {
    configPath,
    explicit: modelProvider !== null,
    provider: modelProvider ?? 'openai'
  }
}

export function codexConfigContentLooksCurrent(
  content: string,
  input: CodexConfigWriteInput
): boolean {
  return (
    topLevelValue(content, 'chatgpt_base_url') === input.chatgptBaseUrl &&
    topLevelValue(content, 'openai_base_url') === input.openaiBaseUrl &&
    topLevelValue(content, 'model_provider') === null
  )
}

function upsertCodexProxyBaseUrls(content: string, input: CodexConfigWriteInput): string {
  return rewriteTopLevelManagedConfig(content, [
    `chatgpt_base_url = "${escapeTomlString(input.chatgptBaseUrl)}"`,
    `openai_base_url = "${escapeTomlString(input.openaiBaseUrl)}"`
  ])
}

function restoreTopLevelCodexConfig(
  content: string,
  snapshot: CodexTopLevelConfigSnapshot
): string {
  const assignments = [
    snapshot.modelProvider === null
      ? null
      : `model_provider = "${escapeTomlString(snapshot.modelProvider)}"`,
    snapshot.chatgptBaseUrl === null
      ? null
      : `chatgpt_base_url = "${escapeTomlString(snapshot.chatgptBaseUrl)}"`,
    snapshot.openaiBaseUrl === null
      ? null
      : `openai_base_url = "${escapeTomlString(snapshot.openaiBaseUrl)}"`
  ].filter((line): line is string => line !== null)
  return rewriteTopLevelManagedConfig(content, assignments)
}

function rewriteTopLevelManagedConfig(content: string, assignments: string[]): string {
  const preserved: string[] = []
  let table: string | null = null
  for (const line of content.split(/\r?\n/)) {
    const tableMatch = /^\s*\[([^\]]+)\]\s*$/.exec(line)
    if (tableMatch) {
      table = tableMatch[1] ?? null
      preserved.push(line)
      continue
    }
    if (table === null && topLevelManagedAssignment(line)) {
      continue
    }
    preserved.push(line)
  }

  const preservedBody = preserved.join('\n').replace(/^\n+|\n+$/g, '')
  const header = assignments.join('\n')
  const body = header && preservedBody ? `${header}\n\n${preservedBody}` : header || preservedBody
  return `${body}\n`
}

function snapshotTopLevelCodexConfig(
  configPath: string,
  content: string
): CodexTopLevelConfigSnapshot {
  return {
    capturedAt: Date.now(),
    chatgptBaseUrl: topLevelValue(content, 'chatgpt_base_url'),
    modelProvider: topLevelValue(content, 'model_provider'),
    openaiBaseUrl: topLevelValue(content, 'openai_base_url'),
    path: configPath
  }
}

function topLevelValue(content: string, key: ManagedTopLevelKey): string | null {
  const assignment = topLevelAssignments(content).find((item) => item.key === key)
  return assignment?.value ?? null
}

function topLevelAssignments(content: string): TopLevelAssignment[] {
  const assignments: TopLevelAssignment[] = []
  let table: string | null = null
  for (const line of content.split(/\r?\n/)) {
    const tableMatch = /^\s*\[([^\]]+)\]\s*$/.exec(line)
    if (tableMatch) {
      table = tableMatch[1] ?? null
      continue
    }
    if (table !== null) {
      continue
    }
    const assignmentMatch =
      /^\s*(chatgpt_base_url|openai_base_url|model_provider)\s*=\s*(.+?)\s*$/.exec(line)
    if (!assignmentMatch) {
      continue
    }
    assignments.push({
      key: assignmentMatch[1] as ManagedTopLevelKey,
      value: parseTomlString(assignmentMatch[2] ?? '')
    })
  }
  return assignments
}

function topLevelManagedAssignment(line: string): boolean {
  return /^\s*(chatgpt_base_url|openai_base_url|model_provider)\s*=/.test(line)
}

function backupExistingConfigFile(configPath: string): string | null {
  if (!existsSync(configPath)) {
    return null
  }

  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  const backupPath = `${configPath}.codexfree-backup-${stamp}`
  copyFileSync(configPath, backupPath)
  chmodSync(backupPath, 0o600)
  return backupPath
}

function parseTomlString(value: string): string | null {
  const trimmed = value.trim()
  const match = /^["'](.*)["']$/.exec(trimmed)
  if (!match) {
    return null
  }
  return match[1]?.replaceAll('\\"', '"').replaceAll('\\\\', '\\') ?? null
}

function escapeTomlString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}
