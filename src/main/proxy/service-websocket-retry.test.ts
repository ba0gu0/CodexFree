import { mkdtempSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProxyLedger } from './ledger'
import { TransparentProxyService } from './service'
import {
  closeServer,
  createClientTextFrame,
  createConfig,
  createServerTextFrame,
  listen,
  rawHttpRequestBufferWithHead,
  writeAuthFile
} from './service-test-utils'

const log = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
}

describe('transparent proxy websocket retry handling', () => {
  const services: TransparentProxyService[] = []
  const upstreams: http.Server[] = []

  afterEach(async () => {
    await Promise.all(services.map((service) => service.stop()))
    await Promise.all(upstreams.map((server) => closeServer(server)))
    services.length = 0
    upstreams.length = 0
  })

  it('replays client websocket frames once per upstream retry', async () => {
    const authDirectory = mkdtempSync(join(tmpdir(), 'codexfree-auth-pool-'))
    writeAuthFile(authDirectory, 'a.json', 'account-a', 'managed-a')
    writeAuthFile(authDirectory, 'b.json', 'account-b', 'managed-b')
    writeAuthFile(authDirectory, 'c.json', 'account-c', 'managed-c')
    const chunksPerUpgrade: number[] = []
    let upgrades = 0
    const upstream = http.createServer()
    upstream.on('upgrade', (_request, socket) => {
      const upgradeIndex = upgrades
      upgrades += 1
      chunksPerUpgrade[upgradeIndex] = 0
      socket.write(upgradeResponse())
      socket.once('data', () => {
        chunksPerUpgrade[upgradeIndex] += 1
        if (upgradeIndex < 2) {
          socket.write(quotaFrame())
          socket.end()
          return
        }
        socket.write(createServerTextFrame('{"type":"response.created"}'))
        socket.end()
      })
    })
    await listen(upstream)
    upstreams.push(upstream)

    const service = createManagedService(upstream, authDirectory)
    services.push(service)
    const endpoint = new URL((await service.start()).endpoint)
    const response = await sendUpgradeWithHead(
      Number(endpoint.port),
      endpoint.host,
      'replay-thread'
    )

    const responseText = response.toString('utf8')
    expect(responseText.match(/HTTP\/1\.1 101/g)?.length).toBe(1)
    expect(responseText).toContain('response.created')
    expect(chunksPerUpgrade).toEqual([1, 1, 1])
  })

  it('does not write retry http failures into an accepted websocket stream', async () => {
    const authDirectory = mkdtempSync(join(tmpdir(), 'codexfree-auth-pool-'))
    writeAuthFile(authDirectory, 'a.json', 'account-a', 'managed-a')
    writeAuthFile(authDirectory, 'b.json', 'account-b', 'managed-b')
    let upgrades = 0
    const upstream = http.createServer()
    upstream.on('upgrade', (_request, socket) => {
      upgrades += 1
      if (upgrades > 1) {
        socket.end(
          [
            'HTTP/1.1 401 Unauthorized',
            'Content-Type: application/json',
            '',
            '{"error":"invalid token"}'
          ].join('\r\n')
        )
        return
      }
      socket.write(upgradeResponse())
      socket.write(quotaFrame())
      socket.end()
    })
    await listen(upstream)
    upstreams.push(upstream)

    const service = createManagedService(upstream, authDirectory)
    services.push(service)
    const endpoint = new URL((await service.start()).endpoint)
    const response = await sendUpgradeWithHead(
      Number(endpoint.port),
      endpoint.host,
      'retry-http-failure-thread'
    )

    const responseText = response.toString('utf8')
    expect(upgrades).toBe(2)
    expect(responseText.match(/HTTP\/1\.1 101/g)?.length).toBe(1)
    expect(responseText).not.toContain('HTTP/1.1 401')
    expect(responseText).not.toContain('invalid token')
  })
})

function createManagedService(
  upstream: http.Server,
  authDirectory: string
): TransparentProxyService {
  const exhaustedAccounts: string[] = []
  const ledger = {
    insert: () => undefined,
    syncAccountPool: () => undefined,
    exhaustedAccountIds: () => exhaustedAccounts,
    disabledAccountIds: () => [],
    activeAccountId: () => undefined,
    setActiveAccount: () => 1,
    recordRoutingEvent: () => undefined,
    markAccountQuotaExhausted: (accountId: string | undefined) => {
      if (accountId) {
        exhaustedAccounts.push(accountId)
      }
    },
    markQuotaExhausted: () => undefined,
    recent: () => []
  } as unknown as ProxyLedger
  return new TransparentProxyService(
    { ...createConfig(upstream), authPool: { enabled: true, directory: authDirectory } },
    ledger,
    log
  )
}

function sendUpgradeWithHead(port: number, host: string, threadId: string): Promise<Buffer> {
  return rawHttpRequestBufferWithHead(
    port,
    [
      'GET /backend-api/codex/responses HTTP/1.1',
      `Host: ${host}`,
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Sec-WebSocket-Version: 13',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      'Authorization: Bearer placeholder-token',
      'Chatgpt-Account-Id: placeholder-account',
      `thread_id: ${threadId}`,
      '',
      ''
    ],
    createClientTextFrame('{"type":"response.create"}')
  )
}

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
