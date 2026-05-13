import { describe, expect, it } from 'vitest'
import { classifyRequest, fingerprint, redactHeaders } from './redaction'

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

  it('classifies obvious API-key traffic without storing the key', () => {
    expect(classifyRequest({ authorization: 'Bearer sk-test' })).toBe('api_key')
    expect(classifyRequest({ authorization: 'Bearer account-token' })).toBe('account')
    expect(classifyRequest({})).toBe('unknown')
  })
})
