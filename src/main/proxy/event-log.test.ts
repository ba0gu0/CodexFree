import { stdout } from 'node:process'
import { describe, expect, it, vi } from 'vitest'
import { createProxyLogger } from './event-log'
import type { ProxyLedger } from './ledger'
import type { LogEventInput } from './ledger-types'

describe('proxy event log', () => {
  it('keeps request progress logs out of the persisted UI event stream', () => {
    const events: LogEventInput[] = []
    const ledger = {
      recordLogEvent: (event: LogEventInput) => events.push(event)
    } as unknown as ProxyLedger
    const logger = createProxyLogger(ledger, { debug: false, prefix: 'daemon' })

    logger.info('HTTP forward', {
      accountId: 'account-1',
      id: 'request-1',
      method: 'GET',
      path: '/backend-api/codex/models',
      targetHost: 'chatgpt.com'
    })

    expect(events).toEqual([])
  })

  it('stores system and quota events in the ledger even when debug output is disabled', () => {
    const events: LogEventInput[] = []
    const ledger = {
      recordLogEvent: (event: LogEventInput) => events.push(event)
    } as unknown as ProxyLedger
    const logger = createProxyLogger(ledger, { debug: false, prefix: 'daemon' })

    logger.warn('Usage limit reached; marking account exhausted', {
      accountId: 'account-1',
      id: 'request-1',
      path: '/backend-api/codex/responses'
    })

    expect(events).toMatchObject([
      {
        accountId: 'account-1',
        eventType: 'quota',
        level: 'warn',
        message: 'Usage limit reached; marking account exhausted',
        path: '/backend-api/codex/responses',
        requestId: 'request-1'
      }
    ])
  })

  it('labels HTTP POST responses separately from websocket upgrades', () => {
    const events: LogEventInput[] = []
    const output: string[] = []
    const writeSpy = vi.spyOn(stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      output.push(typeof chunk === 'string' ? chunk : chunk.toString())
      return true
    })
    const ledger = {
      recordLogEvent: (event: LogEventInput) => events.push(event)
    } as unknown as ProxyLedger
    const logger = createProxyLogger(ledger, { debug: true, prefix: 'daemon' })

    try {
      logger.info('HTTP forward', {
        accountId: 'account-1',
        id: 'request-1',
        method: 'POST',
        path: '/backend-api/codex/responses',
        targetHost: 'chatgpt.com'
      })
    } finally {
      writeSpy.mockRestore()
    }

    expect(output.join('')).toContain('(主聊天HTTP响应)')
    expect(output.join('')).not.toContain('(主聊天WSS)')
  })
})
