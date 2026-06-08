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
  upstreamAccountId: string
  email?: string
  planType?: string
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
  account_type?: unknown
  client_id?: unknown
  disabled?: unknown
  email?: unknown
  expired?: unknown
  id_token?: unknown
  last_refresh?: unknown
  plan?: unknown
  plan_type?: unknown
  planType?: unknown
  refreshable?: unknown
  refresh_token?: unknown
  session_token?: unknown
  storage?: unknown
  token_data?: unknown
  tokens?: unknown
  type?: unknown
}

export function normalizeAuthFile(
  input: unknown,
  options: NormalizeOptions = {}
): NormalizedAuthFile {
  const record = expectRecord(input)
  const flatRecord = flattenFlatAuthRecord(record)
  const format = detectFormat(flatRecord, options.fileName)
  const codexAuth = isNativeCodexAuth(record)
    ? normalizeNativeCodexAuth(record, options)
    : normalizeFlatAuthRecord(flatRecord, options)
  const email = stringOrUndefined(flatRecord.email) ?? emailFromJwtPayload(codexAuth)
  const planType =
    stringOrUndefined(flatRecord.plan_type) ??
    stringOrUndefined(flatRecord.planType) ??
    stringOrUndefined(flatRecord.plan) ??
    stringOrUndefined(flatRecord.account_type) ??
    planTypeFromJwtPayload(codexAuth)
  const disabled = Boolean(flatRecord.disabled)
  const expiresAt = stringOrUndefined(flatRecord.expired)
  const accountId = localAccountId(codexAuth, email, planType)
  const label = email ?? `${format}:${codexAuth.tokens.account_id}`
  const refreshable =
    typeof flatRecord.refreshable === 'boolean'
      ? flatRecord.refreshable
      : codexAuth.tokens.refresh_token.trim() !== ''

  return {
    format,
    label,
    accountId,
    upstreamAccountId: codexAuth.tokens.account_id,
    email,
    planType,
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

function flattenFlatAuthRecord(record: Record<string, unknown>): FlatAuthRecord {
  const tokenData = recordValue(record.token_data)
  const storage = recordValue(record.storage)
  const tokens = recordValue(record.tokens)
  const metadata = recordValue(record.metadata)
  return {
    access_token: firstValue(record.access_token, tokenData?.access_token, storage?.access_token),
    account_id: firstValue(
      record.account_id,
      record.chatgpt_account_id,
      tokenData?.account_id,
      tokenData?.chatgpt_account_id,
      storage?.account_id,
      metadata?.account_id
    ),
    account_type: firstValue(record.account_type, tokenData?.account_type, metadata?.account_type),
    client_id: firstValue(record.client_id, tokenData?.client_id),
    disabled: firstValue(record.disabled, metadata?.disabled),
    email: firstValue(record.email, tokenData?.email, storage?.email, metadata?.email),
    expired: firstValue(record.expired, tokenData?.expired, storage?.expired),
    id_token: firstValue(record.id_token, tokenData?.id_token, storage?.id_token, tokens?.id_token),
    last_refresh: firstValue(record.last_refresh, tokenData?.last_refresh, storage?.last_refresh),
    plan: firstValue(record.plan, tokenData?.plan, metadata?.plan),
    plan_type: firstValue(
      record.plan_type,
      record.planType,
      record.chatgpt_plan_type,
      record.account_type,
      tokenData?.plan_type,
      tokenData?.chatgpt_plan_type,
      storage?.plan_type,
      metadata?.plan_type
    ),
    planType: firstValue(record.planType, tokenData?.planType, metadata?.planType),
    refreshable: firstValue(record.refreshable, metadata?.refreshable),
    refresh_token: firstValue(
      record.refresh_token,
      tokenData?.refresh_token,
      storage?.refresh_token
    ),
    session_token: firstValue(record.session_token, tokenData?.session_token),
    storage: record.storage,
    token_data: record.token_data,
    tokens: record.tokens,
    type: firstValue(record.type, metadata?.type)
  }
}

function firstValue(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined)
}

function detectFormat(record: FlatAuthRecord, fileName?: string): AuthFileFormat {
  const declared = stringOrUndefined(record.type)?.toLowerCase()
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
        stringOrUndefined(tokens.account_id) ??
        accountIdFromTokenValues(tokens.id_token, tokens.access_token) ??
        requiredString(undefined, 'tokens.account_id')
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
        stringOrUndefined(options.accountId) ??
        stringOrUndefined(record.account_id) ??
        accountIdFromTokenValues(record.id_token, record.access_token) ??
        requiredString(undefined, 'account_id')
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
  const record = jwtPayloadRecord(token)
  if (!record) {
    return undefined
  }
  const direct = stringOrUndefined(record.email)
  const profile = record['https://api.openai.com/profile']
  return direct ?? stringOrUndefined(recordValue(profile, 'email'))
}

function planTypeFromJwtPayload(auth: CodexChatGptAuth): string | undefined {
  return (
    jwtAuthString(auth.tokens.id_token, 'chatgpt_plan_type') ??
    jwtAuthString(auth.tokens.access_token, 'chatgpt_plan_type')
  )
}

function localAccountId(
  auth: CodexChatGptAuth,
  email: string | undefined,
  planType: string | undefined
): string {
  const upstreamAccountId = auth.tokens.account_id
  if (!usesPerUserLocalIdentity(planType)) {
    return upstreamAccountId
  }
  const identity = accountIdentityFromJwtPayload(auth) ?? email
  if (!identity) {
    return upstreamAccountId
  }
  const identityHash = createHash('sha256')
    .update(upstreamAccountId)
    .update('\0')
    .update(identity)
    .digest('hex')
    .slice(0, 12)
  return `${upstreamAccountId}:user:${identityHash}`
}

function usesPerUserLocalIdentity(planType: string | undefined): boolean {
  const normalized = planType?.trim().toLowerCase()
  return normalized === 'team' || normalized === 'pro'
}

function accountIdentityFromJwtPayload(auth: CodexChatGptAuth): string | undefined {
  return (
    jwtAuthString(auth.tokens.id_token, 'chatgpt_user_id') ??
    jwtAuthString(auth.tokens.id_token, 'user_id') ??
    jwtString(auth.tokens.id_token, 'sub') ??
    jwtAuthString(auth.tokens.access_token, 'chatgpt_user_id') ??
    jwtAuthString(auth.tokens.access_token, 'user_id') ??
    jwtString(auth.tokens.access_token, 'sub')
  )
}

function accountIdFromTokenValues(...tokens: unknown[]): string | undefined {
  for (const token of tokens) {
    if (typeof token !== 'string' || token.trim() === '') {
      continue
    }
    const accountId = jwtAuthString(token, 'chatgpt_account_id')
    if (accountId) {
      return accountId
    }
  }
  return undefined
}

function jwtAuthString(token: string, key: string): string | undefined {
  const record = jwtPayloadRecord(token)
  if (!record) {
    return undefined
  }
  const auth = record['https://api.openai.com/auth']
  return stringOrUndefined(recordValue(auth, key))
}

function jwtString(token: string, key: string): string | undefined {
  return stringOrUndefined(jwtPayloadRecord(token)?.[key])
}

function jwtPayloadRecord(token: string): Record<string, unknown> | undefined {
  const [, payload] = token.split('.')
  if (!payload) {
    return undefined
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return undefined
    }
    return parsed as Record<string, unknown>
  } catch {
    return undefined
  }
}

function recordValue(value: unknown): Record<string, unknown> | undefined
function recordValue(value: unknown, key: string): unknown
function recordValue(value: unknown, key?: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  const record = value as Record<string, unknown>
  return key === undefined ? record : record[key]
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
