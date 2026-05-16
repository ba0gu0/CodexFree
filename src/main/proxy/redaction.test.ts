import { describe, expect, it } from 'vitest'
import { fingerprint, redactHeaders } from './redaction'

describe('proxy redaction', () => {
  it('redacts sensitive headers and keeps fingerprints stable', () => {
    const redacted = redactHeaders({
      authorization: 'Bearer sensitive-token',
      cookie: 'session=sensitive-cookie',
      'content-type': 'application/json'
    })

    expect(redacted.authorization).toBe(`[redacted:${fingerprint('Bearer sensitive-token')}]`)
    expect(redacted.cookie).toBe(`[redacted:${fingerprint('session=sensitive-cookie')}]`)
    expect(redacted['content-type']).toBe('application/json')
  })

  it('redacts Node raw header arrays by header name', () => {
    const redacted = redactHeaders([
      'Host',
      '127.0.0.1:33333',
      'Authorization',
      'Bearer raw-secret',
      'Content-Type',
      'application/json'
    ])

    expect(redacted.Authorization).toBe(`[redacted:${fingerprint('Bearer raw-secret')}]`)
    expect(redacted.Host).toBe('127.0.0.1:33333')
    expect(redacted['Content-Type']).toBe('application/json')
    expect(redacted[2]).toBeUndefined()
  })
})
