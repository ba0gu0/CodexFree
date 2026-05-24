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
  refreshable: boolean
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
  accountId?: string
  fileName?: string
  now?: Date
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
  refreshable?: unknown
  refresh_token?: unknown
  session_token?: unknown
  type?: unknown
}

export function normalizeAuthFile(
  input: unknown,
  options: NormalizeOptions = {}
): NormalizedAuthFile {
  const record = expectRecord(input)
  const flatRecord = record as FlatAuthRecord
  const format = detectFormat(record, options.fileName)
  const codexAuth = isNativeCodexAuth(record)
    ? normalizeNativeCodexAuth(record, options)
    : normalizeFlatAuthRecord(flatRecord, options)
  const email = stringOrUndefined(flatRecord.email) ?? emailFromJwtPayload(codexAuth)
  const disabled = Boolean(flatRecord.disabled)
  const expiresAt = stringOrUndefined(flatRecord.expired)
  const label = email ?? `${format}:${codexAuth.tokens.account_id}`
  const refreshable =
    typeof flatRecord.refreshable === 'boolean'
      ? flatRecord.refreshable
      : codexAuth.tokens.refresh_token.trim() !== ''

  return {
    format,
    label,
    accountId: codexAuth.tokens.account_id,
    email,
    disabled,
    expiresAt,
    lastRefresh: codexAuth.last_refresh,
    refreshable,
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

function normalizeNativeCodexAuth(
  record: Record<string, unknown>,
  options: NormalizeOptions
): CodexChatGptAuth {
  const tokens = expectRecord(record.tokens)

  return {
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    tokens: {
      id_token: optionalString(tokens.id_token),
      access_token: requiredString(tokens.access_token, 'tokens.access_token'),
      refresh_token: optionalString(tokens.refresh_token),
      account_id:
        stringOrUndefined(options.accountId) ??
        requiredString(tokens.account_id, 'tokens.account_id')
    },
    last_refresh: optionalString(record.last_refresh) || nowIso(options)
  }
}

function normalizeFlatAuthRecord(
  record: FlatAuthRecord,
  options: NormalizeOptions
): CodexChatGptAuth {
  return {
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    tokens: {
      id_token: optionalString(record.id_token),
      access_token: requiredString(record.access_token, 'access_token'),
      refresh_token: optionalString(record.refresh_token),
      account_id:
        stringOrUndefined(options.accountId) ?? requiredString(record.account_id, 'account_id')
    },
    last_refresh: optionalString(record.last_refresh) || nowIso(options)
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

function optionalString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function nowIso(options: NormalizeOptions): string {
  return (options.now ?? new Date()).toISOString()
}

function emailFromJwtPayload(auth: CodexChatGptAuth): string | undefined {
  return jwtEmail(auth.tokens.id_token) ?? jwtEmail(auth.tokens.access_token)
}

function jwtEmail(token: string): string | undefined {
  const [, payload] = token.split('.')
  if (!payload) {
    return undefined
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown
    const record = typeof parsed === 'object' && parsed !== null ? parsed : undefined
    if (!record || Array.isArray(record)) {
      return undefined
    }
    const direct = stringOrUndefined((record as Record<string, unknown>).email)
    const profile = (record as Record<string, unknown>)['https://api.openai.com/profile']
    return direct ?? stringOrUndefined(recordValue(profile, 'email'))
  } catch {
    return undefined
  }
}

function recordValue(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  return (value as Record<string, unknown>)[key]
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
