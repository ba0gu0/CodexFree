export interface QuotaExhaustionEvent {
  errorType: 'usage_limit_reached'
  statusCode: number
  planType?: string
  activeLimit?: string
  primaryUsedPercent?: string
  resetsAt?: string
}

export interface QuotaLimitPayloadInput {
  activeLimit?: string
  planType?: string | null
  primaryUsedPercent?: string | null
  resetsAt?: number | null
}

interface QuotaPayload {
  type?: unknown
  status_code?: unknown
  error?: {
    type?: unknown
  }
  headers?: Record<string, unknown>
}

export function parseQuotaExhaustionEvent(
  payloadText: string | undefined
): QuotaExhaustionEvent | undefined {
  if (!payloadText) {
    return undefined
  }

  const payload = parseJsonObject(payloadText)
  if (!payload) {
    return undefined
  }

  const quotaPayload = payload as QuotaPayload
  if (quotaPayload.error?.type !== 'usage_limit_reached') {
    return undefined
  }

  const headers = quotaPayload.headers
  return {
    errorType: 'usage_limit_reached',
    statusCode: numberOrDefault(quotaPayload.status_code, 429),
    planType: stringValue(headers?.['X-Codex-Plan-Type']),
    activeLimit: stringValue(headers?.['X-Codex-Active-Limit']),
    primaryUsedPercent: stringValue(headers?.['X-Codex-Primary-Used-Percent']),
    resetsAt: stringValue(headers?.['X-Codex-Primary-Reset-At'])
  }
}

export function formatQuotaLedgerMessage(event: QuotaExhaustionEvent): string {
  const details = [
    `status=${event.statusCode}`,
    event.planType ? `plan=${event.planType}` : undefined,
    event.activeLimit ? `limit=${event.activeLimit}` : undefined,
    event.primaryUsedPercent ? `used=${event.primaryUsedPercent}` : undefined,
    event.resetsAt ? `reset=${event.resetsAt}` : undefined
  ].filter((item): item is string => item !== undefined)

  return `usage_limit_reached ${details.join(' ')}`
}

export function buildUsageLimitReachedPayload(
  input: QuotaLimitPayloadInput = {}
): Record<string, unknown> {
  const resetSeconds = input.resetsAt ? Math.floor(input.resetsAt / 1000) : undefined
  const nowSeconds = Math.floor(Date.now() / 1000)
  const resetsInSeconds =
    resetSeconds === undefined ? undefined : Math.max(resetSeconds - nowSeconds, 0)
  const planType = input.planType ?? 'free'
  const primaryUsedPercent = input.primaryUsedPercent ?? '100'
  const activeLimit = input.activeLimit ?? 'premium'
  return {
    type: 'error',
    error: {
      type: 'usage_limit_reached',
      message: 'The usage limit has been reached',
      plan_type: planType,
      resets_at: resetSeconds,
      eligible_promo: null,
      resets_in_seconds: resetsInSeconds
    },
    status_code: 429,
    headers: {
      'X-Codex-Active-Limit': activeLimit,
      'X-Codex-Plan-Type': planType,
      'X-Codex-Primary-Used-Percent': primaryUsedPercent,
      'X-Codex-Secondary-Used-Percent': '0',
      'X-Codex-Primary-Window-Minutes': '10080',
      'X-Codex-Primary-Over-Secondary-Limit-Percent': '0',
      'X-Codex-Secondary-Window-Minutes': '0',
      'X-Codex-Primary-Reset-After-Seconds':
        resetsInSeconds === undefined ? '0' : String(resetsInSeconds),
      'X-Codex-Secondary-Reset-After-Seconds': '0',
      'X-Codex-Primary-Reset-At': resetSeconds === undefined ? '' : String(resetSeconds),
      'X-Codex-Secondary-Reset-At': '',
      'X-Codex-Credits-Has-Credits': 'False',
      'X-Codex-Credits-Balance': '',
      'X-Codex-Credits-Unlimited': 'False'
    }
  }
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text)
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
    return undefined
  } catch {
    return undefined
  }
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
