import { logEventTypeLabel, protocolKindLabel } from '@renderer/data/activity-display'
import { activityKindLabel } from '@renderer/data/activity-view-model'
import { outcomeKey, requestPurposeLabel, requestTokenTotal } from '@renderer/data/proxy-console'
import {
  type RequestFilter,
  type RequestTimelineItem,
  timelineAccountId,
  timelineModelValue,
  timelineOutcome,
  timelinePathText,
  timelinePurposeValue
} from './requests-model'
import type { PageProps } from './types'

export interface SelectOption {
  label: string
  value: string
}

export type SortDirection = 'asc' | 'desc'
export type RequestSortKey =
  | 'account'
  | 'duration'
  | 'model'
  | 'startedAt'
  | 'status'
  | 'summary'
  | 'tokens'
  | 'type'

export interface RequestSort {
  direction: SortDirection
  key: RequestSortKey
}

export function requestColumns(t: PageProps['t']): Array<{ key: RequestSortKey; label: string }> {
  return [
    { key: 'startedAt', label: t('table.time') },
    { key: 'type', label: t('table.type') },
    { key: 'summary', label: t('table.summary') },
    { key: 'account', label: t('table.accountId') },
    { key: 'model', label: t('table.model') },
    { key: 'status', label: t('table.result') },
    { key: 'tokens', label: t('table.usageQuota') },
    { key: 'duration', label: t('table.durationBytes') }
  ]
}

export function nextRequestSort(current: RequestSort, key: RequestSortKey): RequestSort {
  return {
    direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    key
  }
}

export function sortTimelineItems(
  items: RequestTimelineItem[],
  sort: RequestSort
): RequestTimelineItem[] {
  const direction = sort.direction === 'asc' ? 1 : -1
  return [...items].sort((left, right) => compareTimelineValue(left, right, sort.key) * direction)
}

export function timelineStatusClass(item: RequestTimelineItem): string {
  const outcome = timelineOutcome(item)
  if (outcome === 'forwarded') {
    return 'text-success'
  }
  if (outcome === 'quota_exhausted') {
    return 'text-warning'
  }
  if (outcome === 'failed' || outcome === 'rejected') {
    return 'text-destructive'
  }
  return 'text-muted-foreground'
}

export function timelineStatusText(item: RequestTimelineItem, t?: PageProps['t']): string {
  if (item.activity.statusText) {
    return item.activity.statusText
  }
  if (item.kind === 'request') {
    return item.request.statusCode
      ? String(item.request.statusCode)
      : (t?.(outcomeKey(item.request.outcome)) ?? item.request.outcome)
  }
  if (item.kind === 'protocol') {
    return t ? t('source.protocol') : 'WSS'
  }
  if (item.kind === 'turn') {
    return item.turn.status ?? (t ? t('requests.turnSummary') : 'turn')
  }
  return item.event.level.toUpperCase()
}

export function timelinePurposeLabel(item: RequestTimelineItem, t: PageProps['t']): string {
  return activityKindLabel(item.activity.kind, t)
}

export function timelineTokenSource(item: RequestTimelineItem, t: PageProps['t']): string {
  return item.activity.badges.join(' · ') || t('status.empty')
}

export function timelineTokenText(item: RequestTimelineItem, locale: PageProps['locale']): string {
  void locale
  return item.activity.metrics.join(' · ') || '-'
}

export function requestFilterOptionSets(
  items: RequestTimelineItem[],
  t: PageProps['t']
): {
  models: SelectOption[]
  purposes: SelectOption[]
} {
  const purposes = uniqueStrings(items.map(timelinePurposeValue))
    .sort((left, right) => purposeOptionLabel(left, t).localeCompare(purposeOptionLabel(right, t)))
    .map((value) => ({
      label: purposeOptionLabel(value, t),
      value
    }))
  const models = uniqueStrings(items.map(timelineModelValue))
    .sort()
    .map((model) => ({
      label: model,
      value: model
    }))
  return {
    models: [{ label: t('requests.allModels'), value: 'all' }, ...models],
    purposes: [{ label: t('requests.allPurposes'), value: 'all' }, ...purposes]
  }
}

export function requestFilterLabel(filter: RequestFilter, t: PageProps['t']): string {
  if (filter === 'all') {
    return t('requests.allOutcomes')
  }
  return t(outcomeKey(filter))
}

function compareTimelineValue(
  left: RequestTimelineItem,
  right: RequestTimelineItem,
  key: RequestSortKey
): number {
  if (key === 'startedAt') {
    return left.timestamp - right.timestamp
  }
  if (key === 'duration') {
    return timelineDurationMs(left) - timelineDurationMs(right)
  }
  if (key === 'tokens') {
    return timelineTokenTotal(left) - timelineTokenTotal(right)
  }
  return timelineSortText(left, key).localeCompare(timelineSortText(right, key))
}

function timelineSortText(item: RequestTimelineItem, key: RequestSortKey): string {
  if (key === 'account') {
    return timelineAccountId(item) ?? ''
  }
  if (key === 'model') {
    return timelineModelLabel(item)
  }
  if (key === 'summary') {
    return timelinePathText(item)
  }
  if (key === 'status') {
    return timelineStatusText(item)
  }
  if (key === 'type') {
    return item.activity.kind
  }
  return ''
}

function timelineDurationMs(item: RequestTimelineItem): number {
  return item.kind === 'request' ? item.request.durationMs : 0
}

function timelineTokenTotal(item: RequestTimelineItem): number {
  if (item.kind === 'request') {
    return requestTokenTotal(item.request)
  }
  if (item.kind === 'protocol') {
    return requestTokenTotal(item.message)
  }
  return item.kind === 'turn' ? requestTokenTotal(item.turn) : 0
}

export function timelineModelLabel(item: RequestTimelineItem): string {
  return timelineModelValue(item) || '-'
}

function purposeOptionLabel(value: string, t: PageProps['t']): string {
  if (value.startsWith('request:')) {
    const purpose = value.slice('request:'.length)
    return requestPurposeLabel(purpose === 'unknown' ? null : purpose, t)
  }
  if (value.startsWith('protocol:')) {
    return protocolKindLabel(value.slice('protocol:'.length), t)
  }
  if (value.startsWith('turn:')) {
    return t('requests.turnSummary')
  }
  const eventType = value.slice('event:'.length)
  return logEventTypeLabel(eventType, t)
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}
