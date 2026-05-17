import type { CopyKey, Locale } from '@renderer/i18n/copy'
import { formatPercent } from './format'

export type Api = Window['api']
export type DaemonControlSettings = Awaited<ReturnType<Api['getDaemonControlSettings']>>
export type DaemonControlSaveInput = Parameters<Api['saveDaemonControlSettings']>[0]
export type ProxyConfig = Awaited<ReturnType<Api['getProxyConfig']>>
export type ProxyStatus = Awaited<ReturnType<Api['getProxyStatus']>>
export type ManagedAccount = Awaited<ReturnType<Api['getManagedAccounts']>>[number]
export type RecentRequest = Awaited<ReturnType<Api['getRecentRequests']>>['items'][number]
export type ProxyLogEvent = Awaited<ReturnType<Api['getProxyLogEvents']>>['items'][number]
export type ProtocolMessage = Awaited<ReturnType<Api['getProtocolMessages']>>['items'][number]

export interface ConsoleActivityHasMore {
  logEvents: boolean
  protocolMessages: boolean
  requests: boolean
}

export interface ConsoleSnapshot {
  accounts: ManagedAccount[]
  config: ProxyConfig
  daemonControl: DaemonControlSettings
  logEvents: ProxyLogEvent[]
  managedAuthDirectory: string
  protocolMessages: ProtocolMessage[]
  requests: RecentRequest[]
  status: ProxyStatus
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
      tone: failedRequests(snapshot.requests) > 0 ? 'warning' : 'default',
      value: String(snapshot.requests.length)
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
  const primary = formatPercent(account.primaryUsedPercent, locale)
  const secondary = formatPercent(account.secondaryUsedPercent, locale)
  return `${primary} / ${secondary}`
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
    `openai_base_url = "${status.openaiBaseUrl}"`
  ].join('\n')
}

export function codexConfigRows(
  status: ProxyStatus
): Array<{ key: 'chatgpt_base_url' | 'openai_base_url'; value: string }> {
  return [
    { key: 'chatgpt_base_url', value: status.endpoint },
    { key: 'openai_base_url', value: status.openaiBaseUrl }
  ]
}

function failedRequests(requests: RecentRequest[]): number {
  return requests.filter(
    (request) => request.outcome === 'failed' || request.outcome === 'rejected'
  ).length
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
