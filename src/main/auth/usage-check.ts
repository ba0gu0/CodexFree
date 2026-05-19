import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
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
  lastRefresh: string
  error?: string
}

const usageCheckConcurrency = 10

export interface AccountUsageCheckProgress {
  accountId?: string
  completed: number
  ok?: boolean
  total: number
}

export interface AccountUsageCheckOptions {
  accountIds?: string[]
  onProgress?: (progress: AccountUsageCheckProgress) => void
}

interface UsageResponse {
  account?: unknown
  email?: unknown
  plan_type?: unknown
  primary_used_percent?: unknown
  user?: unknown
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
      result = await checkAccountUsage(normalized, filePath)
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
  filePath: string
) {
  try {
    const response = await fetch('https://chatgpt.com/backend-api/wham/usage', {
      headers: {
        authorization: `Bearer ${normalized.codexAuth.tokens.access_token}`,
        'chatgpt-account-id': normalized.accountId,
        accept: 'application/json'
      }
    })
    const body = (await response.json().catch(() => undefined)) as UsageResponse | undefined
    if (!response.ok) {
      return toErrorResult(normalized, response.status, `usage check failed: ${response.status}`)
    }

    const email = emailFromUsageResponse(body) ?? normalized.email
    if (email && email !== normalized.email) {
      writeFileSync(filePath, `${JSON.stringify(toStoredAuth(normalized, email), null, 2)}\n`, {
        mode: 0o600
      })
    }

    return {
      accountId: normalized.accountId,
      email,
      label: normalized.label,
      ok: true,
      statusCode: response.status,
      planType: stringValue(body?.plan_type),
      primaryUsedPercent:
        stringValue(body?.primary_used_percent) ??
        stringValue(recordValue(recordValue(body?.rate_limit, 'primary_window'), 'used_percent')),
      secondaryUsedPercent:
        stringValue(body?.secondary_used_percent) ??
        stringValue(recordValue(recordValue(body?.rate_limit, 'secondary_window'), 'used_percent')),
      rateLimitResetsAt: resetTimeMillis(body),
      lastRefresh: normalized.lastRefresh
    }
  } catch (error) {
    return toErrorResult(
      normalized,
      undefined,
      error instanceof Error ? error.message : String(error)
    )
  }
}

function toErrorResult(
  normalized: ReturnType<typeof normalizeAuthFile>,
  statusCode: number | undefined,
  error: string
): AccountUsageCheckResult {
  return {
    accountId: normalized.accountId,
    email: normalized.email,
    label: normalized.label,
    ok: false,
    statusCode,
    lastRefresh: normalized.lastRefresh,
    error
  }
}

function emailFromUsageResponse(body: UsageResponse | undefined): string | undefined {
  return (
    stringValue(body?.email) ??
    stringValue(recordValue(body?.user, 'email')) ??
    stringValue(recordValue(body?.account, 'email'))
  )
}

function toStoredAuth(normalized: ReturnType<typeof normalizeAuthFile>, email: string): unknown {
  return {
    ...normalized.codexAuth,
    disabled: normalized.disabled,
    email
  }
}

function resetTimeMillis(body: UsageResponse | undefined): number | undefined {
  const primaryWindow = recordValue(body?.rate_limit, 'primary_window')
  const value =
    recordValue(primaryWindow, 'reset_at') ??
    body?.rate_limit_reset_at ??
    body?.primary_reset_at ??
    body?.resets_at
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
