import { createHash } from 'node:crypto'

export type AuthFileFormat = 'codex' | 'cpa' | 'sub2api'

export interface CodexChatGptAuth {
  auth_mode: 'chatgpt'
  OPENAI_API_KEY: null
  tokens: {
    id_token: string
    access_token: string
    refresh_token: string
    account_id: string
  }
  last_refresh: string
}

export interface NormalizedAuthFile {
  format: AuthFileFormat
  label: string
  accountId: string
  email?: string
  disabled: boolean
  expiresAt?: string
  lastRefresh: string
  fingerprint: string
  codexAuth: CodexChatGptAuth
  warnings: string[]
}

export class AuthNormalizationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthNormalizationError'
  }
}

interface NormalizeOptions {
  fileName?: string
}

interface FlatAuthRecord {
  access_token?: unknown
  account_id?: unknown
  client_id?: unknown
  disabled?: unknown
  email?: unknown
  expired?: unknown
  id_token?: unknown
  last_refresh?: unknown
  refresh_token?: unknown
  session_token?: unknown
  type?: unknown
}

export function normalizeAuthFile(
  input: unknown,
  options: NormalizeOptions = {}
): NormalizedAuthFile {
  const record = expectRecord(input)
  const format = detectFormat(record, options.fileName)
  const codexAuth = isNativeCodexAuth(record)
    ? normalizeNativeCodexAuth(record)
    : normalizeFlatAuthRecord(record as FlatAuthRecord)
  const email = stringOrUndefined((record as FlatAuthRecord).email)
  const disabled = Boolean((record as FlatAuthRecord).disabled)
  const expiresAt = stringOrUndefined((record as FlatAuthRecord).expired)
  const label = email ?? `${format}:${codexAuth.tokens.account_id}`

  return {
    format,
    label,
    accountId: codexAuth.tokens.account_id,
    email,
    disabled,
    expiresAt,
    lastRefresh: codexAuth.last_refresh,
    fingerprint: authFingerprint(codexAuth),
    codexAuth,
    warnings:
      format === 'sub2api' ? ['sub2api shape is accepted only when it matches Codex tokens'] : []
  }
}

function expectRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new AuthNormalizationError('Auth file must be a JSON object')
  }

  return input as Record<string, unknown>
}

function detectFormat(record: Record<string, unknown>, fileName?: string): AuthFileFormat {
  const declared = stringOrUndefined((record as FlatAuthRecord).type)?.toLowerCase()
  if (declared === 'cpa' || declared === 'sub2api' || declared === 'codex') {
    return declared
  }

  const lowerName = fileName?.toLowerCase() ?? ''
  if (lowerName.includes('sub2api')) {
    return 'sub2api'
  }
  if (lowerName.includes('cpa')) {
    return 'cpa'
  }

  return 'codex'
}

function isNativeCodexAuth(record: Record<string, unknown>): boolean {
  return (
    record.auth_mode === 'chatgpt' && typeof record.tokens === 'object' && record.tokens !== null
  )
}

function normalizeNativeCodexAuth(record: Record<string, unknown>): CodexChatGptAuth {
  const tokens = expectRecord(record.tokens)

  return {
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    tokens: {
      id_token: requiredString(tokens.id_token, 'tokens.id_token'),
      access_token: requiredString(tokens.access_token, 'tokens.access_token'),
      refresh_token: requiredString(tokens.refresh_token, 'tokens.refresh_token'),
      account_id: requiredString(tokens.account_id, 'tokens.account_id')
    },
    last_refresh: requiredString(record.last_refresh, 'last_refresh')
  }
}

function normalizeFlatAuthRecord(record: FlatAuthRecord): CodexChatGptAuth {
  return {
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    tokens: {
      id_token: requiredString(record.id_token, 'id_token'),
      access_token: requiredString(record.access_token, 'access_token'),
      refresh_token: requiredString(record.refresh_token, 'refresh_token'),
      account_id: requiredString(record.account_id, 'account_id')
    },
    last_refresh: requiredString(record.last_refresh, 'last_refresh')
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AuthNormalizationError(`Auth file is missing required field: ${field}`)
  }

  return value
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function authFingerprint(auth: CodexChatGptAuth): string {
  return createHash('sha256')
    .update(auth.tokens.account_id)
    .update('\0')
    .update(auth.tokens.access_token)
    .update('\0')
    .update(auth.tokens.refresh_token)
    .digest('hex')
    .slice(0, 16)
}
