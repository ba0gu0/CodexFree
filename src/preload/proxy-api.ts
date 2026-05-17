export type OutboundProxyMode = 'direct' | 'http' | 'https' | 'socks4' | 'socks5'

export interface ProxyConfigDto {
  listenHost: string
  listenPort: number
  upstreamBaseUrl: string
  outboundProxy: {
    mode: OutboundProxyMode
    url: string
  }
  authPool: {
    enabled: boolean
    directory: string
  }
  maxRequestBodyBytes: number
  rawCaptureEnabled: boolean
  rawCaptureMaxBytes: number
}

export interface ProxyStatusDto {
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
  runtime?: ProxyRuntimeStatusDto
}

export interface ProxyRuntimeStatusDto {
  activeWebSocketSessions: number
  cpuSystemMicros: number
  cpuUserMicros: number
  memoryRssBytes: number
  uptimeSeconds: number
}

export interface DaemonLaunchAgentSettingsDto {
  enabled: boolean
  label: string
  plistPath: string | null
  programPath: string
  scriptPath: string
  supported: boolean
}

export interface DaemonControlSettingsDto {
  adminHost: string
  adminPort: number
  launchAgent: DaemonLaunchAgentSettingsDto
}

export interface DaemonControlSaveInputDto {
  adminHost: string
  adminPort: number
  adminToken?: string
  launchAgentEnabled?: boolean
}

export interface DaemonControlSaveResultDto {
  proxy?: ProxyStatusDto
  restarted: boolean
  settings: DaemonControlSettingsDto
}

export interface RecentRequestDto {
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
  streaming: number
  upstreamHost: string
  outboundMode: string
  rawCapturePath: string | null
  errorMessage: string | null
  startedAt: number
}

export interface ActivityPageDto<T> {
  hasMore: boolean
  items: T[]
}

export interface ProxyLogEventDto {
  accountId: string | null
  conversationKey: string | null
  createdAt: number
  detailJson: string | null
  eventType: string | null
  id: string
  level: string
  message: string
  method: string | null
  path: string | null
  requestId: string | null
}

export interface ProtocolMessageDto {
  accountId: string | null
  conversationKey: string | null
  createdAt: number
  direction: string
  id: string
  kind: string
  path: string
  requestId: string
  text: string
}

export interface RawCaptureFileDto {
  name: string
  size: number
  content: string
}

export interface RawCaptureDetailDto {
  requestId: string
  directory: string
  files: RawCaptureFileDto[]
}

export interface ManagedAccountDto {
  accountId: string
  label: string
  email: string | null
  fingerprint: string
  sourceFormat: string | null
  status: string
  exhaustedAt: number | null
  quotaResetAt: number | null
  planType: string | null
  primaryUsedPercent: string | null
  secondaryUsedPercent: string | null
  rateLimitResetsAt: number | null
  lastUsageCheckedAt: number | null
  lastUsageError: string | null
  active: number
  updatedAt: number
}

export interface AuthImportResultDto {
  imported: number
  skipped: number
  directory: string
  accounts: {
    accountId: string
    email?: string
    fingerprint: string
    label: string
    sourceFormat: string
    fileName: string
  }[]
  errors: {
    filePath: string
    message: string
  }[]
}

export interface AccountUsageCheckResultDto {
  accountId: string
  label: string
  email?: string
  ok: boolean
  statusCode?: number
  planType?: string
  primaryUsedPercent?: string
  secondaryUsedPercent?: string
  rateLimitResetsAt?: number
  lastRefresh: string
  error?: string
}

export interface AccountUsageCheckBatchDto {
  results: AccountUsageCheckResultDto[]
  accounts: ManagedAccountDto[]
}

export interface CleanExpiredAccountsDto {
  deletedAccounts: number
  deletedFiles: number
  accounts: ManagedAccountDto[]
}

export interface AuthExportResultDto {
  exported: number
}

export interface ResetExhaustedAccountsDto {
  resetAccounts: number
  accounts: ManagedAccountDto[]
  status: ProxyStatusDto
}

export interface SetAccountDisabledDto {
  updatedAccounts: number
  accounts: ManagedAccountDto[]
  status: ProxyStatusDto
}

export interface ClearProxyRecordsResultDto {
  deletedRequests: number
  deletedCaptureEntries: number
}

export interface PlaceholderAuthResultDto {
  path: string
  backedUp: boolean
  backupPath: string | null
}
