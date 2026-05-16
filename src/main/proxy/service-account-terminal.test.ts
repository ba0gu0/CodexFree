import { mkdtempSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProxyLedger } from './ledger'
import { TransparentProxyService } from './service'
import {
  closeServer,
  createConfig,
  createServerTextFrame,
  listen,
  rawHttpRequest,
  writeAuthFile
} from './service-test-utils'
import type { RequestLedgerEntry } from './types'

const log = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
}

describe('transparent proxy terminal account routing states', () => {
  const services: TransparentProxyService[] = []
  const upstreams: http.Server[] = []

  afterEach(async () => {
    await Promise.all(services.map((service) => service.stop()))
    await Promise.all(upstreams.map((server) => closeServer(server)))
    services.length = 0
    upstreams.length = 0
  })

  it('records a terminal http quota response as quota_exhausted', async () => {
    const authDirectory = mkdtempSync(join(tmpdir(), 'codexfree-auth-pool-'))
    writeAuthFile(authDirectory, 'a.json', 'account-a', 'managed-a')
    const exhaustedAccounts: string[] = []
    const upstream = http.createServer((request, response) => {
      expect(request.headers['chatgpt-account-id']).toBe('account-a')
      response.writeHead(429, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          type: 'error',
          status_code: 429,
          error: { type: 'usage_limit_reached' }
        })
      )
    })
    await listen(upstream)
    upstreams.push(upstream)

    const entries: RequestLedgerEntry[] = []
    const ledger = {
      accountUsageSummary: () => undefined,
      activeAccountId: () => undefined,
      disabledAccountIds: () => [],
      exhaustedAccountIds: () => exhaustedAccounts,
      insert: (entry: RequestLedgerEntry) => entries.unshift(entry),
      markAccountQuotaExhausted: (accountId: string | undefined) => {
        if (accountId) {
          exhaustedAccounts.push(accountId)
        }
      },
      markQuotaExhausted: () => undefined,
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
    const endpoint = new URL((await service.start()).endpoint)

    const response = await fetch(`${endpoint.origin}/backend-api/codex/responses`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer placeholder-token',
        'chatgpt-account-id': 'placeholder-account',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ model: 'gpt-5.5', input: 'hi' })
    })

    expect(response.status).toBe(429)
    expect(exhaustedAccounts).toEqual(['account-a'])
    expect(entries[0]).toMatchObject({
      accountId: 'account-a',
      outcome: 'quota_exhausted',
      path: '/backend-api/codex/responses',
      statusCode: 429
    })
    expect(entries[0]?.errorMessage).toContain('usage_limit_reached')
  })

  it('keeps retrying http quota responses until a usable account succeeds', async () => {
    const authDirectory = mkdtempSync(join(tmpdir(), 'codexfree-auth-pool-'))
    writeAuthFile(authDirectory, 'a.json', 'account-a', 'managed-a')
    writeAuthFile(authDirectory, 'b.json', 'account-b', 'managed-b')
    writeAuthFile(authDirectory, 'c.json', 'account-c', 'managed-c')
    const forwardedAccounts: string[] = []
    const exhaustedAccounts: string[] = []
    const upstream = http.createServer((request, response) => {
      const forwardedAccount = String(request.headers['chatgpt-account-id'])
      forwardedAccounts.push(forwardedAccount)
      if (forwardedAccount !== 'account-c') {
        response.writeHead(429, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            type: 'error',
            status_code: 429,
            error: { type: 'usage_limit_reached' }
          })
        )
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true }))
    })
    await listen(upstream)
    upstreams.push(upstream)

    const entries: RequestLedgerEntry[] = []
    const ledger = {
      accountUsageSummary: () => undefined,
      activeAccountId: () => undefined,
      disabledAccountIds: () => [],
      exhaustedAccountIds: () => exhaustedAccounts,
      insert: (entry: RequestLedgerEntry) => entries.unshift(entry),
      markAccountQuotaExhausted: (accountId: string | undefined) => {
        if (accountId) {
          exhaustedAccounts.push(accountId)
        }
      },
      markQuotaExhausted: () => undefined,
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
    const endpoint = new URL((await service.start()).endpoint)

    const response = await fetch(`${endpoint.origin}/backend-api/codex/responses`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer placeholder-token',
        'chatgpt-account-id': 'placeholder-account',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ model: 'gpt-5.5', input: 'hi' })
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(forwardedAccounts).toEqual(['account-a', 'account-b', 'account-c'])
    expect(exhaustedAccounts).toEqual(['account-a', 'account-b'])
    expect(entries[0]).toMatchObject({
      accountId: 'account-c',
      outcome: 'forwarded',
      statusCode: 200
    })
  })

  it('rejects managed http requests locally when no account is available', async () => {
    const authDirectory = mkdtempSync(join(tmpdir(), 'codexfree-auth-pool-'))
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
      accountUsageSummary: () => undefined,
      activeAccountId: () => undefined,
      disabledAccountIds: () => [],
      exhaustedAccountIds: () => [],
      insert: (entry: RequestLedgerEntry) => entries.unshift(entry),
      markAccountQuotaExhausted: () => undefined,
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
    const endpoint = new URL((await service.start()).endpoint)

    const response = await fetch(`${endpoint.origin}/backend-api/codex/responses`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer placeholder-token',
        'chatgpt-account-id': 'placeholder-account',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ model: 'gpt-5.5', input: 'hi' })
    })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'no_available_account' })
    expect(upstreamHits).toBe(0)
    expect(entries[0]).toMatchObject({
      outcome: 'rejected',
      statusCode: 503,
      upstreamHost: 'not-forwarded'
    })
  })

  it('suppresses quota errors after every managed account is exhausted', async () => {
    const authDirectory = mkdtempSync(join(tmpdir(), 'codexfree-auth-pool-'))
    writeAuthFile(authDirectory, 'a.json', 'account-a', 'managed-a')
    const routingEvents: string[] = []
    let upgrades = 0
    const upstream = http.createServer()
    upstream.on('upgrade', (_request, socket) => {
      upgrades += 1
      socket.write(upgradeResponse())
      socket.write(quotaFrame())
      socket.end()
    })
    await listen(upstream)
    upstreams.push(upstream)

    const entries: RequestLedgerEntry[] = []
    const ledger = {
      insert: (entry: RequestLedgerEntry) => entries.unshift(entry),
      syncAccountPool: () => undefined,
      exhaustedAccountIds: () => [],
      disabledAccountIds: () => [],
      activeAccountId: () => undefined,
      setActiveAccount: () => 1,
      recordRoutingEvent: (event: { eventType: string; reason: string }) => {
        routingEvents.push(`${event.eventType}:${event.reason}`)
      },
      markAccountQuotaExhausted: () => undefined,
      markQuotaExhausted: (id: string, errorMessage: string, completedAt: Date) => {
        const entry = entries.find((item) => item.id === id)
        if (entry) {
          entry.outcome = 'quota_exhausted'
          entry.statusCode = 429
          entry.errorMessage = errorMessage
          entry.completedAt = completedAt
        }
      },
      recent: () => []
    } as unknown as ProxyLedger
    const service = new TransparentProxyService(
      { ...createConfig(upstream), authPool: { enabled: true, directory: authDirectory } },
      ledger,
      log
    )
    services.push(service)
    const endpoint = new URL((await service.start()).endpoint)
    const response = await rawHttpRequest(Number(endpoint.port), [
      'GET /backend-api/codex/responses HTTP/1.1',
      `Host: ${endpoint.host}`,
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Sec-WebSocket-Version: 13',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      'Authorization: Bearer placeholder-token',
      'Chatgpt-Account-Id: placeholder-account',
      'thread_id: exhausted-thread',
      '',
      ''
    ])

    expect(upgrades).toBe(1)
    expect(response).not.toContain('usage_limit_reached')
    expect(response).toContain('response.completed')
    expect(routingEvents).toContain('all_accounts_exhausted:usage_limit_reached')
    expect(entries[0]).toMatchObject({
      outcome: 'quota_exhausted',
      statusCode: 429
    })
  })

  it('rejects managed websocket upgrades locally when no account is available', async () => {
    const authDirectory = mkdtempSync(join(tmpdir(), 'codexfree-auth-pool-'))
    let upstreamHits = 0
    const upstream = http.createServer()
    upstream.on('upgrade', (_request, socket) => {
      upstreamHits += 1
      socket.end()
    })
    await listen(upstream)
    upstreams.push(upstream)

    const entries: RequestLedgerEntry[] = []
    const ledger = {
      insert: (entry: RequestLedgerEntry) => entries.unshift(entry),
      syncAccountPool: () => undefined,
      exhaustedAccountIds: () => [],
      disabledAccountIds: () => [],
      activeAccountId: () => undefined,
      setActiveAccount: () => 1,
      recordRoutingEvent: () => undefined,
      markAccountQuotaExhausted: () => undefined,
      recent: () => []
    } as unknown as ProxyLedger
    const service = new TransparentProxyService(
      { ...createConfig(upstream), authPool: { enabled: true, directory: authDirectory } },
      ledger,
      log
    )
    services.push(service)
    const endpoint = new URL((await service.start()).endpoint)
    const response = await rawHttpRequest(Number(endpoint.port), [
      'GET /backend-api/codex/responses HTTP/1.1',
      `Host: ${endpoint.host}`,
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Sec-WebSocket-Version: 13',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      'Authorization: Bearer placeholder-token',
      'Chatgpt-Account-Id: placeholder-account',
      '',
      ''
    ])

    expect(response).toContain('HTTP/1.1 503')
    expect(response).toContain('no_available_account')
    expect(upstreamHits).toBe(0)
    expect(entries[0]).toMatchObject({
      outcome: 'rejected',
      statusCode: 503,
      upstreamHost: 'not-forwarded'
    })
  })
})

function upgradeResponse(): string {
  return [
    'HTTP/1.1 101 Switching Protocols',
    'Connection: Upgrade',
    'Upgrade: websocket',
    'Sec-WebSocket-Accept: test',
    '',
    ''
  ].join('\r\n')
}

function quotaFrame(): Buffer {
  return createServerTextFrame(
    '{"type":"error","status_code":429,"error":{"type":"usage_limit_reached"}}'
  )
}
