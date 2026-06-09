import { isInstalledPluginsPath } from '@renderer/data/activity-view-helpers'
import {
  type ActivityViewContext,
  type ActivityViewModel,
  logActivityViewModel,
  protocolActivityViewModel,
  requestActivityViewModel,
  turnActivityViewModel
} from '@renderer/data/activity-view-model'
import { formatDateTime, formatDuration } from '@renderer/data/format'
import {
  accountDisplayForPathFromLookup,
  accountDisplayLookup,
  type ManagedAccount
} from '@renderer/data/proxy-console'
import type { CopyKey } from '@renderer/i18n/copy'
import { useMemo } from 'react'
import { accountRemainingQuotaPercent } from './accounts-model'
import type { PageProps } from './types'

export type ActivityFilter =
  | 'all'
  | 'dialogue'
  | 'tool'
  | 'request'
  | 'quota'
  | 'switch'
  | 'network'
  | 'auth'
  | 'error'
  | 'rejected'
export type ActivityKind =
  | 'dialogue'
  | 'tool'
  | 'request'
  | 'quota'
  | 'switch'
  | 'network'
  | 'auth'
  | 'error'
  | 'rejected'

export interface ActivityRow {
  account: string
  detail: string
  duration: string
  event: string
  id: string
  kind: ActivityKind
  tags: ActivityFilter[]
  status: string
  timestamp: number
  time: string
}

export const activityFilters: [ActivityFilter, CopyKey][] = [
  ['all', 'dashboard.filterAll'],
  ['dialogue', 'dashboard.filterDialogue'],
  ['request', 'dashboard.kindRequest'],
  ['switch', 'dashboard.filterSwitch'],
  ['network', 'dashboard.filterNetwork'],
  ['error', 'dashboard.filterError']
]

export function useActivityRows({ locale, snapshot, t }: PageProps): ActivityRow[] {
  return useMemo(() => {
    const pendingEmail = t('accounts.emailPending')
    const accountLabels = accountDisplayLookup(snapshot.accounts, pendingEmail)
    const context: ActivityViewContext = { accountLabels, locale, t }
    const turnRows = snapshot.turnSummaries.filter(isMeaningfulTurn).map((turn): ActivityRow => {
      const view = turnActivityViewModel(turn, context)
      return viewRow(view, {
        duration: '-',
        fallbackAccount: accountDisplayForPathFromLookup(
          accountLabels,
          turn.accountId,
          null,
          pendingEmail,
          t('accounts.originalAccount')
        ),
        id: `turn:${turn.id}`,
        kind: 'dialogue',
        locale,
        tags: turn.toolCallCount > 0 ? ['dialogue', 'tool'] : ['dialogue'],
        timestamp: turn.updatedAt
      })
    })
    const coveredMessageIds = new Set(
      snapshot.protocolMessages
        .filter((message) => snapshot.turnSummaries.some((turn) => matchesTurn(message, turn)))
        .map((message) => message.id)
    )
    const protocolRows = snapshot.protocolMessages
      .filter((message) => !isWhamAppsPath(message.path))
      .filter((message) => !isOverviewHiddenPath(message.path))
      .filter((message) => !coveredMessageIds.has(message.id))
      .filter(isDashboardProtocolMessage)
      .map((message): ActivityRow => {
        const view = protocolActivityViewModel(message, context)
        return viewRow(view, {
          duration: '-',
          fallbackAccount: accountDisplayForPathFromLookup(
            accountLabels,
            message.accountId,
            message.path,
            pendingEmail,
            t('accounts.originalAccount')
          ),
          id: `protocol:${message.id}`,
          kind: view.kind === 'tool' ? 'tool' : requestKindFromActivity(view.kind),
          locale,
          tags: tagsForActivityKind(view.kind),
          timestamp: message.createdAt
        })
      })
    const requestRows = snapshot.requests
      .filter((request) => !isWhamAppsPath(request.path))
      .filter((request) => !isOverviewHiddenPath(request.path))
      .map((request): ActivityRow => {
        const view = requestActivityViewModel(request, context)
        return viewRow(view, {
          duration: formatDuration(request.durationMs, locale),
          fallbackAccount: accountDisplayForPathFromLookup(
            accountLabels,
            request.accountId,
            request.path,
            pendingEmail,
            t('accounts.originalAccount')
          ),
          id: `request:${request.id}`,
          includeInAll: !isLowValueRequest(request),
          kind: requestKind(request.outcome),
          locale,
          tags: tagsForRequest(request.outcome),
          timestamp: request.startedAt
        })
      })
    const eventRows = snapshot.logEvents
      .filter((event) => !isWhamAppsPath(event.path))
      .filter((event) => !isOverviewHiddenPath(event.path))
      .filter(isVisibleLogEvent)
      .map((event): ActivityRow => {
        const view = logActivityViewModel(event, context)
        const kind = logKind(event.level, event.message, event.eventType)
        return viewRow(view, {
          duration: '-',
          fallbackAccount: accountDisplayForPathFromLookup(
            accountLabels,
            event.accountId,
            event.path,
            pendingEmail,
            t('accounts.originalAccount')
          ),
          id: `event:${event.id}`,
          kind,
          locale,
          tags: tagsForLogKind(kind),
          timestamp: event.createdAt
        })
      })
    return [...turnRows, ...protocolRows, ...requestRows, ...eventRows].sort(
      (left, right) => right.timestamp - left.timestamp
    )
  }, [
    locale,
    snapshot.accounts,
    snapshot.logEvents,
    snapshot.protocolMessages,
    snapshot.requests,
    snapshot.turnSummaries,
    t
  ])
}

export function typeLabel(kind: ActivityKind, t: PageProps['t']): string {
  if (kind === 'dialogue') {
    return t('dashboard.filterDialogue')
  }
  if (kind === 'tool') {
    return t('dashboard.filterTool')
  }
  if (kind === 'quota') {
    return t('dashboard.filterQuota')
  }
  if (kind === 'switch') {
    return t('dashboard.filterSwitch')
  }
  if (kind === 'network') {
    return t('dashboard.filterNetwork')
  }
  if (kind === 'auth') {
    return t('dashboard.filterAuth')
  }
  if (kind === 'error') {
    return t('dashboard.filterError')
  }
  if (kind === 'rejected') {
    return t('dashboard.filterRejected')
  }
  return t('dashboard.kindRequest')
}

export function rowTone(kind: ActivityKind): string {
  if (kind === 'dialogue') {
    return 'bg-primary/12 text-primary'
  }
  if (kind === 'tool') {
    return 'bg-info/12 text-info'
  }
  if (kind === 'quota') {
    return 'bg-warning/12 text-warning'
  }
  if (kind === 'switch') {
    return 'bg-info/12 text-info'
  }
  if (kind === 'network') {
    return 'bg-destructive/12 text-destructive'
  }
  if (kind === 'auth') {
    return 'bg-warning/12 text-warning'
  }
  if (kind === 'error' || kind === 'rejected') {
    return 'bg-destructive/12 text-destructive'
  }
  return 'bg-muted/60 text-foreground'
}

export function kindClass(kind: ActivityKind): string {
  if (kind === 'dialogue') {
    return 'text-primary'
  }
  if (kind === 'tool') {
    return 'text-info'
  }
  if (kind === 'quota') {
    return 'text-warning'
  }
  if (kind === 'switch') {
    return 'text-info'
  }
  if (kind === 'network') {
    return 'text-destructive'
  }
  if (kind === 'auth') {
    return 'text-warning'
  }
  if (kind === 'error' || kind === 'rejected') {
    return 'text-destructive'
  }
  return 'text-success'
}

export function remainingQuota(account: ManagedAccount | undefined): number | undefined {
  if (!account) {
    return undefined
  }
  if (!account.primaryUsedPercent && !account.secondaryUsedPercent) {
    return undefined
  }
  return accountRemainingQuotaPercent(account)
}

export function listenValue(endpoint: string): string {
  if (URL.canParse(endpoint)) {
    return new URL(endpoint).host
  }
  return endpoint
}

function requestKind(outcome: string): ActivityKind {
  if (outcome === 'quota_exhausted') {
    return 'quota'
  }
  if (outcome === 'rejected') {
    return 'rejected'
  }
  return outcome === 'failed' ? 'error' : 'request'
}

function requestKindFromActivity(kind: ActivityViewModel['kind']): ActivityKind {
  if (kind === 'quota') {
    return 'quota'
  }
  if (kind === 'tool') {
    return 'tool'
  }
  return kind === 'auth' ? 'auth' : 'request'
}

function logKind(level: string, message: string, eventType: string | null): ActivityKind {
  if (eventType === 'quota') {
    return 'quota'
  }
  if (eventType === 'account_switch') {
    return 'switch'
  }
  if (eventType === 'network') {
    return 'network'
  }
  if (eventType === 'auth') {
    return 'auth'
  }
  if (eventType === 'request' || eventType === 'system') {
    return 'request'
  }
  const normalized = `${level} ${message}`.toLowerCase()
  if (normalized.includes('quota') || normalized.includes('exhaust')) {
    return 'quota'
  }
  if (
    normalized.includes('usage_limit_reached') ||
    normalized.includes('limit reached') ||
    normalized.includes('额度')
  ) {
    return 'quota'
  }
  if (
    normalized.includes('switch') ||
    normalized.includes('active account selected') ||
    normalized.includes('切换')
  ) {
    return 'switch'
  }
  if (
    normalized.includes('network') ||
    normalized.includes('timeout') ||
    normalized.includes('econn') ||
    normalized.includes('socket hang up') ||
    normalized.includes('fetch failed') ||
    normalized.includes('connection refused') ||
    normalized.includes('连接失败')
  ) {
    return 'network'
  }
  if (normalized.includes('auth') || normalized.includes('401') || normalized.includes('token')) {
    return 'auth'
  }
  if (normalized.includes('reject')) {
    return 'rejected'
  }
  return level === 'error' || level === 'warn' ? 'error' : 'request'
}

function viewRow(
  view: ActivityViewModel,
  options: {
    duration: string
    fallbackAccount: string
    id: string
    includeInAll?: boolean
    kind: ActivityKind
    locale: PageProps['locale']
    tags: ActivityFilter[]
    timestamp: number
  }
): ActivityRow {
  return {
    account: view.account ?? options.fallbackAccount,
    detail: compactDetail(view),
    duration: options.duration,
    event: view.title,
    id: options.id,
    kind: options.kind,
    status: view.statusText,
    tags: options.includeInAll === false ? options.tags : ['all', ...options.tags],
    timestamp: options.timestamp,
    time: formatDateTime(options.timestamp, options.locale)
  }
}

function compactDetail(view: ActivityViewModel): string {
  const parts = [view.subtitle, view.detail, ...view.metrics].filter(Boolean)
  const compacted = parts.filter((part, index) => {
    const previous = parts.slice(0, index)
    return !previous.some((item) => item === part || item.includes(part))
  })
  return compacted.join(' · ') || '-'
}

function isLowValueRequest(request: {
  outcome: string
  path: string
  requestPurpose: string | null
}): boolean {
  if (request.outcome !== 'forwarded') {
    return false
  }
  if (request.path === '/backend-api/wham/remote/control/server') {
    return true
  }
  return [
    'analytics_events',
    'connector_directory',
    'plugin_featured',
    'plugin_installed',
    'codex_wss',
    'codex_response_sse'
  ].includes(request.requestPurpose ?? '')
}

function isWhamAppsPath(path: string | null): boolean {
  return path?.includes('/backend-api/wham/apps') ?? false
}

export function isOverviewHiddenPath(path: string | null): boolean {
  return isInstalledPluginsPath(path)
}

function isDashboardProtocolMessage(message: { kind: string }): boolean {
  return message.kind === 'error' || message.kind === 'rate_limit'
}

function isMeaningfulTurn(turn: {
  assistantText: string | null
  toolCallCount: number
  toolResultCount: number
  userText: string | null
}): boolean {
  if (turn.assistantText?.trim() || turn.toolCallCount > 0 || turn.toolResultCount > 0) {
    return true
  }
  return Boolean(turn.userText?.trim() && !turn.userText.startsWith('发起模型请求:'))
}

function matchesTurn(
  message: {
    conversationKey: string | null
    previousResponseId: string | null
    requestId: string | null
    responseId: string | null
  },
  turn: {
    conversationKey: string | null
    parentResponseId: string | null
    requestId: string
    responseId: string | null
  }
): boolean {
  if (message.requestId && message.requestId === turn.requestId) {
    return true
  }
  if (message.responseId && message.responseId === turn.responseId) {
    return true
  }
  if (message.previousResponseId && message.previousResponseId === turn.responseId) {
    return true
  }
  if (message.responseId && message.responseId === turn.parentResponseId) {
    return true
  }
  return Boolean(message.conversationKey && message.conversationKey === turn.conversationKey)
}

function tagsForActivityKind(kind: ActivityViewModel['kind']): ActivityFilter[] {
  if (kind === 'tool') {
    return ['tool']
  }
  if (kind === 'quota') {
    return ['quota']
  }
  if (kind === 'auth') {
    return ['auth']
  }
  return ['request']
}

function tagsForRequest(outcome: string): ActivityFilter[] {
  return [requestKind(outcome)]
}

function tagsForLogKind(kind: ActivityKind): ActivityFilter[] {
  return [kind]
}

function isVisibleLogEvent(event: { eventType: string | null; level: string }): boolean {
  if (event.level === 'error' || event.level === 'warn') {
    return true
  }
  return (
    event.eventType === 'account_switch' ||
    event.eventType === 'auth' ||
    event.eventType === 'quota' ||
    event.eventType === 'system'
  )
}
