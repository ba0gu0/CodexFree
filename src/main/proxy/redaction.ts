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

  for (const [key, value] of headerEntries(headers)) {
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

function headerEntries(
  headers: HeaderMap
): Array<[string, string | string[] | number | undefined]> {
  if (!Array.isArray(headers)) {
    return Object.entries(headers)
  }

  const entries: Array<[string, string]> = []
  for (let index = 0; index + 1 < headers.length; index += 2) {
    entries.push([headers[index], headers[index + 1]])
  }
  return entries
}
