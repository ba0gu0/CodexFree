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

  it('derives account id, email, and plan type from ChatGPT JWT claims', () => {
    const idToken = fakeJwt({
      email: 'team-user@example.test',
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'team-account',
        chatgpt_plan_type: 'team'
      }
    })

    const normalized = normalizeAuthFile(
      {
        access_token: 'access-token',
        id_token: idToken,
        type: 'codex'
      },
      { now: new Date('2026-01-01T00:00:00.000Z') }
    )

    expect(normalized.accountId).toMatch(/^team-account:user:/)
    expect(normalized.upstreamAccountId).toBe('team-account')
    expect(normalized.email).toBe('team-user@example.test')
    expect(normalized.planType).toBe('team')
    expect(normalized.label).toBe('team-user@example.test')
  })

  it('accepts token_data wrapped flat records', () => {
    const idToken = fakeJwt({
      email: 'pro-user@example.test',
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'pro-account',
        chatgpt_plan_type: 'pro'
      }
    })

    const normalized = normalizeAuthFile({
      token_data: {
        access_token: 'access-token',
        id_token: idToken
      },
      type: 'cpa'
    })

    expect(normalized.format).toBe('cpa')
    expect(normalized.accountId).toMatch(/^pro-account:user:/)
    expect(normalized.upstreamAccountId).toBe('pro-account')
    expect(normalized.planType).toBe('pro')
  })

  it('accepts CPA chatgpt account and plan fields directly', () => {
    const normalized = normalizeAuthFile({
      access_token: 'access-token',
      chatgpt_account_id: 'direct-account',
      chatgpt_plan_type: 'team',
      email: 'direct@example.test',
      type: 'codex'
    })

    expect(normalized.accountId).toMatch(/^direct-account:user:/)
    expect(normalized.upstreamAccountId).toBe('direct-account')
    expect(normalized.planType).toBe('team')
  })
})

function fakeJwt(payload: Record<string, unknown>): string {
  return ['header', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'signature'].join(
    '.'
  )
}
