export interface QuotaExhaustionEvent {
  errorType: 'usage_limit_reached'
  statusCode: number
  planType?: string
  activeLimit?: string
  primaryUsedPercent?: string
  resetsAt?: string
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
