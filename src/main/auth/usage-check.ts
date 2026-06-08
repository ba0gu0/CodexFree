import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import http, { type RequestOptions } from 'node:http'
import https from 'node:https'
import { join } from 'node:path'
import { normalizeAuthFile } from './normalize'

export interface AccountUsageCheckResult {
  accountId: string
  email?: string
  label: string
  ok: boolean
  statusCode?: number
  planType?: string
  primaryUsedPercent?: string
  secondaryUsedPercent?: string
  rateLimitResetsAt?: number
  secondaryRateLimitResetsAt?: number
  lastRefresh: string
  error?: string
}

const usageCheckConcurrency = 10
const defaultUsageRequestTimeoutMs = 5_000

export interface AccountUsageCheckProgress {
  accountId?: string
  completed: number
  ok?: boolean
  total: number
}

export interface AccountUsageCheckOptions {
  accountIds?: string[]
  onProgress?: (progress: AccountUsageCheckProgress) => void
  timeoutMs?: number
  usageUrl?: string
}

export interface AccountUsageRequestInput {
  accountId?: string
  agent?: RequestOptions['agent']
  authorization: string
  email?: string
  label: string
  lastRefresh?: string
  timeoutMs?: number
  usageUrl?: string
}

interface UsageResponse {
  account?: unknown
  account_id?: unknown
  email?: unknown
  plan_type?: unknown
  primary_used_percent?: unknown
  user?: unknown
  user_id?: unknown
  secondary_used_percent?: unknown
  rate_limit?: unknown
  resets_at?: unknown
  primary_reset_at?: unknown
  rate_limit_reset_at?: unknown
}

export async function checkAuthDirectoryUsage(
  directory: string,
  options: AccountUsageCheckOptions = {}
): Promise<AccountUsageCheckResult[]> {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const accountIdSet =
    options.accountIds && options.accountIds.length > 0 ? new Set(options.accountIds) : null
  const files = readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => join(directory, name))
    .filter((filePath) => statSync(filePath).isFile())
    .filter((filePath) => {
      if (!accountIdSet) {
        return true
      }
      try {
        const normalized = normalizeAuthFile(
          JSON.parse(readFileSync(filePath, 'utf8')) as unknown,
          {
            fileName: filePath
          }
        )
        return accountIdSet.has(normalized.accountId)
      } catch {
        return false
      }
    })

  let completed = 0
  return mapWithConcurrency(files, usageCheckConcurrency, async (filePath) => {
    let result: AccountUsageCheckResult
    try {
      const normalized = normalizeAuthFile(JSON.parse(readFileSync(filePath, 'utf8')) as unknown, {
        fileName: filePath
      })
      result = await checkAccountUsage(normalized, filePath, options.usageUrl, options.timeoutMs)
    } catch (error) {
      result = {
        accountId: filePath,
        label: filePath,
        ok: false,
        lastRefresh: '',
        error: error instanceof Error ? error.message : String(error)
      }
    }
    completed += 1
    options.onProgress?.({
      accountId: result.accountId,
      completed,
      ok: result.ok,
      total: files.length
    })
    return result
  })
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await worker(items[index])
    }
  })
  await Promise.allSettled(workers)
  return results
}

async function checkAccountUsage(
  normalized: ReturnType<typeof normalizeAuthFile>,
  filePath: string,
  usageUrl: string | undefined,
  timeoutMs: number | undefined
) {
  const result = await checkAccountUsageByAuthorization({
    accountId: normalized.accountId,
    authorization: `Bearer ${normalized.codexAuth.tokens.access_token}`,
    email: normalized.email,
    label: normalized.label,
    lastRefresh: normalized.lastRefresh,
    timeoutMs,
    usageUrl
  })
  if (result.ok) {
    const email = result.email ?? normalized.email
    if (email && email !== normalized.email) {
      writeFileSync(filePath, `${JSON.stringify(toStoredAuth(normalized, email), null, 2)}\n`, {
        mode: 0o600
      })
    }
    return { ...result, email }
  }
  return result
}

export async function checkAccountUsageByAuthorization(
  input: AccountUsageRequestInput
): Promise<AccountUsageCheckResult> {
  try {
    const response = await fetchUsage(input)
    const body = response.body
    const accountId = input.accountId ?? accountIdFromUsageResponse(body)
    if (response.statusCode < 200 || response.statusCode >= 300) {
      return {
        accountId: accountId ?? '',
        email: input.email,
        error: `usage check failed: ${response.statusCode}`,
        label: input.label,
        lastRefresh: input.lastRefresh ?? '',
        ok: false,
        statusCode: response.statusCode
      }
    }
    if (!accountId) {
      return {
        accountId: '',
        email: input.email,
        error: 'usage check did not return an account id',
        label: input.label,
        lastRefresh: input.lastRefresh ?? '',
        ok: false,
        statusCode: response.statusCode
      }
    }

    return {
      accountId,
      email: emailFromUsageResponse(body) ?? input.email,
      label: input.label,
      ok: true,
      statusCode: response.statusCode,
      planType: stringValue(body?.plan_type),
      primaryUsedPercent:
        stringValue(body?.primary_used_percent) ??
        stringValue(recordValue(recordValue(body?.rate_limit, 'primary_window'), 'used_percent')),
      secondaryUsedPercent:
        stringValue(body?.secondary_used_percent) ??
        stringValue(recordValue(recordValue(body?.rate_limit, 'secondary_window'), 'used_percent')),
      rateLimitResetsAt: resetTimeMillis(body, 'primary_window'),
      secondaryRateLimitResetsAt: resetTimeMillis(body, 'secondary_window'),
      lastRefresh: input.lastRefresh ?? ''
    }
  } catch (error) {
    return {
      accountId: input.accountId ?? '',
      email: input.email,
      error: error instanceof Error ? error.message : String(error),
      label: input.label,
      lastRefresh: input.lastRefresh ?? '',
      ok: false
    }
  }
}

async function fetchUsage(
  input: AccountUsageRequestInput
): Promise<{ body: UsageResponse | undefined; statusCode: number }> {
  return new Promise((resolve, reject) => {
    const usageUrl = new URL(input.usageUrl ?? 'https://chatgpt.com/backend-api/wham/usage')
    const client = usageUrl.protocol === 'http:' ? http : https
    const timeoutMs = normalizeUsageTimeoutMs(input.timeoutMs)
    const headers: Record<string, string> = {
      accept: 'application/json',
      authorization: input.authorization
    }
    if (input.accountId) {
      headers['chatgpt-account-id'] = input.accountId
    }
    let timeout: ReturnType<typeof setTimeout> | undefined
    const clearUsageTimeout = (): void => {
      if (timeout) {
        clearTimeout(timeout)
        timeout = undefined
      }
    }
    const request = client.request(
      usageUrl,
      {
        agent: input.agent,
        headers,
        method: 'GET'
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
        response.on('end', () => {
          clearUsageTimeout()
          const text = Buffer.concat(chunks).toString('utf8')
          const body = parseUsageBody(text)
          resolve({ body, statusCode: response.statusCode ?? 0 })
        })
      }
    )
    let timeoutError: UsageCheckTimeoutError | undefined
    timeout = setTimeout(() => {
      timeoutError = new UsageCheckTimeoutError(timeoutMs)
      request.destroy(timeoutError)
    }, timeoutMs)
    timeout.unref()
    request.on('error', (error) => {
      clearUsageTimeout()
      reject(timeoutError ?? error)
    })
    request.on('close', clearUsageTimeout)
    request.end()
  })
}

class UsageCheckTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`usage check timeout after ${timeoutMs}ms`)
    this.name = 'UsageCheckTimeoutError'
  }
}

function normalizeUsageTimeoutMs(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs)) {
    return defaultUsageRequestTimeoutMs
  }
  return Math.max(1, Math.min(defaultUsageRequestTimeoutMs, Math.floor(timeoutMs)))
}

function parseUsageBody(text: string): UsageResponse | undefined {
  try {
    return JSON.parse(text) as UsageResponse
  } catch {
    return undefined
  }
}

function emailFromUsageResponse(body: UsageResponse | undefined): string | undefined {
  return (
    stringValue(body?.email) ??
    stringValue(recordValue(body?.user, 'email')) ??
    stringValue(recordValue(body?.account, 'email'))
  )
}

function accountIdFromUsageResponse(body: UsageResponse | undefined): string | undefined {
  return (
    stringValue(body?.account_id) ??
    stringValue(body?.user_id) ??
    stringValue(recordValue(body?.account, 'id')) ??
    stringValue(recordValue(body?.user, 'id'))
  )
}

function toStoredAuth(normalized: ReturnType<typeof normalizeAuthFile>, email: string): unknown {
  return {
    ...normalized.codexAuth,
    disabled: normalized.disabled,
    email,
    refreshable: normalized.refreshable
  }
}

function resetTimeMillis(
  body: UsageResponse | undefined,
  windowKey: 'primary_window' | 'secondary_window'
): number | undefined {
  const window = recordValue(body?.rate_limit, windowKey)
  const value =
    recordValue(window, 'reset_at') ??
    (windowKey === 'primary_window'
      ? (body?.rate_limit_reset_at ?? body?.primary_reset_at ?? body?.resets_at)
      : undefined)
  if (typeof value === 'number') {
    return value > 10_000_000_000 ? value : value * 1000
  }
  if (typeof value !== 'string') {
    return undefined
  }

  const numeric = Number.parseInt(value, 10)
  if (!Number.isFinite(numeric)) {
    return undefined
  }
  return numeric > 10_000_000_000 ? numeric : numeric * 1000
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number') {
    return String(value)
  }
  return undefined
}

function recordValue(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  return (value as Record<string, unknown>)[key]
}
