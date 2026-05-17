import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { forwardHttpRequest } from './transport-http'

const servers: http.Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => closeServer(server)))
})

describe('HTTP transport forwarding', () => {
  it('streams chunked SSE-like responses even when deferred retry inspection is enabled', async () => {
    const upstream = http.createServer((_request, response) => {
      response.writeHead(200, { 'transfer-encoding': 'chunked' })
      response.write('event: response.created\ndata: {}\n\n')
      setTimeout(() => {
        response.end('event: response.completed\ndata: {}\n\n')
      }, 200)
    })
    const upstreamPort = await listen(upstream)

    const proxy = http.createServer(async (request, response) => {
      await forwardHttpRequest(
        {
          hostname: '127.0.0.1',
          method: request.method,
          path: '/',
          port: upstreamPort,
          protocol: 'http:'
        },
        Buffer.from('request'),
        response,
        undefined,
        1024,
        true
      )
    })
    const proxyPort = await listen(proxy)

    const startedAt = Date.now()
    const result = await fetch(`http://127.0.0.1:${proxyPort}/`, { method: 'POST' })
    const reader = result.body?.getReader()
    if (!reader) {
      throw new Error('Expected a readable response body from fetch')
    }
    const first = await reader.read()
    const firstChunkMs = Date.now() - startedAt

    expect(first.done).toBe(false)
    expect(first.value ? new TextDecoder().decode(first.value) : '').toContain(
      'event: response.created'
    )
    expect(firstChunkMs).toBeLessThan(180)
  })
})

function listen(server: http.Server): Promise<number> {
  servers.push(server)
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port)
    })
  })
}

function closeServer(server: http.Server): Promise<void> {
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
