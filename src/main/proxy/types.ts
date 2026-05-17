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
  runtime?: ProxyRuntimeStatus
}

export interface ProxyRuntimeStatus {
  activeWebSocketSessions: number
  cpuSystemMicros: number
  cpuUserMicros: number
  memoryRssBytes: number
  uptimeSeconds: number
}

export interface ProxyAccountSwitchResult {
  accountId?: string
  closedWebSockets: number
  switched: boolean
}

export interface ActivityPage<T> {
  hasMore: boolean
  items: T[]
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
  analyticsEventTypes?: string
  cachedInputTokens?: number
  codexRuntimeArch?: string
  codexRuntimeOs?: string
  codexSessionId?: string
  codexThreadId?: string
  codexTurnId?: string
  codexTurnStartedAt?: number
  codexVersion?: string
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  requestBodyEncoding?: string
  requestHeadersJson?: string
  responseHeadersJson?: string
  requestBodySample?: string
  responseBodySample?: string
  requestContentType?: string
  requestInputItemCount?: number
  requestModel?: string
  requestPurpose?: string
  responseActiveLimit?: string
  responseContentType?: string
  responseItemCount?: number
  responseModel?: string
  responsePlanType?: string
  responsePrimaryUsedPercent?: string
  responseRateLimitResetAt?: number
  rpcId?: string
  rpcMethod?: string
  tokenUsageSource?: string
  totalTokens?: number
  originator?: string
  userAgent?: string
  rawCapturePath?: string
  errorMessage?: string
  startedAt: Date
  completedAt: Date
}

export interface RecentRequest {
  id: string
  accountId: string | null
  conversationKey: string | null
  method: string
  mode: string
  path: string
  outcome: string
  statusCode: number | null
  durationMs: number
  requestBytes: number
  responseBytes: number
  requestPurpose: string | null
  requestModel: string | null
  responseModel: string | null
  responsePlanType: string | null
  responsePrimaryUsedPercent: string | null
  responseRateLimitResetAt: number | null
  responseActiveLimit: string | null
  responseItemCount: number | null
  requestInputItemCount: number | null
  rpcMethod: string | null
  analyticsEventTypes: string | null
  inputTokens: number | null
  cachedInputTokens: number | null
  outputTokens: number | null
  reasoningTokens: number | null
  totalTokens: number | null
  tokenUsageSource: string | null
  codexThreadId: string | null
  codexTurnId: string | null
  codexVersion: string | null
  streaming: number
  upstreamHost: string
  outboundMode: string
  rawCapturePath: string | null
  errorMessage: string | null
  startedAt: number
}
