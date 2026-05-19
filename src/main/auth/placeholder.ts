import { randomBytes, randomUUID } from 'node:crypto'
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

export interface PlaceholderAuthResult {
  path: string
  backedUp: boolean
  backupPath: string | null
}

export interface CodexConfigWriteResult {
  backupPath: string | null
  path: string
}

export function writePlaceholderAuthFile(homeDirectory = homedir()): PlaceholderAuthResult {
  const codexDirectory = join(homeDirectory, '.codex')
  const authPath = join(codexDirectory, 'auth.json')
  mkdirSync(codexDirectory, { recursive: true, mode: 0o700 })

  const backupPath = backupExistingAuthFile(authPath)
  const now = new Date().toISOString()
  const placeholder = {
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    tokens: {
      id_token: `placeholder.${randomToken()}`,
      access_token: `placeholder.${randomToken()}`,
      refresh_token: `placeholder.${randomToken()}`,
      account_id: `placeholder-${randomUUID()}`
    },
    last_refresh: now
  }

  writeFileSync(authPath, `${JSON.stringify(placeholder, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  })
  chmodSync(authPath, 0o600)
  return { path: authPath, backedUp: backupPath !== null, backupPath }
}

export function writeCodexConfigFile(
  input: { chatgptBaseUrl: string; openaiBaseUrl: string; modelProvider?: string },
  homeDirectory = homedir()
): CodexConfigWriteResult {
  const codexDirectory = join(homeDirectory, '.codex')
  const configPath = join(codexDirectory, 'config.toml')
  mkdirSync(codexDirectory, { recursive: true, mode: 0o700 })

  const backupPath = backupExistingConfigFile(configPath)
  const existing = existsSync(configPath) ? readFileSync(configPath, 'utf8') : ''
  const next = upsertCodexBaseUrls(existing, input)
  writeFileSync(configPath, next, { encoding: 'utf8', mode: 0o600 })
  chmodSync(configPath, 0o600)
  return { backupPath, path: configPath }
}

function backupExistingAuthFile(authPath: string): string | null {
  if (!existsSync(authPath)) {
    return null
  }

  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  const backupPath = `${authPath}.codexfree-backup-${stamp}`
  copyFileSync(authPath, backupPath)
  chmodSync(backupPath, 0o600)
  return backupPath
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

function upsertCodexBaseUrls(
  content: string,
  input: { chatgptBaseUrl: string; openaiBaseUrl: string; modelProvider?: string }
): string {
  const modelProvider = input.modelProvider ?? 'openai'
  const assignments = new Map([
    ['chatgpt_base_url', `chatgpt_base_url = "${escapeTomlString(input.chatgptBaseUrl)}"`],
    ['openai_base_url', `openai_base_url = "${escapeTomlString(input.openaiBaseUrl)}"`],
    ['model_provider', `model_provider = "${escapeTomlString(modelProvider)}"`]
  ])
  const seen = new Set<string>()
  const lines = content.split(/\r?\n/).map((line) => {
    const match = line.match(/^\s*(chatgpt_base_url|openai_base_url|model_provider)\s*=/)
    if (!match) {
      return line
    }
    const key = match[1]
    seen.add(key)
    return assignments.get(key) ?? line
  })

  for (const [key, line] of assignments) {
    if (!seen.has(key)) {
      lines.push(line)
    }
  }

  return `${lines.join('\n').replace(/\n+$/, '')}\n`
}

function escapeTomlString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

function randomToken(): string {
  return randomBytes(32).toString('base64url')
}
