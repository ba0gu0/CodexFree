import { mkdtempSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Duplex } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { TransparentProxyService } from './service'
import {
  closeServer,
  createClientTextFrame,
  createConfig,
  createServerTextFrame,
  listen,
  rawHttpRequestBufferWithHead,
  withLedgerAccountFacts,
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
      'replay-thread',
      '{"type":"response.create","input":[{"type":"message","role":"user","content":[{"type":"input_text","text":"full context"}]}]}'
    )

    const responseText = response.toString('utf8')
    expect(responseText.match(/HTTP\/1\.1 101/g)?.length).toBe(1)
    expect(responseText).toContain('response.created')
    expect(chunksPerUpgrade).toEqual([1, 1, 1])
  })

  it('closes the client websocket instead of replaying an initial bootstrap frame', async () => {
    const authDirectory = mkdtempSync(join(tmpdir(), 'codexfree-auth-pool-'))
    writeAuthFile(authDirectory, 'a.json', 'account-a', 'managed-a')
    writeAuthFile(authDirectory, 'b.json', 'account-b', 'managed-b')
    const forwardedAccounts: string[] = []
    const chunksPerUpgrade: number[] = []
    const upstreamSockets = new Set<Duplex>()
    let upgrades = 0
    const upstream = http.createServer()
    upstream.on('upgrade', (request, socket) => {
      upstreamSockets.add(socket)
      socket.once('close', () => upstreamSockets.delete(socket))
      const upgradeIndex = upgrades
      upgrades += 1
      forwardedAccounts.push(String(request.headers['chatgpt-account-id']))
      chunksPerUpgrade[upgradeIndex] = 0
      socket.write(upgradeResponse())
      socket.once('data', () => {
        chunksPerUpgrade[upgradeIndex] += 1
        socket.write(quotaFrame())
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
      'bootstrap-thread',
      '{"type":"response.create","input":[],"generate":{}}'
    )

    const responseText = response.toString('utf8')
    for (const socket of upstreamSockets) {
      socket.destroy()
    }
    expect(responseText.match(/HTTP\/1\.1 101/g)?.length).toBe(1)
    expect(responseText).not.toContain('usage_limit_reached')
    expect(forwardedAccounts).toEqual(['account-a'])
    expect(chunksPerUpgrade).toEqual([1])
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
      socket.once('data', () => {
        socket.write(quotaFrame())
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
      'retry-http-failure-thread',
      '{"type":"response.create","input":[{"type":"message","role":"user","content":[{"type":"input_text","text":"full context"}]}]}'
    )

    const responseText = response.toString('utf8')
    expect(upgrades).toBe(2)
    expect(responseText.match(/HTTP\/1\.1 101/g)?.length).toBe(1)
    expect(responseText).not.toContain('HTTP/1.1 401')
    expect(responseText).not.toContain('invalid token')
  })

  it('closes the client websocket when a later response.create cannot be replayed', async () => {
    const authDirectory = mkdtempSync(join(tmpdir(), 'codexfree-auth-pool-'))
    writeAuthFile(authDirectory, 'a.json', 'account-a', 'managed-a')
    writeAuthFile(authDirectory, 'b.json', 'account-b', 'managed-b')
    const forwardedAccounts: string[] = []
    const chunksPerUpgrade: number[] = []
    const upstreamSockets = new Set<Duplex>()
    let upgrades = 0
    const upstream = http.createServer()
    upstream.on('upgrade', (request, socket) => {
      upstreamSockets.add(socket)
      socket.once('close', () => upstreamSockets.delete(socket))
      const upgradeIndex = upgrades
      upgrades += 1
      chunksPerUpgrade[upgradeIndex] = 0
      forwardedAccounts.push(String(request.headers['chatgpt-account-id']))
      socket.write(upgradeResponse())
      socket.on('data', () => {
        chunksPerUpgrade[upgradeIndex] += 1
        if (upgradeIndex === 0 && chunksPerUpgrade[upgradeIndex] === 1) {
          socket.write(createServerTextFrame('{"type":"response.created","sequence_number":0}'))
          socket.write(createServerTextFrame('{"type":"response.completed","sequence_number":1}'))
          return
        }
        if (upgradeIndex === 0) {
          socket.write(quotaFrame())
          return
        }
        socket.write(createServerTextFrame('{"type":"response.created","marker":"retry-ok"}'))
        socket.end()
      })
    })
    await listen(upstream)
    upstreams.push(upstream)

    const service = createManagedService(upstream, authDirectory)
    services.push(service)
    const endpoint = new URL((await service.start()).endpoint)
    const response = await sendTwoTurnsOnOneUpgrade(
      Number(endpoint.port),
      endpoint.host,
      '{"type":"response.create","model":"gpt-5.5","previous_response_id":"resp-old","input":[{"type":"message","role":"user","content":[{"type":"input_text","text":"next"}]}]}'
    )
    for (const socket of upstreamSockets) {
      socket.destroy()
    }
    const responseText = response.toString('utf8')

    expect(responseText.match(/HTTP\/1\.1 101/g)?.length).toBe(1)
    expect(responseText).not.toContain('usage_limit_reached')
    expect(forwardedAccounts).toEqual(['account-a'])
    expect(chunksPerUpgrade).toEqual([2])
  })

  it('retries a later self-contained response.create frame on a replacement upstream websocket', async () => {
    const authDirectory = mkdtempSync(join(tmpdir(), 'codexfree-auth-pool-'))
    writeAuthFile(authDirectory, 'a.json', 'account-a', 'managed-a')
    writeAuthFile(authDirectory, 'b.json', 'account-b', 'managed-b')
    const forwardedAccounts: string[] = []
    const chunksPerUpgrade: number[] = []
    const upstreamSockets = new Set<Duplex>()
    let upgrades = 0
    const upstream = http.createServer()
    upstream.on('upgrade', (request, socket) => {
      upstreamSockets.add(socket)
      socket.once('close', () => upstreamSockets.delete(socket))
      const upgradeIndex = upgrades
      upgrades += 1
      chunksPerUpgrade[upgradeIndex] = 0
      forwardedAccounts.push(String(request.headers['chatgpt-account-id']))
      socket.write(upgradeResponse())
      socket.on('data', () => {
        chunksPerUpgrade[upgradeIndex] += 1
        if (upgradeIndex === 0 && chunksPerUpgrade[upgradeIndex] === 1) {
          socket.write(createServerTextFrame('{"type":"response.created","sequence_number":0}'))
          socket.write(createServerTextFrame('{"type":"response.completed","sequence_number":1}'))
          return
        }
        if (upgradeIndex === 0) {
          socket.write(quotaFrame())
          return
        }
        socket.write(createServerTextFrame('{"type":"response.created","marker":"retry-ok"}'))
        socket.end()
      })
    })
    await listen(upstream)
    upstreams.push(upstream)

    const service = createManagedService(upstream, authDirectory)
    services.push(service)
    const endpoint = new URL((await service.start()).endpoint)
    const response = await sendTwoTurnsOnOneUpgrade(
      Number(endpoint.port),
      endpoint.host,
      '{"type":"response.create","model":"gpt-5.5","input":[{"type":"message","role":"user","content":[{"type":"input_text","text":"full context"}]}]}',
      'retry-ok'
    )
    for (const socket of upstreamSockets) {
      socket.destroy()
    }
    const responseText = response.toString('utf8')

    expect(responseText.match(/HTTP\/1\.1 101/g)?.length).toBe(1)
    expect(responseText).toContain('retry-ok')
    expect(responseText).not.toContain('usage_limit_reached')
    expect(forwardedAccounts).toEqual(['account-a', 'account-b'])
    expect(chunksPerUpgrade).toEqual([2, 1])
  })
})

function createManagedService(
  upstream: http.Server,
  authDirectory: string
): TransparentProxyService {
  const exhaustedAccounts: string[] = []
  const ledger = withLedgerAccountFacts(
    {
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
    },
    ['account-a', 'account-b', 'account-c']
  )
  return new TransparentProxyService(
    { ...createConfig(upstream), authPool: { enabled: true, directory: authDirectory } },
    ledger,
    log
  )
}

function sendUpgradeWithHead(
  port: number,
  host: string,
  threadId: string,
  frameJson = '{"type":"response.create"}'
): Promise<Buffer> {
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
    createClientTextFrame(frameJson)
  )
}

function sendTwoTurnsOnOneUpgrade(
  port: number,
  host: string,
  secondTurnJson: string,
  finishMarker?: string
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    const chunks: Buffer[] = []
    let settled = false
    let secondTurnSent = false
    const finish = () => {
      if (settled) {
        return
      }
      settled = true
      resolve(Buffer.concat(chunks))
    }
    const firstTurn = createClientTextFrame('{"type":"response.create","model":"gpt-5.5"}')
    const secondTurn = createClientTextFrame(secondTurnJson)
    socket.on('connect', () => {
      socket.write(
        Buffer.concat([
          Buffer.from(
            [
              'GET /backend-api/codex/responses HTTP/1.1',
              `Host: ${host}`,
              'Connection: Upgrade',
              'Upgrade: websocket',
              'Sec-WebSocket-Version: 13',
              'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
              'Authorization: Bearer placeholder-token',
              'Chatgpt-Account-Id: placeholder-account',
              'thread_id: same-wss-thread',
              '',
              ''
            ].join('\r\n')
          ),
          firstTurn
        ])
      )
    })
    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
      const text = Buffer.concat(chunks).toString('utf8')
      if (!secondTurnSent && text.includes('response.completed')) {
        secondTurnSent = true
        socket.write(secondTurn)
      }
      if (finishMarker && text.includes(finishMarker)) {
        socket.destroy()
        finish()
      }
    })
    socket.on('end', finish)
    socket.on('close', finish)
    socket.on('error', reject)
  })
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
