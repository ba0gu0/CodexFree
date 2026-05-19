import type { CopyKey, Locale } from '@renderer/i18n/copy'
import { formatBytes, normalizePercent } from './format'

export type Api = Window['api']
export type DaemonControlSettings = Awaited<ReturnType<Api['getDaemonControlSettings']>>
export type DaemonControlSaveInput = Parameters<Api['saveDaemonControlSettings']>[0]
export type ProxyConfig = Awaited<ReturnType<Api['getProxyConfig']>>
export type ProxyStatus = Awaited<ReturnType<Api['getProxyStatus']>>
export type ManagedAccount = Awaited<ReturnType<Api['getManagedAccounts']>>[number]
export type RequestSummary = Awaited<ReturnType<Api['getRequestSummary']>>
export type UsageSummary = Awaited<ReturnType<Api['getUsageSummary']>>
export type RecentRequest = Awaited<ReturnType<Api['getRecentRequests']>>['items'][number]
export type ProxyLogEvent = Awaited<ReturnType<Api['getProxyLogEvents']>>['items'][number]
export type ProtocolMessage = Awaited<ReturnType<Api['getProtocolMessages']>>['items'][number]
export type TurnSummary = Awaited<ReturnType<Api['getTurnSummaries']>>['items'][number]
export type UsageProgress = Parameters<Parameters<Api['onAccountUsageProgress']>[0]>[0]

export interface ConsoleActivityHasMore {
  logEvents: boolean
  protocolMessages: boolean
  requests: boolean
  turnSummaries: boolean
}

export interface ConsoleSnapshot {
  accounts: ManagedAccount[]
  config: ProxyConfig
  daemonControl: DaemonControlSettings
  logEvents: ProxyLogEvent[]
  managedAuthDirectory: string
  protocolMessages: ProtocolMessage[]
  requestSummary: RequestSummary
  requests: RecentRequest[]
  status: ProxyStatus
  turnSummaries: TurnSummary[]
  usageSummary: UsageSummary
  version: string
}

export interface MetricItem {
  key: string
  labelKey: CopyKey
  tone: 'default' | 'success' | 'warning' | 'error'
  value: string
}

export const outboundModes = ['direct', 'http', 'https', 'socks4', 'socks5'] as const
export type OutboundMode = (typeof outboundModes)[number]

export function dashboardMetrics(snapshot: ConsoleSnapshot): MetricItem[] {
  const active = snapshot.accounts.find((account) => account.active === 1)
  return [
    {
      key: 'proxy',
      labelKey: 'metric.proxy',
      tone: snapshot.status.running ? 'success' : 'warning',
      value: snapshot.status.running ? snapshot.status.endpoint : (snapshot.status.lastError ?? '-')
    },
    {
      key: 'active',
      labelKey: 'metric.activeAccount',
      tone: active ? 'success' : 'warning',
      value: active ? accountDisplayName(active) : '-'
    },
    {
      key: 'available',
      labelKey: 'metric.available',
      tone: 'success',
      value: String(snapshot.status.authPoolAvailableAccounts)
    },
    {
      key: 'exhausted',
      labelKey: 'metric.exhausted',
      tone: snapshot.status.authPoolExhaustedAccounts > 0 ? 'warning' : 'default',
      value: String(snapshot.status.authPoolExhaustedAccounts)
    },
    {
      key: 'requests',
      labelKey: 'metric.requests',
      tone:
        snapshot.requestSummary.failed + snapshot.requestSummary.rejected > 0
          ? 'warning'
          : 'default',
      value: String(snapshot.requestSummary.total)
    },
    {
      key: 'switches',
      labelKey: 'metric.switches',
      tone: switchEvents(snapshot.logEvents) > 0 ? 'success' : 'default',
      value: String(switchEvents(snapshot.logEvents))
    }
  ]
}

export function accountStatusKey(status: string): CopyKey {
  switch (status) {
    case 'available':
      return 'account.available'
    case 'exhausted':
      return 'account.exhausted'
    case 'disabled':
      return 'account.disabled'
    default:
      return 'account.unknown'
  }
}

export function outcomeKey(outcome: string): CopyKey {
  switch (outcome) {
    case 'forwarded':
      return 'outcome.forwarded'
    case 'rejected':
      return 'outcome.rejected'
    case 'quota_exhausted':
      return 'outcome.quota_exhausted'
    case 'failed':
      return 'outcome.failed'
    default:
      return 'status.empty'
  }
}

export function accountUsageSummary(account: ManagedAccount, locale: Locale): string {
  const primary = formatRemainingPercent(account.primaryUsedPercent, locale)
  const secondary = formatRemainingPercent(account.secondaryUsedPercent, locale)
  return `${primary} / ${secondary}`
}

function formatRemainingPercent(value: string | null | undefined, locale: Locale): string {
  const used = normalizePercent(value)
  if (used === undefined) {
    return '-'
  }
  const remaining = Math.max(0, Math.min(100, 100 - used))
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(remaining)}%`
}

export function requestPurposeLabel(
  purpose: string | null | undefined,
  t: (key: CopyKey, values?: Record<string, string | number>) => string
): string {
  const key = requestPurposeKey(purpose)
  return key ? t(key) : (purpose ?? t('status.empty'))
}

export function requestPurposeKey(purpose: string | null | undefined): CopyKey | null {
  switch (purpose) {
    case 'codex_wss':
      return 'purpose.codexWss'
    case 'codex_response_sse':
      return 'purpose.codexSse'
    case 'analytics_events':
      return 'purpose.analytics'
    case 'models':
      return 'purpose.models'
    case 'wham_apps':
      return 'purpose.whamApps'
    case 'account_usage':
      return 'purpose.accountUsage'
    case 'connector_directory':
      return 'purpose.connectors'
    case 'plugin_featured':
      return 'purpose.plugins'
    case 'api_key_compat':
      return 'purpose.apiKeyCompat'
    default:
      return null
  }
}

export function requestModelLabel(request: RecentRequest): string {
  return request.responseModel ?? request.requestModel ?? '-'
}

interface TokenUsageFields {
  cachedInputTokens: number | null
  inputTokens: number | null
  outputTokens: number | null
  reasoningTokens: number | null
  totalTokens: number | null
}

export function requestTokenTotal(request: TokenUsageFields): number {
  return request.totalTokens ?? 0
}

export function hasTokenUsage(request: TokenUsageFields): boolean {
  return (
    request.inputTokens !== null ||
    request.cachedInputTokens !== null ||
    request.outputTokens !== null ||
    request.reasoningTokens !== null ||
    request.totalTokens !== null
  )
}

export function tokenBreakdownText(request: TokenUsageFields, locale: Locale): string {
  if (!hasTokenUsage(request)) {
    return '-'
  }
  const format = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
  return [
    `I ${formatOptionalNumber(request.inputTokens, format)}`,
    `C ${formatOptionalNumber(request.cachedInputTokens, format)}`,
    `O ${formatOptionalNumber(request.outputTokens, format)}`,
    `R ${formatOptionalNumber(request.reasoningTokens, format)}`,
    `T ${formatOptionalNumber(request.totalTokens, format)}`
  ].join(' · ')
}

export function tokenUsageSourceLabel(
  source: string | null | undefined,
  t: (key: CopyKey, values?: Record<string, string | number>) => string
): string {
  if (source === 'protocol') {
    return t('source.protocol')
  }
  if (source === 'sse') {
    return t('source.sse')
  }
  if (source === 'analytics_event') {
    return t('source.analyticsEvent')
  }
  return source ?? '-'
}

export function requestByteSummary(request: RecentRequest, locale: Locale): string {
  return `${formatByteCount(request.requestBytes, locale)} / ${formatByteCount(request.responseBytes, locale)}`
}

export function accountDisplayName(account: ManagedAccount | undefined, pending = '-'): string {
  if (!account) {
    return '-'
  }
  if (account.email) {
    return account.email
  }
  if (!isSyntheticAccountLabel(account.label, account.accountId)) {
    return account.label
  }
  return pending
}

export function accountDisplayById(
  accounts: ManagedAccount[],
  accountId: string | null,
  pending = '-'
): string {
  if (!accountId) {
    return '-'
  }
  const account = accounts.find((item) => item.accountId === accountId)
  return account ? accountDisplayName(account, pending) : pending
}

export function accountDisplayLookup(
  accounts: ManagedAccount[],
  pending = '-'
): Map<string, string> {
  return new Map(
    accounts.map((account) => [account.accountId, accountDisplayName(account, pending)])
  )
}

export function accountDisplayForPath(
  accounts: ManagedAccount[],
  accountId: string | null,
  path: string | null | undefined,
  pending = '-',
  original = '-'
): string {
  if (isOriginalCodexAccountPath(path)) {
    return original
  }
  return accountDisplayById(accounts, accountId, pending)
}

export function accountDisplayForPathFromLookup(
  accounts: Map<string, string>,
  accountId: string | null,
  path: string | null | undefined,
  pending = '-',
  original = '-'
): string {
  if (isOriginalCodexAccountPath(path)) {
    return original
  }
  if (!accountId) {
    return '-'
  }
  return accounts.get(accountId) ?? pending
}

export function codexConfigText(status: ProxyStatus): string {
  return [
    `chatgpt_base_url = "${status.endpoint}"`,
    `openai_base_url = "${status.openaiBaseUrl}"`,
    'model_provider = "openai"'
  ].join('\n')
}

export function codexConfigRows(
  status: ProxyStatus
): Array<{ key: 'chatgpt_base_url' | 'openai_base_url' | 'model_provider'; value: string }> {
  return [
    { key: 'chatgpt_base_url', value: status.endpoint },
    { key: 'openai_base_url', value: status.openaiBaseUrl },
    { key: 'model_provider', value: 'openai' }
  ]
}

function switchEvents(events: ProxyLogEvent[]): number {
  return events.filter((event) => event.message.toLowerCase().includes('switch')).length
}

function isSyntheticAccountLabel(label: string, accountId: string): boolean {
  return (
    label === `codex:${accountId}` ||
    label === `cpa:${accountId}` ||
    label === `sub2api:${accountId}`
  )
}

export function isOriginalCodexAccountPath(path: string | null | undefined): boolean {
  if (!path) {
    return false
  }
  const pathname = path.split(/[?#]/, 1)[0]
  return pathname === '/backend-api/wham/remote' || pathname.startsWith('/backend-api/wham/remote/')
}

function formatOptionalNumber(value: number | null, format: Intl.NumberFormat): string {
  return value === null ? '-' : format.format(value)
}

function formatByteCount(value: number | null | undefined, locale: Locale): string {
  return value === 0 ? '0 B' : formatBytes(value, locale)
}
