import { randomBytes, randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { backupCodexFile, sourceCodexFilePath } from '../codex/backup-files'

export interface PlaceholderAuthResult {
  path: string
  backedUp: boolean
  backupPath: string | null
}

export function writePlaceholderAuthFile(homeDirectory = homedir()): PlaceholderAuthResult {
  const codexDirectory = join(homeDirectory, '.codex')
  const authPath = sourceCodexFilePath(codexDirectory, 'auth')
  mkdirSync(codexDirectory, { recursive: true, mode: 0o700 })

  const backupPath = backupCodexFile(codexDirectory, 'auth')
  const now = new Date().toISOString()
  const accountId = `placeholder-${randomUUID()}`
  const placeholder = {
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    tokens: {
      id_token: placeholderIdToken(accountId),
      access_token: `placeholder.${randomToken()}`,
      refresh_token: `placeholder.${randomToken()}`,
      account_id: accountId
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

function randomToken(): string {
  return randomBytes(32).toString('base64url')
}

function placeholderIdToken(accountId: string, issuedAt = new Date()): string {
  const issuedAtSeconds = Math.floor(issuedAt.getTime() / 1000)
  const payload = {
    aud: ['https://api.openai.com/v1'],
    exp: issuedAtSeconds + 10 * 365 * 24 * 60 * 60,
    iat: issuedAtSeconds,
    iss: 'https://auth.openai.com',
    jti: randomUUID(),
    nbf: issuedAtSeconds,
    sub: accountId,
    'https://api.openai.com/auth': {
      chatgpt_account_id: accountId,
      chatgpt_compute_residency: 'no_constraint',
      chatgpt_plan_type: 'free',
      chatgpt_user_id: accountId,
      localhost: true,
      user_id: accountId
    },
    'https://api.openai.com/profile': {
      email: 'placeholder@codexfree.local',
      email_verified: true
    }
  }

  return [
    encodeJwtPart({ alg: 'none', typ: 'JWT' }),
    encodeJwtPart(payload),
    `placeholder-${randomToken()}`
  ].join('.')
}

function encodeJwtPart(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}
