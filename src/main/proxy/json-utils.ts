import type { IncomingMessage } from 'node:http'

export class RequestBodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Request body exceeds ${maxBytes} bytes`)
    this.name = 'RequestBodyTooLargeError'
  }
}

export function parseJsonRecord(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown
    if (typeof parsed === 'string') {
      return parseJsonRecord(parsed)
    }
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

export function recordField(
  value: Record<string, unknown> | undefined,
  field: string
): Record<string, unknown> | undefined {
  const child = value?.[field]
  return isRecord(child) ? child : undefined
}

export function arrayField(
  value: Record<string, unknown> | undefined,
  field: string
): unknown[] | undefined {
  const child = value?.[field]
  return Array.isArray(child) ? child : undefined
}

export function stringField(
  value: Record<string, unknown> | undefined,
  field: string
): string | undefined {
  const child = value?.[field]
  if (typeof child === 'string') {
    return child
  }
  return typeof child === 'number' ? String(child) : undefined
}

export function numberField(
  value: Record<string, unknown> | undefined,
  field: string
): number | undefined {
  const child = value?.[field]
  if (typeof child === 'number' && Number.isFinite(child)) {
    return child
  }
  if (typeof child !== 'string') {
    return undefined
  }
  const numeric = Number(child)
  return Number.isFinite(numeric) ? numeric : undefined
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function truncateForLog(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > 50 ? `${normalized.slice(0, 50)}...` : normalized
}

export function safeJson(value: unknown): string {
  return JSON.stringify(value)
}

export function summarizeBuffer(buffer: Buffer): string | undefined {
  if (buffer.byteLength === 0) {
    return undefined
  }
  const text = buffer.toString('utf8')
  if (text.includes('\u0000')) {
    return `[binary:${buffer.byteLength}]`
  }
  return truncateForLog(text)
}

export function readRequestBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytes = 0
    let rejected = false
    request.on('data', (chunk: Buffer) => {
      if (rejected) {
        return
      }
      bytes += chunk.byteLength
      if (bytes > maxBytes) {
        rejected = true
        reject(new RequestBodyTooLargeError(maxBytes))
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (!rejected) {
        resolve(Buffer.concat(chunks))
      }
    })
    request.on('error', (error) => {
      if (!rejected) {
        reject(error)
      }
    })
  })
}
