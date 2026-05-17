import { randomBytes, randomUUID } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface PlaceholderAuthResult {
  path: string
  backedUp: boolean
  backupPath: string | null
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

function randomToken(): string {
  return randomBytes(32).toString('base64url')
}
