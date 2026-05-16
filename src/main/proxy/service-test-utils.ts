import { writeFileSync } from 'node:fs'
import type http from 'node:http'
import net from 'node:net'
import { join } from 'node:path'
import type { ProxyConfig } from './types'

export function createConfig(upstream: http.Server): ProxyConfig {
  const address = upstream.address()
  if (typeof address !== 'object' || address === null) {
    throw new Error('Expected upstream server to listen on a TCP address')
  }

  return {
    listenHost: '127.0.0.1',
    listenPort: 0,
    upstreamBaseUrl: `http://127.0.0.1:${address.port}`,
    outboundProxy: {
      mode: 'direct',
      url: ''
    },
    authPool: {
      enabled: false,
      directory: ''
    },
    maxRequestBodyBytes: 10_485_760,
    rawCaptureEnabled: true,
    rawCaptureMaxBytes: 1024
  }
}

export function writeAuthFile(
  directory: string,
  fileName: string,
  accountId: string,
  token: string
): void {
  writeFileSync(
    join(directory, fileName),
    JSON.stringify({
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens: {
        id_token: `${token}-id`,
        access_token: token,
        refresh_token: `${token}-refresh`,
        account_id: accountId
      },
      last_refresh: '2026-05-14T00:00:00.000Z'
    })
  )
}

export function listen(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
}

export function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

export function rawHttpRequest(port: number, lines: string[]): Promise<string> {
  return rawHttpRequestBuffer(port, lines).then((buffer) => buffer.toString('utf8'))
}

export function rawHttpRequestBuffer(port: number, lines: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    const chunks: Buffer[] = []
    let settled = false
    const finish = () => {
      if (settled) {
        return
      }
      settled = true
      setTimeout(() => resolve(Buffer.concat(chunks)), 10)
    }
    socket.on('connect', () => socket.write(lines.join('\r\n')))
    socket.on('data', (chunk: Buffer) => chunks.push(chunk))
    socket.on('end', finish)
    socket.on('close', finish)
    socket.on('error', reject)
  })
}

export function rawHttpRequestBufferWithHead(
  port: number,
  lines: string[],
  head: Buffer
): Promise<Buffer> {
  return rawHttpRequestBufferWithPayload(port, lines, head)
}

function rawHttpRequestBufferWithPayload(
  port: number,
  lines: string[],
  payload: Buffer
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    const chunks: Buffer[] = []
    let settled = false
    const finish = () => {
      if (settled) {
        return
      }
      settled = true
      setTimeout(() => resolve(Buffer.concat(chunks)), 10)
    }
    socket.on('connect', () => {
      socket.write(Buffer.concat([Buffer.from(lines.join('\r\n')), payload]))
    })
    socket.on('data', (chunk: Buffer) => chunks.push(chunk))
    socket.on('end', finish)
    socket.on('close', finish)
    socket.on('error', reject)
  })
}

export function rawHttpRequestAndDestroyAfterMatch(
  port: number,
  lines: string[],
  match: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    const chunks: Buffer[] = []
    socket.on('connect', () => socket.write(lines.join('\r\n')))
    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
      if (Buffer.concat(chunks).toString('utf8').includes(match)) {
        socket.destroy()
        resolve()
      }
    })
    socket.on('error', reject)
  })
}

export function createServerTextFrame(text: string): Buffer {
  const payload = Buffer.from(text)
  if (payload.byteLength <= 125) {
    return Buffer.concat([Buffer.from([0x81, payload.byteLength]), payload])
  }
  if (payload.byteLength <= 0xffff) {
    const header = Buffer.alloc(4)
    header[0] = 0x81
    header[1] = 126
    header.writeUInt16BE(payload.byteLength, 2)
    return Buffer.concat([header, payload])
  }
  throw new Error('Test helper supports websocket payloads up to 65535 bytes')
}

export function createServerPingFrame(payloadText: string): Buffer {
  const payload = Buffer.from(payloadText)
  if (payload.byteLength > 125) {
    throw new Error('Test helper supports only small websocket payloads')
  }
  return Buffer.concat([Buffer.from([0x89, payload.byteLength]), payload])
}

export function createClientTextFrame(text: string): Buffer {
  const payload = Buffer.from(text)
  const mask = Buffer.from([0x11, 0x22, 0x33, 0x44])
  const header = Buffer.from([0x81, 0x80 | payload.byteLength])
  const maskedPayload = Buffer.from(payload)
  for (let index = 0; index < maskedPayload.byteLength; index += 1) {
    maskedPayload[index] ^= mask[index % mask.byteLength]
  }
  return Buffer.concat([header, mask, maskedPayload])
}
