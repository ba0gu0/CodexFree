import { describe, expect, it } from 'vitest'
import { createProxyLogger } from './event-log'
import type { ProxyLedger } from './ledger'
import type { LogEventInput } from './ledger-types'

describe('proxy event log', () => {
  it('stores readable proxy events in the ledger even when debug output is disabled', () => {
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

    expect(events).toMatchObject([
      {
        accountId: 'account-1',
        level: 'info',
        message: 'HTTP forward',
        method: 'GET',
        path: '/backend-api/codex/models',
        requestId: 'request-1'
      }
    ])
  })
})
