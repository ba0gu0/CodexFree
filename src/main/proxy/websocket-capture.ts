import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { constants, createInflateRaw } from 'node:zlib'

export type WebSocketFrameDirection = 'codex-to-upstream' | 'upstream-to-codex'

export interface WebSocketFrameRecorder {
  observe(chunk: Buffer): void
}

export interface CapturedWebSocketFrame {
  decodeError?: string
  direction: WebSocketFrameDirection
  opcode: string
  opcodeValue: number
  payloadBytes?: number
  rawFrame?: Buffer
  payloadText?: string
  truncated?: boolean
}

export interface WebSocketFrameRecorderOptions {
  onFrame?: (frame: CapturedWebSocketFrame) => void
}

interface ParsedFrame {
  fin: boolean
  rsv1: boolean
  opcode: number
  masked: boolean
  payload: Buffer
  rawFrame: Buffer
  frameBytes: number
}

export function createWebSocketFrameRecorder(
  directory: string | undefined,
  direction: WebSocketFrameDirection,
  maxPayloadBytes: number,
  options: WebSocketFrameRecorderOptions = {}
): WebSocketFrameRecorder {
  const path = directory ? join(directory, `websocket-${direction}.frames.jsonl`) : undefined
  let pending = Buffer.alloc(0)
  let activeCompressedChunks: Buffer[] = []
  let activeCompressedFrame: ParsedFrame | undefined
  let compressedInflateFailed = false
  let inflating = false
  const compressedQueue: ParsedFrame[] = []
  const inflater = createInflateRaw()

  inflater.on('data', (chunk: Buffer) => {
    activeCompressedChunks.push(Buffer.from(chunk))
  })

  inflater.on('error', (error: Error) => {
    compressedInflateFailed = true
    if (activeCompressedFrame) {
      appendFrame(path, direction, activeCompressedFrame, maxPayloadBytes, options, {
        decodedPayload: activeCompressedFrame.payload,
        decodeError: error.message
      })
    }
    activeCompressedFrame = undefined
    activeCompressedChunks = []
    inflating = false
    flushCompressedQueueAsRaw()
  })

  const flushCompressedQueueAsRaw = () => {
    while (compressedQueue.length > 0) {
      const queued = compressedQueue.shift()
      if (queued) {
        appendFrame(path, direction, queued, maxPayloadBytes, options, {
          decodedPayload: queued.payload,
          decodeError: 'permessage-deflate inflater is unavailable'
        })
      }
    }
  }

  const drainCompressedQueue = () => {
    if (inflating || compressedInflateFailed) {
      if (compressedInflateFailed) {
        flushCompressedQueueAsRaw()
      }
      return
    }

    const frame = compressedQueue.shift()
    if (!frame) {
      return
    }

    inflating = true
    activeCompressedFrame = frame
    activeCompressedChunks = []

    try {
      inflater.write(frame.payload)
      inflater.write(Buffer.from([0x00, 0x00, 0xff, 0xff]))
      inflater.flush(constants.Z_SYNC_FLUSH, () => {
        const decodedPayload = Buffer.concat(activeCompressedChunks)
        appendFrame(path, direction, frame, maxPayloadBytes, options, { decodedPayload })
        activeCompressedFrame = undefined
        activeCompressedChunks = []
        inflating = false
        drainCompressedQueue()
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      appendFrame(path, direction, frame, maxPayloadBytes, options, {
        decodedPayload: frame.payload,
        decodeError: message
      })
      activeCompressedFrame = undefined
      activeCompressedChunks = []
      inflating = false
      drainCompressedQueue()
    }
  }

  const observeFrame = (frame: ParsedFrame) => {
    if (frame.rsv1 && frame.payload.byteLength > 0) {
      compressedQueue.push(frame)
      drainCompressedQueue()
      return
    }
    appendFrame(path, direction, frame, maxPayloadBytes, options, { decodedPayload: frame.payload })
  }

  return {
    observe(chunk) {
      pending = Buffer.concat([pending, chunk])
      while (true) {
        const parsed = parseFrame(pending)
        if (!parsed) {
          return
        }
        pending = pending.subarray(parsed.frameBytes)
        observeFrame(parsed)
      }
    }
  }
}

function parseFrame(buffer: Buffer): ParsedFrame | undefined {
  if (buffer.byteLength < 2) {
    return undefined
  }

  const firstByte = buffer[0]
  const secondByte = buffer[1]
  const masked = (secondByte & 0x80) !== 0
  let payloadLength = secondByte & 0x7f
  let offset = 2

  if (payloadLength === 126) {
    if (buffer.byteLength < offset + 2) {
      return undefined
    }
    payloadLength = buffer.readUInt16BE(offset)
    offset += 2
  } else if (payloadLength === 127) {
    if (buffer.byteLength < offset + 8) {
      return undefined
    }
    const length64 = buffer.readBigUInt64BE(offset)
    if (length64 > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('WebSocket frame payload is too large to capture safely')
    }
    payloadLength = Number(length64)
    offset += 8
  }

  const maskOffset = offset
  if (masked) {
    offset += 4
  }

  const frameBytes = offset + payloadLength
  if (buffer.byteLength < frameBytes) {
    return undefined
  }

  const payload = Buffer.from(buffer.subarray(offset, frameBytes))
  const rawFrame = Buffer.from(buffer.subarray(0, frameBytes))
  if (masked) {
    const mask = buffer.subarray(maskOffset, maskOffset + 4)
    for (let index = 0; index < payload.byteLength; index += 1) {
      payload[index] ^= mask[index % 4]
    }
  }

  return {
    fin: (firstByte & 0x80) !== 0,
    rsv1: (firstByte & 0x40) !== 0,
    opcode: firstByte & 0x0f,
    masked,
    payload,
    rawFrame,
    frameBytes
  }
}

function appendFrame(
  path: string | undefined,
  direction: WebSocketFrameDirection,
  frame: ParsedFrame,
  maxPayloadBytes: number,
  options: WebSocketFrameRecorderOptions,
  payload: {
    decodedPayload: Buffer
    decodeError?: string
  }
): void {
  const decoded = payload.decodedPayload
  const sample = maxPayloadBytes === 0 ? decoded : decoded.subarray(0, maxPayloadBytes)
  const payloadText = utf8OrUndefined(sample)
  const entry = {
    capturedAt: new Date().toISOString(),
    direction,
    fin: frame.fin,
    compressed: frame.rsv1,
    opcode: opcodeName(frame.opcode),
    opcodeValue: frame.opcode,
    masked: frame.masked,
    payloadBytes: frame.payload.byteLength,
    decodedPayloadBytes: decoded.byteLength,
    capturedPayloadBytes: sample.byteLength,
    truncated: decoded.byteLength > sample.byteLength,
    decodeError: payload.decodeError,
    payloadText,
    payloadBase64: payloadText === undefined ? sample.toString('base64') : undefined
  }
  try {
    options.onFrame?.({
      decodeError: payload.decodeError,
      direction,
      opcode: entry.opcode,
      opcodeValue: entry.opcodeValue,
      payloadBytes: entry.payloadBytes,
      rawFrame: frame.rawFrame,
      payloadText,
      truncated: entry.truncated
    })
  } catch {
    // Quota observers must not break WebSocket forwarding.
  }
  if (!path) {
    return
  }
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    appendFileSync(path, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
  } catch {
    // Raw capture is a debug aid; capture write failures must not break proxying.
  }
}

function utf8OrUndefined(buffer: Buffer): string | undefined {
  const text = buffer.toString('utf8')
  return text.includes('\u0000') ? undefined : text
}

function opcodeName(opcode: number): string {
  switch (opcode) {
    case 0x0:
      return 'continuation'
    case 0x1:
      return 'text'
    case 0x2:
      return 'binary'
    case 0x8:
      return 'close'
    case 0x9:
      return 'ping'
    case 0x0a:
      return 'pong'
    default:
      return 'unknown'
  }
}
