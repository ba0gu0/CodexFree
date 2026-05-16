import { describe, expect, it } from 'vitest'
import { classifyProxyRequest } from './classification'

const accountHeaders = {
  authorization: 'Bearer account-token',
  'chatgpt-account-id': 'account-id'
}

describe('proxy request classification', () => {
  it('allows known Codex account backend requests with account headers', () => {
    expect(classifyProxyRequest('/backend-api/codex/responses', accountHeaders)).toMatchObject({
      mode: 'account',
      allowed: true
    })
    expect(
      classifyProxyRequest('/backend-api/codex/responses/compact', accountHeaders)
    ).toMatchObject({
      mode: 'account',
      allowed: true
    })
    expect(
      classifyProxyRequest('/backend-api/ps/plugins/installed?scope=WORKSPACE', accountHeaders)
    ).toMatchObject({
      mode: 'account',
      allowed: true
    })
  })

  it('does not treat v1 paths as account-login proxy routes', () => {
    expect(classifyProxyRequest('/v1/models?client_version=0.130.0', accountHeaders)).toMatchObject(
      {
        mode: 'account',
        allowed: false,
        statusCode: 404,
        errorCode: 'unknown_account_backend_path'
      }
    )
  })

  it('allows new ChatGPT backend-api paths by default', () => {
    expect(
      classifyProxyRequest('/backend-api/new/codex/path?probe=1', accountHeaders)
    ).toMatchObject({
      mode: 'account_passthrough',
      allowed: true
    })
  })

  it('rejects API-key mode before forwarding', () => {
    expect(
      classifyProxyRequest('/backend-api/codex/responses', {
        authorization: 'Bearer sk-test',
        'chatgpt-account-id': 'account-id'
      })
    ).toMatchObject({
      mode: 'api_key',
      allowed: false,
      statusCode: 403,
      errorCode: 'api_key_mode_not_supported'
    })
  })

  it('rejects unknown account backend paths', () => {
    expect(classifyProxyRequest('/v1/chat/completions', accountHeaders)).toMatchObject({
      mode: 'account',
      allowed: false,
      statusCode: 404,
      errorCode: 'unknown_account_backend_path'
    })
  })

  it('rejects known paths that do not carry account auth headers', () => {
    expect(classifyProxyRequest('/backend-api/codex/models', {})).toMatchObject({
      mode: 'unknown',
      allowed: false,
      statusCode: 401,
      errorCode: 'missing_account_auth_headers'
    })
  })
})
