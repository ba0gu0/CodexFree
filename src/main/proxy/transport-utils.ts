import http, { type IncomingMessage, STATUS_CODES } from 'node:http'
import type { Duplex } from 'node:stream'
import { parseQuotaExhaustionEvent, type QuotaExhaustionEvent } from './quota'
import type { CapturedWebSocketFrame } from './websocket-capture'

export interface ObserveUpstreamFrameOptions {
  flushProbe: () => void
  frame: CapturedWebSocketFrame
  onEarlyQuota: (event: QuotaExhaustionEvent) => boolean
  onQuotaExhausted: ((event: QuotaExhaustionEvent) => void) | undefined
}

export interface ResponseCreateFrameProbe {
  replayable: boolean
  rawFrame: Buffer
  reason: 'self_contained' | 'missing_payload' | 'previous_response_id' | 'empty_input'
}

export function observeUpstreamFrame(options: ObserveUpstreamFrameOptions): void {
  if (options.frame.direction !== 'upstream-to-codex') {
    return
  }
  if (options.frame.opcode !== 'text') {
    options.flushProbe()
    return
  }

  const quotaEvent = parseQuotaExhaustionEvent(options.frame.payloadText)
  if (quotaEvent) {
    if (options.onEarlyQuota(quotaEvent)) {
      return
    }
    options.onQuotaExhausted?.(quotaEvent)
  }
  options.flushProbe()
}

export function isResponseCreateFrame(frame: CapturedWebSocketFrame): boolean {
  return analyzeResponseCreateFrame(frame) !== undefined
}

export function analyzeResponseCreateFrame(
  frame: CapturedWebSocketFrame
): ResponseCreateFrameProbe | undefined {
  if (frame.direction !== 'codex-to-upstream' || frame.opcode !== 'text') {
    return undefined
  }
  if (!frame.payloadText || !frame.rawFrame) {
    return undefined
  }

  try {
    const payload: unknown = JSON.parse(frame.payloadText)
    const isResponseCreate =
      payload !== null &&
      typeof payload === 'object' &&
      !Array.isArray(payload) &&
      (payload as { type?: unknown }).type === 'response.create'
    if (!isResponseCreate) {
      return undefined
    }

    const record = payload as Record<string, unknown>
    if (typeof record.previous_response_id === 'string' && record.previous_response_id !== '') {
      return { rawFrame: frame.rawFrame, reason: 'previous_response_id', replayable: false }
    }
    if (!Array.isArray(record.input)) {
      return { rawFrame: frame.rawFrame, reason: 'missing_payload', replayable: false }
    }
    if (record.input.length === 0) {
      return { rawFrame: frame.rawFrame, reason: 'empty_input', replayable: false }
    }
    return { rawFrame: frame.rawFrame, reason: 'self_contained', replayable: true }
  } catch {
    return undefined
  }
}

export function parseQuotaEventFromWebSocketChunk(chunk: Buffer): QuotaExhaustionEvent | undefined {
  let offset = 0
  while (offset + 2 <= chunk.byteLength) {
    const firstByte = chunk[offset]
    const secondByte = chunk[offset + 1]
    const opcode = firstByte & 0x0f
    let payloadLength = secondByte & 0x7f
    let headerBytes = 2
    if (payloadLength === 126) {
      if (offset + 4 > chunk.byteLength) {
        return undefined
      }
      payloadLength = chunk.readUInt16BE(offset + 2)
      headerBytes = 4
    } else if (payloadLength === 127) {
      return undefined
    }
    const frameEnd = offset + headerBytes + payloadLength
    if (frameEnd > chunk.byteLength) {
      return undefined
    }
    if (opcode === 0x1) {
      const payload = chunk.subarray(offset + headerBytes, frameEnd).toString('utf8')
      const event = parseQuotaExhaustionEvent(payload)
      if (event) {
        return event
      }
    }
    offset = frameEnd
  }
  return undefined
}

export function formatUpgradeResponse(
  statusCode: number,
  headers: IncomingMessage['headers']
): string {
  const statusText = STATUS_CODES[statusCode] ?? 'Connection Established'
  const headerLines = Object.entries(headers).flatMap(([name, value]) => {
    if (Array.isArray(value)) {
      return value.map((item) => `${name}: ${item}`)
    }
    if (value === undefined) {
      return []
    }
    return [`${name}: ${value}`]
  })
  return [`HTTP/1.1 ${statusCode} ${statusText}`, ...headerLines, '', ''].join('\r\n')
}

export function formatHttpResponse(
  statusCode: number,
  headers: IncomingMessage['headers'],
  body: Buffer
): Buffer {
  const responseHeaders = {
    ...headers,
    'content-length': String(body.byteLength),
    connection: 'close'
  }
  return Buffer.concat([Buffer.from(formatUpgradeResponse(statusCode, responseHeaders)), body])
}

export function safeResponseWrite(response: http.ServerResponse, chunk: Buffer): boolean {
  if (response.destroyed || !response.writable) {
    return false
  }

  try {
    response.write(chunk, (error?: Error | null) => {
      if (error) {
        response.destroy(error)
      }
    })
    return true
  } catch {
    response.destroy()
    return false
  }
}

export function safeSocketWrite(socket: Duplex, chunk: Buffer | string): boolean {
  if (socket.destroyed || !socket.writable) {
    return false
  }

  try {
    socket.write(chunk, (error?: Error | null) => {
      if (error) {
        socket.destroy(error)
      }
    })
    return true
  } catch {
    socket.destroy()
    return false
  }
}

export function createServerTextFrame(payload: string): Buffer {
  const payloadBuffer = Buffer.from(payload)
  if (payloadBuffer.byteLength < 126) {
    return Buffer.concat([Buffer.from([0x81, payloadBuffer.byteLength]), payloadBuffer])
  }
  if (payloadBuffer.byteLength <= 0xffff) {
    const header = Buffer.alloc(4)
    header[0] = 0x81
    header[1] = 126
    header.writeUInt16BE(payloadBuffer.byteLength, 2)
    return Buffer.concat([header, payloadBuffer])
  }

  const header = Buffer.alloc(10)
  header[0] = 0x81
  header[1] = 127
  header.writeBigUInt64BE(BigInt(payloadBuffer.byteLength), 2)
  return Buffer.concat([header, payloadBuffer])
}

export function closeUpgradedSocket(socket: Duplex): void {
  if (socket.destroyed) {
    return
  }
  if (socket.writable) {
    safeSocketWrite(socket, Buffer.from([0x88, 0x00]))
    socket.end()
  }
  setTimeout(() => {
    if (!socket.destroyed) {
      socket.destroy()
    }
  }, 250).unref()
}
