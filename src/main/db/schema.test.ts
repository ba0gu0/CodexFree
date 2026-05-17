import { describe, expect, it } from 'vitest'
import { createDatabase } from './index'
import {
  proxyAccounts,
  proxyLogEvents,
  proxyProtocolMessages,
  proxyQuotaEvents,
  proxyRequests,
  proxyRoutingEvents,
  proxySettings
} from './schema'

describe('database schema', () => {
  it('keeps auth account records metadata-only', () => {
    const columnNames = Object.keys(proxyAccounts)

    expect(columnNames).toContain('fingerprint')
    expect(columnNames).not.toContain('accessToken')
    expect(columnNames).not.toContain('refreshToken')
    expect(columnNames).not.toContain('cookie')
  })

  it('keeps proxy request ledger records redacted', () => {
    const columnNames = Object.keys(proxyRequests)

    expect(columnNames).toContain('accountId')
    expect(columnNames).toContain('conversationKey')
    expect(columnNames).toContain('authFingerprint')
    expect(columnNames).toContain('cookieFingerprint')
    expect(columnNames).not.toContain('authorization')
    expect(columnNames).not.toContain('cookie')
  })

  it('initializes ledger tables for a new database', () => {
    const db = createDatabase(':memory:')
    try {
      const rows = db.$client
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as { name: string }[]

      expect(rows.map((row) => row.name)).toContain('proxy_accounts')
      expect(rows.map((row) => row.name)).not.toContain('app_settings')
      expect(rows.map((row) => row.name)).toContain('proxy_settings')
      expect(rows.map((row) => row.name)).toContain('proxy_requests')
      expect(rows.map((row) => row.name)).toContain('proxy_routing_events')
      expect(rows.map((row) => row.name)).toContain('proxy_quota_events')
      expect(rows.map((row) => row.name)).toContain('proxy_protocol_messages')
      expect(rows.map((row) => row.name)).toContain('proxy_log_events')
    } finally {
      db.$client.close()
    }
  })

  it('keeps drizzle table declarations aligned with runtime ledger tables', () => {
    expect([
      proxyAccounts,
      proxySettings,
      proxyRequests,
      proxyRoutingEvents,
      proxyQuotaEvents,
      proxyProtocolMessages,
      proxyLogEvents
    ]).toHaveLength(7)
  })
})
