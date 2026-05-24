import { describe, expect, it } from 'vitest'
import { AuthNormalizationError, normalizeAuthFile } from './normalize'

const flatAuth = {
  access_token: 'access-token',
  account_id: 'account-id',
  client_id: 'client-id',
  disabled: true,
  email: 'user@example.test',
  expired: '2026-01-01T00:00:00.000Z',
  id_token: 'id-token',
  last_refresh: '2026-01-01T01:00:00.000Z',
  refresh_token: 'refresh-token',
  session_token: '',
  type: 'codex'
}

describe('auth normalization', () => {
  it('normalizes a flat Codex-style record into native Codex auth shape', () => {
    const normalized = normalizeAuthFile(flatAuth, { fileName: 'codex-free.json' })

    expect(normalized.format).toBe('codex')
    expect(normalized.accountId).toBe('account-id')
    expect(normalized.email).toBe('user@example.test')
    expect(normalized.disabled).toBe(true)
    expect(normalized.expiresAt).toBe('2026-01-01T00:00:00.000Z')
    expect(normalized.refreshable).toBe(true)
    expect(normalized.codexAuth).toEqual({
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens: {
        id_token: 'id-token',
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        account_id: 'account-id'
      },
      last_refresh: '2026-01-01T01:00:00.000Z'
    })
  })

  it('preserves native Codex auth files', () => {
    const native = {
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens: {
        id_token: 'id-token',
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        account_id: 'account-id'
      },
      last_refresh: '2026-01-01T01:00:00.000Z'
    }

    const normalized = normalizeAuthFile(native, { fileName: 'auth.json' })

    expect(normalized.format).toBe('codex')
    expect(normalized.label).toBe('codex:account-id')
    expect(normalized.codexAuth).toEqual(native)
  })

  it('infers CPA format from filename when no explicit type is present', () => {
    const { type: _type, ...withoutType } = flatAuth
    const normalized = normalizeAuthFile(withoutType, { fileName: 'cpa-account.json' })

    expect(normalized.format).toBe('cpa')
    expect(normalized.codexAuth.tokens.account_id).toBe('account-id')
  })

  it('rejects malformed files without exposing secret values in the message', () => {
    expect(() => normalizeAuthFile({ access_token: 'secret-access-token' })).toThrow(
      new AuthNormalizationError('Auth file is missing required field: account_id')
    )
  })

  it('accepts non-refreshable access tokens with an account id', () => {
    const normalized = normalizeAuthFile(
      {
        access_token: 'access-token',
        account_id: 'account-id',
        email: 'user@example.test',
        type: 'codex'
      },
      { now: new Date('2026-01-01T00:00:00.000Z') }
    )

    expect(normalized.refreshable).toBe(false)
    expect(normalized.codexAuth).toMatchObject({
      tokens: {
        access_token: 'access-token',
        account_id: 'account-id',
        id_token: '',
        refresh_token: ''
      },
      last_refresh: '2026-01-01T00:00:00.000Z'
    })
  })
})
