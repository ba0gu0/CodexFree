import type { IncomingHttpHeaders } from 'node:http'
import { firstHeaderValue } from './redaction'
import type { ProxyRequestMode } from './types'

export interface ProxyRequestClassification {
  mode: ProxyRequestMode
  allowed: boolean
  statusCode?: number
  errorCode?: string
}

const accountBackendPaths = new Set([
  '/backend-api/codex/analytics-events/events',
  '/backend-api/codex/models',
  '/backend-api/codex/responses',
  '/backend-api/codex/responses/compact',
  '/backend-api/connectors/directory/list',
  '/backend-api/plugins/featured',
  '/backend-api/ps/plugins/installed',
  '/backend-api/wham/apps',
  '/backend-api/wham/usage'
])

export function classifyProxyRequest(
  requestUrl: string,
  headers: IncomingHttpHeaders
): ProxyRequestClassification {
  const authorization = firstHeaderValue(headers.authorization)
  const accountId = firstHeaderValue(headers['chatgpt-account-id'])
  const pathType = classifyAccountPath(requestUrl)

  if (authorization?.toLowerCase().startsWith('bearer sk-')) {
    return {
      mode: 'api_key',
      allowed: false,
      statusCode: 403,
      errorCode: 'api_key_mode_not_supported'
    }
  }

  if (pathType === 'unknown') {
    return {
      mode: authorization ? 'account' : 'unknown',
      allowed: false,
      statusCode: 404,
      errorCode: 'unknown_account_backend_path'
    }
  }

  if (!authorization || !accountId) {
    return {
      mode: 'unknown',
      allowed: false,
      statusCode: 401,
      errorCode: 'missing_account_auth_headers'
    }
  }

  return { mode: pathType === 'known' ? 'account' : 'account_passthrough', allowed: true }
}

function classifyAccountPath(requestUrl: string): 'known' | 'passthrough' | 'unknown' {
  const url = new URL(requestUrl, 'http://codexfree.local')
  if (accountBackendPaths.has(url.pathname)) {
    return 'known'
  }
  if (url.pathname.startsWith('/backend-api/')) {
    return 'passthrough'
  }
  return 'unknown'
}
