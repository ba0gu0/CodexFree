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
  codexConfigMonitorEnabled: boolean
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

export interface RequestSummaryDto {
  captured: number
  failed: number
  forwarded: number
  purposeGroups: RequestPurposeSummaryDto[]
  quota: number
  rejected: number
  total: number
}

export interface RequestPurposeSummaryDto {
  count: number
  key: string
}

export interface UsageSummaryDto {
  accountGroups: UsageTokenGroupDto[]
  averageDurationMs: number | null
  dayGroups: UsageTokenGroupDto[]
  failed: number
  modelGroups: UsageTokenGroupDto[]
  requestBytes: number
  requestsWithUsage: number
  responseBytes: number
  sourceGroups: UsageTokenGroupDto[]
  successful: number
  tokenTotal: number
  total: number
  turnGroups: UsageTokenGroupDto[]
}

export interface UsageTokenGroupDto {
  cached: number
  count: number
  input: number
  key: string
  output: number
  reasoning: number
  total: number
}

export interface DaemonLaunchAgentSettingsDto {
  enabled: boolean
  label: string
  manager: 'launchd' | 'systemd' | 'windows-service' | 'unsupported'
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
  requestPurpose: string | null
  requestContentType: string | null
  responseContentType: string | null
  requestBodyEncoding: string | null
  requestModel: string | null
  responseModel: string | null
  responsePlanType: string | null
  responsePrimaryUsedPercent: string | null
  responseRateLimitResetAt: number | null
  responseActiveLimit: string | null
  responseItemCount: number | null
  requestInputItemCount: number | null
  rpcMethod: string | null
  rpcId: string | null
  analyticsEventTypes: string | null
  inputTokens: number | null
  cachedInputTokens: number | null
  outputTokens: number | null
  reasoningTokens: number | null
  totalTokens: number | null
  tokenUsageSource: string | null
  codexSessionId: string | null
  codexThreadId: string | null
  codexTurnId: string | null
  codexTurnStartedAt: number | null
  codexVersion: string | null
  codexRuntimeOs: string | null
  codexRuntimeArch: string | null
  userAgent: string | null
  originator: string | null
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
  cachedInputTokens: number | null
  conversationKey: string | null
  createdAt: number
  direction: string
  id: string
  inputItemCount: number | null
  inputTokens: number | null
  kind: string
  model: string | null
  outputTokens: number | null
  path: string
  payloadBytes: number | null
  previousResponseId: string | null
  protocolType: string | null
  reasoningTokens: number | null
  requestId: string
  responseId: string | null
  sequenceNumber: number | null
  text: string
  toolCount: number | null
  totalTokens: number | null
  truncated: number | null
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

export interface AccountUsageCheckProgressDto {
  accountId?: string
  completed: number
  ok?: boolean
  total: number
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

export interface CodexConfigWriteResultDto {
  path: string
  backupPath: string | null
}
