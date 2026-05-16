import { mkdtempSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProxyLedger } from './ledger'
import { TransparentProxyService } from './service'
import { closeServer, createConfig, listen, writeAuthFile } from './service-test-utils'
import type { RequestLedgerEntry } from './types'

const log = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
}

describe('transparent proxy service http handling', () => {
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
    const response = await fetch(`${status.openaiBaseUrl}/models?probe=1`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret-account-token',
        'chatgpt-account-id': 'account-id',
        cookie: 'session=secret-cookie',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ ok: true })
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      path: '/backend-api/codex/models?probe=1',
      body: '{"ok":true}'
    })

    const [entry] = entries
    expect(entry.method).toBe('POST')
    expect(entry.statusCode).toBe(200)
    expect(entry.outcome).toBe('forwarded')
    expect(entry.rawCapturePath).toBeTypeOf('string')
  })

  it('rejects oversized proxy request bodies before forwarding upstream', async () => {
    let upstreamHits = 0
    const upstream = http.createServer((_request, response) => {
      upstreamHits += 1
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true }))
    })
    await listen(upstream)
    upstreams.push(upstream)

    const entries: RequestLedgerEntry[] = []
    const ledger = {
      insert: (entry: RequestLedgerEntry) => entries.unshift(entry),
      recent: () => []
    } as unknown as ProxyLedger
    const config = { ...createConfig(upstream), maxRequestBodyBytes: 8 }
    const service = new TransparentProxyService(config, ledger, log)
    services.push(service)
    const status = await service.start()
    const response = await fetch(`${status.openaiBaseUrl}/models`, {
      body: '0123456789',
      method: 'POST'
    })

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({ error: 'request_body_too_large' })
    expect(upstreamHits).toBe(0)
    expect(entries[0]).toMatchObject({
      outcome: 'rejected',
      statusCode: 413,
      upstreamHost: 'not-forwarded'
    })
  })

  it('rewrites codex models responses with plus speed tiers', async () => {
    let upstreamPath = ''
    const upstream = http.createServer((request, response) => {
      upstreamPath = request.url ?? ''
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          models: [
            {
              slug: 'gpt-5.5',
              service_tiers: [],
              additional_speed_tiers: []
            },
            {
              slug: 'gpt-5.4',
              service_tiers: [],
              additional_speed_tiers: []
            },
            {
              slug: 'gpt-5.4-mini',
              service_tiers: [],
              additional_speed_tiers: []
            }
          ]
        })
      )
    })
    await listen(upstream)
    upstreams.push(upstream)

    const ledger = {
      insert: () => undefined,
      recent: () => []
    } as unknown as ProxyLedger
    const service = new TransparentProxyService(createConfig(upstream), ledger, log)
    services.push(service)
    const status = await service.start()
    const response = await fetch(`${status.openaiBaseUrl}/models?client_version=0.130.0`, {
      headers: {
        authorization: 'Bearer placeholder-token',
        'chatgpt-account-id': 'account-id'
      }
    })

    expect(response.status).toBe(200)
    expect(upstreamPath).toBe('/backend-api/codex/models?client_version=0.130.0')
    await expect(response.json()).resolves.toEqual({
      models: [
        {
          slug: 'gpt-5.5',
          service_tiers: [
            {
              id: 'priority',
              name: 'Fast',
              description: '1.5x speed, increased usage'
            }
          ],
          additional_speed_tiers: ['fast']
        },
        {
          slug: 'gpt-5.4',
          service_tiers: [
            {
              id: 'priority',
              name: 'Fast',
              description: '1.5x speed, increased usage'
            }
          ],
          additional_speed_tiers: ['fast']
        },
        {
          slug: 'gpt-5.4-mini',
          service_tiers: [],
          additional_speed_tiers: []
        }
      ]
    })
  })

  it('rejects API-key mode requests without forwarding upstream', async () => {
    let upstreamHits = 0
    const upstream = http.createServer((_request, response) => {
      upstreamHits += 1
      response.writeHead(200)
      response.end()
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
    const response = await fetch(`${status.openaiCompatibleEndpoint}/responses`, {
      headers: {
        authorization: 'Bearer sk-test',
        'chatgpt-account-id': 'account-id'
      }
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'api_key_mode_not_supported' })
    expect(upstreamHits).toBe(0)
    expect(entries[0]).toMatchObject({
      mode: 'api_key',
      outcome: 'rejected',
      statusCode: 403,
      upstreamHost: 'not-forwarded'
    })
  })

  it('rejects unknown paths without forwarding upstream', async () => {
    let upstreamHits = 0
    const upstream = http.createServer((_request, response) => {
      upstreamHits += 1
      response.writeHead(200)
      response.end()
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
    const response = await fetch(`${status.openaiCompatibleEndpoint}/chat/completions`, {
      headers: {
        authorization: 'Bearer account-token',
        'chatgpt-account-id': 'account-id'
      }
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'unknown_account_backend_path' })
    expect(upstreamHits).toBe(0)
    expect(entries[0]).toMatchObject({
      mode: 'account',
      outcome: 'rejected',
      statusCode: 404,
      upstreamHost: 'not-forwarded'
    })
  })

  it('passes through new backend-api paths with managed auth but no account rules', async () => {
    const authDirectory = mkdtempSync(join(tmpdir(), 'codexfree-auth-pool-'))
    writeAuthFile(authDirectory, 'a.json', 'account-a', 'managed-a')
    writeAuthFile(authDirectory, 'b.json', 'account-b', 'managed-b')
    const forwardedAccounts: string[] = []
    const upstream = http.createServer((request, response) => {
      forwardedAccounts.push(String(request.headers['chatgpt-account-id']))
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ detail: 'Not Found' }))
    })
    await listen(upstream)
    upstreams.push(upstream)

    const entries: RequestLedgerEntry[] = []
    const disabledAccounts: string[] = []
    const ledger = {
      activeAccountId: () => undefined,
      disabledAccountIds: () => disabledAccounts,
      exhaustedAccountIds: () => [],
      insert: (entry: RequestLedgerEntry) => entries.unshift(entry),
      recordRoutingEvent: () => undefined,
      recent: () => [],
      setAccountDisabled: (accountId: string) => {
        disabledAccounts.push(accountId)
        return 1
      },
      setActiveAccount: () => 1,
      syncAccountPool: () => undefined
    } as unknown as ProxyLedger
    const service = new TransparentProxyService(
      { ...createConfig(upstream), authPool: { enabled: true, directory: authDirectory } },
      ledger,
      log
    )
    services.push(service)
    const status = await service.start()
    const response = await fetch(`${status.endpoint}/new/codex/path?probe=1`, {
      headers: {
        authorization: 'Bearer placeholder-token',
        'chatgpt-account-id': 'placeholder-account'
      }
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ detail: 'Not Found' })
    expect(forwardedAccounts).toEqual(['account-a'])
    expect(disabledAccounts).toEqual([])
    expect(entries[0]).toMatchObject({
      accountId: 'account-a',
      mode: 'account_passthrough',
      path: '/backend-api/new/codex/path?probe=1',
      statusCode: 401
    })
  })

  it('preserves original auth for wham remote paths', async () => {
    const authDirectory = mkdtempSync(join(tmpdir(), 'codexfree-auth-pool-'))
    writeAuthFile(authDirectory, 'a.json', 'account-a', 'managed-a')
    let forwardedAccount = ''
    let forwardedAuthorization = ''
    const upstream = http.createServer((request, response) => {
      forwardedAccount = String(request.headers['chatgpt-account-id'])
      forwardedAuthorization = String(request.headers.authorization)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true }))
    })
    await listen(upstream)
    upstreams.push(upstream)

    const entries: RequestLedgerEntry[] = []
    const ledger = {
      activeAccountId: () => undefined,
      disabledAccountIds: () => [],
      exhaustedAccountIds: () => [],
      insert: (entry: RequestLedgerEntry) => entries.unshift(entry),
      recent: () => [],
      setActiveAccount: () => 1,
      syncAccountPool: () => undefined
    } as unknown as ProxyLedger
    const service = new TransparentProxyService(
      { ...createConfig(upstream), authPool: { enabled: true, directory: authDirectory } },
      ledger,
      log
    )
    services.push(service)
    const status = await service.start()
    const response = await fetch(`${status.endpoint}/wham/remote/session?probe=1`, {
      headers: {
        authorization: 'Bearer placeholder-token',
        'chatgpt-account-id': 'placeholder-account'
      }
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(forwardedAccount).toBe('placeholder-account')
    expect(forwardedAuthorization).toBe('Bearer placeholder-token')
    expect(entries[0]).toMatchObject({
      accountId: 'placeholder-account',
      mode: 'account_passthrough',
      path: '/backend-api/wham/remote/session?probe=1',
      statusCode: 200
    })
  })

  it('passes compact responses through with managed auth', async () => {
    const authDirectory = mkdtempSync(join(tmpdir(), 'codexfree-auth-'))
    writeAuthFile(authDirectory, 'account-a.auth.json', 'account-a', 'token-a')
    let forwardedAccount: string | undefined
    let forwardedBody = ''
    const upstream = http.createServer((request, response) => {
      forwardedAccount = String(request.headers['chatgpt-account-id'])
      request.on('data', (chunk: Buffer) => {
        forwardedBody += chunk.toString('utf8')
      })
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ output: [{ type: 'message', content: 'compact-ok' }] }))
      })
    })
    await listen(upstream)
    upstreams.push(upstream)

    const entries: RequestLedgerEntry[] = []
    const ledger = {
      activeAccountId: () => undefined,
      disabledAccountIds: () => [],
      exhaustedAccountIds: () => [],
      insert: (entry: RequestLedgerEntry) => entries.unshift(entry),
      recordRoutingEvent: () => undefined,
      recent: () => [],
      setActiveAccount: () => 1,
      syncAccountPool: () => undefined
    } as unknown as ProxyLedger
    const service = new TransparentProxyService(
      { ...createConfig(upstream), authPool: { enabled: true, directory: authDirectory } },
      ledger,
      log
    )
    services.push(service)
    const status = await service.start()
    const response = await fetch(`${status.endpoint}/codex/responses/compact`, {
      body: JSON.stringify({ model: 'gpt-5.5', input: [] }),
      headers: {
        authorization: 'Bearer placeholder-token',
        'chatgpt-account-id': 'placeholder-account',
        'content-type': 'application/json'
      },
      method: 'POST'
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      output: [{ type: 'message', content: 'compact-ok' }]
    })
    expect(forwardedAccount).toBe('account-a')
    expect(JSON.parse(forwardedBody)).toEqual({ model: 'gpt-5.5', input: [] })
    expect(entries[0]).toMatchObject({
      accountId: 'account-a',
      mode: 'account',
      path: '/backend-api/codex/responses/compact',
      statusCode: 200
    })
  })

  it('shows 0.0.0.0 in local endpoints when listening on all interfaces', async () => {
    const upstream = http.createServer((_request, response) => {
      response.writeHead(200)
      response.end()
    })
    await listen(upstream)
    upstreams.push(upstream)

    const ledger = {
      insert: () => undefined,
      recent: () => []
    } as unknown as ProxyLedger
    const service = new TransparentProxyService(
      { ...createConfig(upstream), listenHost: '0.0.0.0' },
      ledger,
      log
    )
    services.push(service)

    const status = await service.start()

    expect(status.endpoint).toContain('http://0.0.0.0:')
    expect(status.openaiBaseUrl).toContain('http://0.0.0.0:')
  })
})
