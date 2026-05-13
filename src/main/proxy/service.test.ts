import http from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProxyLedger } from './ledger'
import { TransparentProxyService } from './service'
import type { ProxyConfig, RequestLedgerEntry } from './types'

const log = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
}

describe('transparent proxy service', () => {
  const services: TransparentProxyService[] = []
  const upstreams: http.Server[] = []

  afterEach(async () => {
    await Promise.all(services.map((service) => service.stop()))
    await Promise.all(upstreams.map((server) => closeServer(server)))
    services.length = 0
    upstreams.length = 0
  })

  it('forwards request bodies and records a redacted ledger entry', async () => {
    const upstream = http.createServer((request, response) => {
      let body = ''
      request.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8')
      })
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ path: request.url, body }))
      })
    })
    await listen(upstream)
    upstreams.push(upstream)

    const entries: RequestLedgerEntry[] = []
    const ledger = {
      insert: (entry: RequestLedgerEntry) => entries.unshift(entry),
      recent: () => []
    } as unknown as ProxyLedger
    const service = new TransparentProxyService(createConfig(upstream), ledger, log)
    services.push(service)
    const status = await service.start()
    const response = await fetch(`${status.endpoint}/chat/completions?probe=1`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret-account-token',
        cookie: 'session=secret-cookie',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ ok: true })
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      path: '/chat/completions?probe=1',
      body: '{"ok":true}'
    })

    const [entry] = entries
    expect(entry.method).toBe('POST')
    expect(entry.statusCode).toBe(200)
    expect(entry.outcome).toBe('forwarded')
    expect(entry.rawCapturePath).toBeTypeOf('string')
  })
})

function createConfig(upstream: http.Server): ProxyConfig {
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
    rawCaptureEnabled: true,
    rawCaptureMaxBytes: 1024
  }
}

function listen(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
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
