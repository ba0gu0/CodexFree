export type OutboundProxyMode = 'direct' | 'http' | 'https' | 'socks4' | 'socks5'

export interface OutboundProxyConfig {
  mode: OutboundProxyMode
  url: string
}

export interface ProxyConfig {
  listenHost: string
  listenPort: number
  upstreamBaseUrl: string
  outboundProxy: OutboundProxyConfig
  rawCaptureEnabled: boolean
  rawCaptureMaxBytes: number
}

export interface ProxyStatus {
  running: boolean
  endpoint: string
  upstreamBaseUrl: string
  outboundMode: OutboundProxyMode
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
  mode: 'account' | 'api_key' | 'unknown'
  outcome: 'forwarded' | 'rejected' | 'quota_exhausted' | 'failed'
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
