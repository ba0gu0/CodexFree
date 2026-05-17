import { formatDateTime, formatDuration, normalizePercent } from '@renderer/data/format'
import {
  accountDisplayForPathFromLookup,
  accountDisplayLookup,
  type ManagedAccount,
  outcomeKey
} from '@renderer/data/proxy-console'
import type { CopyKey } from '@renderer/i18n/copy'
import { useMemo } from 'react'
import type { PageProps } from './types'

export type ActivityFilter =
  | 'all'
  | 'request'
  | 'quota'
  | 'switch'
  | 'network'
  | 'auth'
  | 'error'
  | 'rejected'
export type ActivityKind =
  | 'request'
  | 'quota'
  | 'switch'
  | 'network'
  | 'auth'
  | 'error'
  | 'rejected'

export interface ActivityRow {
  account: string
  duration: string
  event: string
  id: string
  kind: ActivityKind
  status: string
  timestamp: number
  time: string
}

export const activityFilters: [ActivityFilter, CopyKey][] = [
  ['all', 'dashboard.filterAll'],
  ['request', 'dashboard.kindRequest'],
  ['quota', 'dashboard.filterQuota'],
  ['switch', 'dashboard.filterSwitch'],
  ['network', 'dashboard.filterNetwork'],
  ['auth', 'dashboard.filterAuth'],
  ['error', 'dashboard.filterError'],
  ['rejected', 'dashboard.filterRejected']
]

export function useActivityRows({ locale, snapshot, t }: PageProps): ActivityRow[] {
  return useMemo(() => {
    const pendingEmail = t('accounts.emailPending')
    const accountLabels = accountDisplayLookup(snapshot.accounts, pendingEmail)
    const requestRows = snapshot.requests.map((request): ActivityRow => {
      const account = accountDisplayForPathFromLookup(
        accountLabels,
        request.accountId,
        request.path,
        pendingEmail,
        t('accounts.originalAccount')
      )
      return {
        account,
        duration: formatDuration(request.durationMs, locale),
        event: `${request.method} ${request.path}`,
        id: request.id,
        kind: requestKind(request.outcome),
        status: request.statusCode ? String(request.statusCode) : t(outcomeKey(request.outcome)),
        timestamp: request.startedAt,
        time: formatDateTime(request.startedAt, locale)
      }
    })
    const eventRows = snapshot.logEvents.map((event): ActivityRow => {
      const account = accountDisplayForPathFromLookup(
        accountLabels,
        event.accountId,
        event.path,
        pendingEmail,
        t('accounts.originalAccount')
      )
      return {
        account,
        duration: '-',
        event: event.path ? `${event.message} · ${event.path}` : event.message,
        id: event.id,
        kind: logKind(event.level, event.message, event.eventType),
        status: event.level.toUpperCase(),
        timestamp: event.createdAt,
        time: formatDateTime(event.createdAt, locale)
      }
    })
    return [...requestRows, ...eventRows].sort((left, right) => right.timestamp - left.timestamp)
  }, [locale, snapshot.accounts, snapshot.logEvents, snapshot.requests, t])
}

export function typeLabel(kind: ActivityKind, t: PageProps['t']): string {
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
  const used =
    normalizePercent(account.primaryUsedPercent) ?? normalizePercent(account.secondaryUsedPercent)
  return used === undefined ? undefined : Math.max(0, Math.min(100, 100 - used))
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
