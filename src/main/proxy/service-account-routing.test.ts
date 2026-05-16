import { mkdtempSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Duplex } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProxyLedger } from './ledger'
import { TransparentProxyService } from './service'
import {
  closeServer,
  createClientTextFrame,
  createConfig,
  createServerTextFrame,
  listen,
  rawHttpRequest,
  rawHttpRequestBufferWithHead,
  writeAuthFile
} from './service-test-utils'
import type { RequestLedgerEntry } from './types'

const log = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
}

describe('transparent proxy service account routing', () => {
  const services: TransparentProxyService[] = []
  const upstreams: http.Server[] = []

  afterEach(async () => {
    await Promise.all(services.map((service) => service.stop()))
    await Promise.all(upstreams.map((server) => closeServer(server)))
    services.length = 0
    upstreams.length = 0
  })

  it('switches a conversation to the next account after websocket quota exhaustion', async () => {
    const authDirectory = mkdtempSync(join(tmpdir(), 'codexfree-auth-pool-'))
    writeAuthFile(authDirectory, 'a.json', 'account-a', 'managed-a')
    writeAuthFile(authDirectory, 'b.json', 'account-b', 'managed-b')
    const forwardedAccounts: string[] = []
    const forwardedAuth: string[] = []
    const upstreamSockets = new Set<Duplex>()
    let upgrades = 0
    const upstream = http.createServer()
    upstream.on('upgrade', (request, socket) => {
      upstreamSockets.add(socket)
      socket.once('close', () => upstreamSockets.delete(socket))
      upgrades += 1
      forwardedAccounts.push(String(request.headers['chatgpt-account-id']))
      forwardedAuth.push(String(request.headers.authorization))
      socket.write(
        [
          'HTTP/1.1 101 Switching Protocols',
          'Connection: Upgrade',
          'Upgrade: websocket',
          'Sec-WebSocket-Accept: test',
          '',
          ''
        ].join('\r\n')
      )
      if (upgrades === 1) {
        socket.once('data', () => {
          socket.write(
            createServerTextFrame(
              '{"type":"error","status_code":429,"error":{"type":"usage_limit_reached"}}'
            )
          )
          socket.end()
        })
      } else {
        socket.write(createServerTextFrame('{"type":"response.created"}'))
        socket.end()
      }
    })
    await listen(upstream)
    upstreams.push(upstream)

    const entries: RequestLedgerEntry[] = []
    const routingEvents: string[] = []
    const exhaustedAccounts: string[] = []
    const ledger = {
      insert: (entry: RequestLedgerEntry) => entries.unshift(entry),
      syncAccountPool: () => undefined,
      exhaustedAccountIds: () => exhaustedAccounts,
      disabledAccountIds: () => [],
      activeAccountId: () => undefined,
      setActiveAccount: () => 1,
      recordRoutingEvent: (event: { eventType: string; accountId?: string }) => {
        routingEvents.push(`${event.eventType}:${event.accountId ?? ''}`)
      },
      markAccountQuotaExhausted: (accountId: string | undefined) => {
        if (accountId) {
          exhaustedAccounts.push(accountId)
        }
      },
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
    const status = await service.start()
    const endpoint = new URL(status.endpoint)
    const request = [
      'GET /backend-api/codex/responses HTTP/1.1',
      `Host: ${endpoint.host}`,
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Sec-WebSocket-Version: 13',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      'Authorization: Bearer placeholder-token',
      'Chatgpt-Account-Id: placeholder-account',
      'thread_id: shared-thread',
      'session_id: shared-thread',
      'x-client-request-id: shared-thread',
      '',
      ''
    ]

    const firstResponse = (
      await rawHttpRequestBufferWithHead(
        Number(endpoint.port),
        request,
        createClientTextFrame(
          '{"type":"response.create","input":[{"type":"message","role":"user","content":[{"type":"input_text","text":"full context"}]}]}'
        )
      )
    ).toString('utf8')
    await rawHttpRequest(Number(endpoint.port), request)
    for (const socket of upstreamSockets) {
      socket.destroy()
    }

    expect(firstResponse).not.toContain('usage_limit_reached')
    expect(firstResponse).toContain('response.created')
    expect(forwardedAccounts).toEqual(['account-a', 'account-b', 'account-b'])
    expect(forwardedAuth).toEqual(['Bearer managed-a', 'Bearer managed-b', 'Bearer managed-b'])
    expect(routingEvents).toContain('quota_retry_selected:account-b')
    expect(entries[0]).toMatchObject({
      accountId: 'account-b',
      outcome: 'forwarded',
      statusCode: 101
    })
  })

  it('forwards usage queries through the selected real account', async () => {
    const authDirectory = mkdtempSync(join(tmpdir(), 'codexfree-auth-pool-'))
    writeAuthFile(authDirectory, 'a.json', 'account-a', 'managed-a')
    let forwardedAccountId = ''
    let forwardedAuthorization = ''
    const upstream = http.createServer((request, response) => {
      forwardedAccountId = String(request.headers['chatgpt-account-id'])
      forwardedAuthorization = String(request.headers.authorization)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          user_id: 'upstream-user',
          account_id: 'upstream-user',
          email: 'upstream@example.test',
          plan_type: 'free',
          rate_limit: {
            allowed: false,
            limit_reached: true,
            primary_window: {
              used_percent: 100,
              limit_window_seconds: 604_800,
              reset_after_seconds: 603_881,
              reset_at: 1_779_285_181
            }
          }
        })
      )
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
      updateAccountUsage: () => undefined,
      recordRoutingEvent: () => undefined,
      markAccountQuotaExhausted: () => undefined,
      markQuotaExhausted: () => undefined,
      recent: () => []
    } as unknown as ProxyLedger
    const service = new TransparentProxyService(
      { ...createConfig(upstream), authPool: { enabled: true, directory: authDirectory } },
      ledger,
      log
    )
    services.push(service)
    const status = await service.start()
    const endpoint = new URL(status.endpoint)
    const response = await fetch(`${endpoint.origin}/backend-api/wham/usage`, {
      headers: {
        authorization: 'Bearer placeholder-token',
        'chatgpt-account-id': 'placeholder-account'
      }
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      user_id: 'upstream-user',
      account_id: 'upstream-user',
      email: 'upstream@example.test',
      plan_type: 'free',
      rate_limit: {
        allowed: false,
        limit_reached: true,
        primary_window: {
          used_percent: 100,
          reset_at: 1_779_285_181
        }
      }
    })
    expect(forwardedAccountId).toBe('account-a')
    expect(forwardedAuthorization).toBe('Bearer managed-a')
    expect(entries[0]).toMatchObject({
      accountId: 'account-a',
      path: '/backend-api/wham/usage'
    })
  })

  it('retries usage queries with the next account when active is exhausted', async () => {
    const authDirectory = mkdtempSync(join(tmpdir(), 'codexfree-auth-pool-'))
    writeAuthFile(authDirectory, 'a.json', 'account-a', 'managed-a')
    writeAuthFile(authDirectory, 'b.json', 'account-b', 'managed-b')
    const forwardedAccounts: string[] = []
    const upstream = http.createServer((request, response) => {
      const forwardedAccount = String(request.headers['chatgpt-account-id'])
      forwardedAccounts.push(forwardedAccount)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          plan_type: 'free',
          rate_limit: {
            primary_window: {
              reset_at: 1779342755,
              used_percent: forwardedAccount === 'account-a' ? 100 : 12
            }
          }
        })
      )
    })
    await listen(upstream)
    upstreams.push(upstream)

    const entries: RequestLedgerEntry[] = []
    const exhaustedAccounts: string[] = []
    const activeAccounts: string[] = []
    const ledger = {
      accountUsageSummary: () => undefined,
      activeAccountId: () => undefined,
      disabledAccountIds: () => [],
      exhaustedAccountIds: () => exhaustedAccounts,
      insert: (entry: RequestLedgerEntry) => entries.unshift(entry),
      markAccountQuotaExhausted: () => undefined,
      markQuotaExhausted: () => undefined,
      recordRoutingEvent: () => undefined,
      recent: () => [],
      setActiveAccount: (accountId: string) => {
        activeAccounts.push(accountId)
        return 1
      },
      syncAccountPool: () => undefined,
      updateAccountUsage: (input: { accountId: string; primaryUsedPercent?: string }) => {
        if (input.primaryUsedPercent === '100') {
          exhaustedAccounts.push(input.accountId)
        }
      }
    } as unknown as ProxyLedger
    const service = new TransparentProxyService(
      { ...createConfig(upstream), authPool: { enabled: true, directory: authDirectory } },
      ledger,
      log
    )
    services.push(service)
    const status = await service.start()
    const endpoint = new URL(status.endpoint)

    const response = await fetch(`${endpoint.origin}/backend-api/wham/usage`, {
      headers: {
        authorization: 'Bearer placeholder-token',
        'chatgpt-account-id': 'placeholder-account'
      }
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      plan_type: 'free',
      rate_limit: { primary_window: { used_percent: 12 } }
    })
    expect(forwardedAccounts).toEqual(['account-a', 'account-b'])
    expect(activeAccounts).toEqual(['account-a', 'account-b'])
    expect(entries[0]).toMatchObject({
      accountId: 'account-b',
      path: '/backend-api/wham/usage'
    })
  })

  it('disables a 401 account and retries the request with the next account', async () => {
    const authDirectory = mkdtempSync(join(tmpdir(), 'codexfree-auth-pool-'))
    writeAuthFile(authDirectory, 'a.json', 'account-a', 'managed-a')
    writeAuthFile(authDirectory, 'b.json', 'account-b', 'managed-b')
    const forwardedAccounts: string[] = []
    const upstream = http.createServer((request, response) => {
      const forwardedAccount = String(request.headers['chatgpt-account-id'])
      forwardedAccounts.push(forwardedAccount)
      if (forwardedAccount === 'account-a') {
        response.writeHead(401, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'Your authentication token is invalid' } }))
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true, account: forwardedAccount }))
    })
    await listen(upstream)
    upstreams.push(upstream)

    const entries: RequestLedgerEntry[] = []
    const disabledAccounts: string[] = []
    const routingEvents: string[] = []
    const ledger = {
      accountUsageSummary: () => undefined,
      activeAccountId: () => undefined,
      disabledAccountIds: () => disabledAccounts,
      exhaustedAccountIds: () => [],
      insert: (entry: RequestLedgerEntry) => entries.unshift(entry),
      markAccountQuotaExhausted: () => undefined,
      markQuotaExhausted: () => undefined,
      recordRoutingEvent: (event: { eventType: string; accountId?: string }) => {
        routingEvents.push(`${event.eventType}:${event.accountId}`)
      },
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
    const endpoint = new URL(status.endpoint)

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
    await expect(response.json()).resolves.toEqual({ ok: true, account: 'account-b' })
    expect(forwardedAccounts).toEqual(['account-a', 'account-b'])
    expect(disabledAccounts).toEqual(['account-a'])
    expect(routingEvents).toContain('auth_failed:account-a')
    expect(routingEvents).toContain('auth_retry_selected:account-b')
    expect(entries[0]).toMatchObject({
      accountId: 'account-b',
      path: '/backend-api/codex/responses',
      statusCode: 200
    })
  })
})
