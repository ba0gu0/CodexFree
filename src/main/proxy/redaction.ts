import { createHash, randomUUID } from 'node:crypto'
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http'

type HeaderMap = IncomingHttpHeaders | OutgoingHttpHeaders | readonly string[]

export function createRequestId(): string {
  return randomUUID()
}

export function fingerprint(value: string | undefined): string | undefined {
  if (!value) {
    return undefined
  }

  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

export function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0]
  }

  return value
}

export function redactHeaders(headers: HeaderMap): Record<string, string | string[] | number> {
  const redacted: Record<string, string | string[] | number> = {}

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue
    }

    const lowerKey = key.toLowerCase()
    if (['authorization', 'cookie', 'set-cookie'].includes(lowerKey)) {
      const headerValue = Array.isArray(value) ? value.join(';') : String(value)
      redacted[key] = `[redacted:${fingerprint(headerValue) ?? 'empty'}]`
      continue
    }

    redacted[key] = value
  }

  return redacted
}

export function classifyRequest(headers: IncomingHttpHeaders): 'account' | 'api_key' | 'unknown' {
  const authorization = firstHeaderValue(headers.authorization)
  if (!authorization) {
    return 'unknown'
  }

  return authorization.toLowerCase().startsWith('bearer sk-') ? 'api_key' : 'account'
}
