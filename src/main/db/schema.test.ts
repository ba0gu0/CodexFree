import { describe, expect, it } from 'vitest'
import { accounts, proxyRequests } from './schema'

describe('database schema', () => {
  it('keeps auth account records metadata-only', () => {
    const columnNames = Object.keys(accounts)

    expect(columnNames).toContain('fingerprint')
    expect(columnNames).not.toContain('accessToken')
    expect(columnNames).not.toContain('refreshToken')
    expect(columnNames).not.toContain('cookie')
  })

  it('links proxy requests to account records', () => {
    const columnNames = Object.keys(proxyRequests)

    expect(columnNames).toContain('accountId')
    expect(columnNames).toContain('conversationKey')
    expect(columnNames).toContain('outcome')
    expect(columnNames).toContain('authFingerprint')
    expect(columnNames).toContain('rawCapturePath')
    expect(columnNames).not.toContain('authorization')
    expect(columnNames).not.toContain('cookie')
  })
})
