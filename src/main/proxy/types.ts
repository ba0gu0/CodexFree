export type OutboundProxyMode = 'direct' | 'http' | 'https' | 'socks4' | 'socks5'
export type ProxyRequestMode = 'account' | 'account_passthrough' | 'api_key' | 'unknown'
export type ProxyRequestOutcome = 'forwarded' | 'rejected' | 'quota_exhausted' | 'failed'

export interface OutboundProxyConfig {
  mode: OutboundProxyMode
  url: string
}

export interface AuthPoolConfig {
  enabled: boolean
  directory: string
}

export interface ProxyConfig {
  listenHost: string
  listenPort: number
  upstreamBaseUrl: string
  outboundProxy: OutboundProxyConfig
  authPool: AuthPoolConfig
  maxRequestBodyBytes: number
  rawCaptureEnabled: boolean
  rawCaptureMaxBytes: number
}

export interface ProxyStatus {
  running: boolean
  endpoint: string
  openaiBaseUrl: string
  openaiCompatibleEndpoint: string
  upstreamBaseUrl: string
  outboundMode: OutboundProxyMode
  authPoolEnabled: boolean
  authPoolAccounts: number
  authPoolAvailableAccounts: number
  authPoolExhaustedAccounts: number
  authPoolDisabledAccounts: number
  rawCaptureEnabled: boolean
  rawCaptureDir: string
  lastError?: string
}

export interface RequestLedgerEntry {
  id: string
  accountId?: string
  conversationKey?: string
  method: string
  path: string
  mode: ProxyRequestMode
  outcome: ProxyRequestOutcome
  statusCode?: number
  durationMs: number
  requestBytes: number
  responseBytes: number
  streaming: boolean
  upstreamHost: string
  outboundMode: OutboundProxyMode
  authHeaderPresent: boolean
  cookieHeaderPresent: boolean
  authFingerprint?: string
  cookieFingerprint?: string
  requestHeadersJson?: string
  responseHeadersJson?: string
  requestBodySample?: string
  responseBodySample?: string
  rawCapturePath?: string
  errorMessage?: string
  startedAt: Date
  completedAt: Date
}

export interface RecentRequest {
  id: string
  method: string
  path: string
  outcome: string
  statusCode: number | null
  durationMs: number
  streaming: number
  upstreamHost: string
  outboundMode: string
  rawCapturePath: string | null
  startedAt: number
}
