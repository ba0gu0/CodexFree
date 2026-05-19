import { mkdtempSync, readFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProxyLedger } from './ledger'
import { TransparentProxyService } from './service'
import {
  closeServer,
  createConfig,
  createServerPingFrame,
  createServerTextFrame,
  listen,
  rawHttpRequest,
  rawHttpRequestAndDestroyAfterMatch,
  rawHttpRequestBuffer,
  writeAuthFile
} from './service-test-utils'
import type { RequestLedgerEntry } from './types'

const log = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
}

describe('transparent proxy service websocket handling', () => {
  const services: TransparentProxyService[] = []
  const upstreams: http.Server[] = []

  afterEach(async () => {
    await Promise.all(services.map((service) => service.stop()))
    await Promise.all(upstreams.map((server) => closeServer(server)))
    services.length = 0
    upstreams.length = 0
  })

  it('rejects API-key mode websocket upgrades without forwarding upstream', async () => {
    let upstreamHits = 0
    const upstream = http.createServer()
    upstream.on('upgrade', (_request, socket) => {
      upstreamHits += 1
      socket.destroy()
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
    const endpoint = new URL(status.endpoint)
    const response = await rawHttpRequest(Number(endpoint.port), [
      'GET /backend-api/codex/responses HTTP/1.1',
      `Host: ${endpoint.host}`,
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Sec-WebSocket-Version: 13',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      'Authorization: Bearer sk-test',
      'Chatgpt-Account-Id: account-id',
      '',
      ''
    ])

    expect(response).toContain('HTTP/1.1 403 Forbidden')
    expect(response).toContain('api_key_mode_not_supported')
    expect(upstreamHits).toBe(0)
    expect(entries[0]).toMatchObject({
      mode: 'api_key',
      outcome: 'rejected',
      statusCode: 403,
      upstreamHost: 'not-forwarded'
    })
  })

  it('preserves original auth for wham remote websocket upgrades', async () => {
    const authDirectory = mkdtempSync(join(tmpdir(), 'codexfree-auth-pool-'))
    writeAuthFile(authDirectory, 'a.json', 'account-a', 'managed-a')
    let forwardedAccount = ''
    let forwardedAuthorization = ''
    const upstream = http.createServer()
    upstream.on('upgrade', (request, socket) => {
      forwardedAccount = String(request.headers['chatgpt-account-id'])
      forwardedAuthorization = String(request.headers.authorization)
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
      socket.end()
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
    const endpoint = new URL((await service.start()).endpoint)
    const response = await rawHttpRequest(Number(endpoint.port), [
      'GET /backend-api/wham/remote/control/server HTTP/1.1',
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

    expect(response).toContain('HTTP/1.1 101 Switching Protocols')
    expect(forwardedAccount).toBe('placeholder-account')
    expect(forwardedAuthorization).toBe('Bearer placeholder-token')
    expect(entries[0]).toMatchObject({
      accountId: 'placeholder-account',
      mode: 'account_passthrough',
      path: '/backend-api/wham/remote/control/server',
      statusCode: 101
    })
  })

  it('captures websocket frame payloads after a successful upgrade', async () => {
    const upstream = http.createServer()
    upstream.on('upgrade', (_request, socket) => {
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
      socket.write(createServerTextFrame('{"type":"error","message":"usage sample"}'))
      socket.end()
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
    const endpoint = new URL(status.endpoint)
    const response = await rawHttpRequest(Number(endpoint.port), [
      'GET /backend-api/codex/responses HTTP/1.1',
      `Host: ${endpoint.host}`,
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Sec-WebSocket-Version: 13',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      'Authorization: Bearer account-token',
      'Chatgpt-Account-Id: account-id',
      '',
      ''
    ])

    expect(response).toContain('HTTP/1.1 101 Switching Protocols')
    expect(entries[0].statusCode).toBe(101)
    const rawCapturePath = entries[0].rawCapturePath
    expect(rawCapturePath).toBeTypeOf('string')

    const frames = readFileSync(
      join(rawCapturePath ?? '', 'websocket-upstream-to-codex.frames.jsonl'),
      'utf8'
    )
    expect(frames).toContain('"opcode":"text"')
    expect(frames).toContain('usage sample')
  })

  it('records websocket tool call frames as one readable event', async () => {
    const upstream = http.createServer()
    upstream.on('upgrade', (_request, socket) => {
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
      socket.write(
        createServerTextFrame(
          JSON.stringify({
            type: 'response.output_item.added',
            item: { id: 'tool-1', type: 'function_call', name: 'exec_command' }
          })
        )
      )
      socket.write(
        createServerTextFrame(
          JSON.stringify({
            type: 'response.function_call_arguments.done',
            item_id: 'tool-1',
            arguments: JSON.stringify({ cmd: 'node -v' })
          })
        )
      )
      socket.write(
        createServerTextFrame(
          JSON.stringify({
            type: 'response.output_item.done',
            item: {
              id: 'tool-1',
              name: 'exec_command',
              status: 'completed',
              type: 'function_call'
            }
          })
        )
      )
      socket.end()
    })
    await listen(upstream)
    upstreams.push(upstream)

    const logged: Array<{ data: unknown; message: string }> = []
    const service = new TransparentProxyService(
      createConfig(upstream),
      {
        insert: () => undefined,
        recent: () => []
      } as unknown as ProxyLedger,
      {
        error: () => undefined,
        info: (message, data) => logged.push({ data, message }),
        warn: () => undefined
      }
    )
    services.push(service)
    const status = await service.start()
    const endpoint = new URL(status.endpoint)

    await rawHttpRequest(Number(endpoint.port), [
      'GET /backend-api/codex/responses HTTP/1.1',
      `Host: ${endpoint.host}`,
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Sec-WebSocket-Version: 13',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      'Authorization: Bearer account-token',
      'Chatgpt-Account-Id: account-id',
      '',
      ''
    ])

    const toolMessages = logged.filter(
      (item) =>
        item.message === 'WSS message' &&
        typeof item.data === 'object' &&
        item.data !== null &&
        String((item.data as { kind?: string }).kind).startsWith('tool')
    )
    expect(toolMessages).toHaveLength(1)
    expect(JSON.stringify(toolMessages[0].data)).toContain('工具调用: exec_command')
    expect(JSON.stringify(toolMessages[0].data)).toContain('参数: node -v')
    expect(JSON.stringify(toolMessages[0].data)).toContain('结果: completed')
  })

  it('marks websocket usage limit errors as quota exhausted', async () => {
    const upstream = http.createServer()
    upstream.on('upgrade', (_request, socket) => {
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
      setTimeout(() => {
        socket.write(
          createServerTextFrame(
            JSON.stringify({
              type: 'error',
              status_code: 429,
              error: {
                type: 'usage_limit_reached'
              }
            })
          )
        )
        socket.end()
      }, 10)
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
    const service = new TransparentProxyService(createConfig(upstream), ledger, log)
    services.push(service)
    const status = await service.start()
    const endpoint = new URL(status.endpoint)
    const response = await rawHttpRequest(Number(endpoint.port), [
      'GET /backend-api/codex/responses HTTP/1.1',
      `Host: ${endpoint.host}`,
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Sec-WebSocket-Version: 13',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      'Authorization: Bearer account-token',
      'Chatgpt-Account-Id: account-id',
      '',
      ''
    ])

    expect(response).toContain('HTTP/1.1 101 Switching Protocols')
    expect(response).toContain('usage_limit_reached')
    expect(response).not.toContain('response.completed')
    expect(entries[0]).toMatchObject({
      outcome: 'quota_exhausted',
      statusCode: 429
    })
    expect(entries[0].errorMessage).toContain('usage_limit_reached')
  })

  it('forwards early websocket ping frames while probing for quota errors', async () => {
    const authDirectory = mkdtempSync(join(tmpdir(), 'codexfree-auth-pool-'))
    writeAuthFile(authDirectory, 'a.json', 'account-a', 'managed-a')
    const upstream = http.createServer()
    upstream.on('upgrade', (_request, socket) => {
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
      socket.write(createServerPingFrame('ping'))
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
    const response = await rawHttpRequestBuffer(Number(endpoint.port), [
      'GET /backend-api/codex/responses HTTP/1.1',
      `Host: ${endpoint.host}`,
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Sec-WebSocket-Version: 13',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      'Authorization: Bearer placeholder-token',
      'Chatgpt-Account-Id: placeholder-account',
      'thread_id: ping-thread',
      '',
      ''
    ])

    const responseText = response.toString('utf8')
    expect(responseText.match(/HTTP\/1\.1 101/g)?.length).toBe(1)
    expect(response.includes(createServerPingFrame('ping'))).toBe(true)
  })

  it('does not crash when a websocket peer disconnects during frame forwarding', async () => {
    const upstream = http.createServer()
    upstream.on('upgrade', (_request, socket) => {
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
      setTimeout(() => {
        socket.write(createServerTextFrame('{"late":true}'))
        socket.end()
      }, 20)
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
    const endpoint = new URL(status.endpoint)

    await rawHttpRequestAndDestroyAfterMatch(
      Number(endpoint.port),
      [
        'GET /backend-api/codex/responses HTTP/1.1',
        `Host: ${endpoint.host}`,
        'Connection: Upgrade',
        'Upgrade: websocket',
        'Sec-WebSocket-Version: 13',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        'Authorization: Bearer account-token',
        'Chatgpt-Account-Id: account-id',
        '',
        ''
      ],
      'HTTP/1.1 101 Switching Protocols'
    )
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(entries[0].statusCode).toBe(101)
  })
})
