import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createRawCapture, readRawCaptureDetail } from './raw-capture'
import { createWebSocketFrameRecorder } from './websocket-capture'

describe('raw capture resilience', () => {
  it('recreates websocket capture directories if debug files are deleted while running', () => {
    const root = mkdtempSync(join(tmpdir(), 'codexfree-ws-capture-'))
    const directory = join(root, 'request-id')
    const recorder = createWebSocketFrameRecorder(directory, 'upstream-to-codex', 1024)

    expect(() => recorder?.observe(createServerTextFrame('{"ok":true}'))).not.toThrow()

    const frames = readFileSync(join(directory, 'websocket-upstream-to-codex.frames.jsonl'), 'utf8')
    expect(frames).toContain('"payloadText":"{\\"ok\\":true}"')
  })

  it('captures complete websocket payloads when max bytes is zero', () => {
    const root = mkdtempSync(join(tmpdir(), 'codexfree-ws-capture-'))
    const directory = join(root, 'request-id')
    const recorder = createWebSocketFrameRecorder(directory, 'codex-to-upstream', 0)
    const payload = JSON.stringify({ text: 'x'.repeat(2000) })

    expect(() => recorder?.observe(createClientTextFrame(payload))).not.toThrow()

    const frames = readFileSync(join(directory, 'websocket-codex-to-upstream.frames.jsonl'), 'utf8')
    const entry = JSON.parse(frames) as {
      capturedPayloadBytes: number
      decodedPayloadBytes: number
      payloadText: string
      truncated: boolean
    }
    expect(entry.truncated).toBe(false)
    expect(entry.capturedPayloadBytes).toBe(entry.decodedPayloadBytes)
    expect(entry.payloadText).toBe(payload)
  })

  it('captures complete http bodies when max bytes is zero', async () => {
    const root = mkdtempSync(join(tmpdir(), 'codexfree-http-capture-'))
    const capture = createRawCapture(root, 'request-id', true, 0)
    const body = Buffer.from('x'.repeat(2000))

    capture?.writeRequest('POST', '/backend-api/codex/responses', {}, body)

    const request = await readEventually(join(root, 'request-id', 'codex-inbound-request.http'))
    expect(request.endsWith('x'.repeat(2000))).toBe(true)
  })

  it('does not throw if capture directories are deleted before response writes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'codexfree-http-capture-'))
    const capture = createRawCapture(root, 'request-id', true, 1024)

    capture?.writeRequest('GET', '/backend-api/codex/responses', {}, Buffer.alloc(0))
    await readEventually(join(root, 'request-id', 'codex-inbound-request.http'))
    rmSync(join(root, 'request-id'), { recursive: true, force: true })

    expect(() => capture?.writeResponse(200, {}, Buffer.from('ok'))).not.toThrow()
    const response = await readEventually(
      join(root, 'request-id', 'chatgpt-upstream-response.http')
    )
    expect(response).toContain('HTTP/1.1 200 OK')
  })

  it('only reads raw capture details for UUID request ids', async () => {
    const root = mkdtempSync(join(tmpdir(), 'codexfree-http-capture-'))
    const requestId = '123e4567-e89b-42d3-a456-426614174000'
    const capture = createRawCapture(root, requestId, true, 1024)

    capture?.writeRequest('GET', '/backend-api/codex/responses', {}, Buffer.alloc(0))
    await readEventually(join(root, requestId, 'codex-inbound-request.http'))

    expect(readRawCaptureDetail(root, '../not-a-request')).toBeUndefined()
    expect(readRawCaptureDetail(root, 'request-id')).toBeUndefined()
    expect(readRawCaptureDetail(root, requestId)?.requestId).toBe(requestId)
  })
})

async function readEventually(path: string): Promise<string> {
  const deadline = Date.now() + 1000
  while (Date.now() < deadline) {
    try {
      const content = readFileSync(path, 'utf8')
      if (content.length > 0) {
        return content
      }
    } catch {
      // The capture writer is async; the file can be absent or briefly empty.
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return readFileSync(path, 'utf8')
}

function createServerTextFrame(text: string): Buffer {
  const payload = Buffer.from(text)
  return Buffer.concat([Buffer.from([0x81, payload.byteLength]), payload])
}

function createClientTextFrame(text: string): Buffer {
  const payload = Buffer.from(text)
  if (payload.byteLength > 0xffff) {
    throw new Error('Test client frame payload is too large')
  }
  const header =
    payload.byteLength < 126
      ? Buffer.from([0x81, 0x80 | payload.byteLength])
      : Buffer.from([0x81, 0x80 | 126, payload.byteLength >> 8, payload.byteLength & 0xff])
  const mask = Buffer.from([0x11, 0x22, 0x33, 0x44])
  const masked = Buffer.from(payload)
  for (let index = 0; index < masked.byteLength; index += 1) {
    masked[index] ^= mask[index % 4]
  }
  return Buffer.concat([header, mask, masked])
}
