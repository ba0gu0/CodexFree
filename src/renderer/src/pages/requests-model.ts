import type { ProtocolMessage, ProxyLogEvent, RecentRequest } from '@renderer/data/proxy-console'

export type RequestFilter = 'all' | 'forwarded' | 'quota_exhausted' | 'failed' | 'rejected'
export type RequestSelectFilter = 'all' | string
export type RequestTimelineItem =
  | {
      id: string
      kind: 'request'
      request: RecentRequest
      timestamp: number
    }
  | {
      event: ProxyLogEvent
      id: string
      kind: 'log'
      timestamp: number
    }
  | {
      id: string
      kind: 'protocol'
      message: ProtocolMessage
      timestamp: number
    }

export const requestOutcomeFilters: RequestFilter[] = [
  'all',
  'forwarded',
  'quota_exhausted',
  'failed',
  'rejected'
]

export function buildRequestTimeline(
  requests: RecentRequest[],
  events: ProxyLogEvent[],
  messages: ProtocolMessage[]
): RequestTimelineItem[] {
  return [
    ...requests.map(
      (request): RequestTimelineItem => ({
        id: `request:${request.id}`,
        kind: 'request',
        request,
        timestamp: request.startedAt
      })
    ),
    ...events
      .filter((event) => event.message !== 'WSS message')
      .map(
        (event): RequestTimelineItem => ({
          event,
          id: `log:${event.id}`,
          kind: 'log',
          timestamp: event.createdAt
        })
      ),
    ...messages.map(
      (message): RequestTimelineItem => ({
        id: `protocol:${message.id}`,
        kind: 'protocol',
        message,
        timestamp: message.createdAt
      })
    )
  ]
}

export function filterRequestTimeline(
  items: RequestTimelineItem[],
  outcomeFilter: RequestFilter,
  purposeFilter: RequestSelectFilter,
  modelFilter: RequestSelectFilter,
  query: string
): RequestTimelineItem[] {
  const normalized = query.trim().toLowerCase()
  return items.filter((item) => {
    const matchesOutcome = outcomeFilter === 'all' || timelineOutcome(item) === outcomeFilter
    const matchesPurpose = purposeFilter === 'all' || timelinePurposeValue(item) === purposeFilter
    const matchesModel = modelFilter === 'all' || timelineModelValue(item) === modelFilter
    if (!matchesOutcome || !matchesPurpose || !matchesModel) {
      return false
    }
    if (!normalized) {
      return true
    }
    return [...timelineSearchValues(item)]
      .filter(
        (value): value is number | string => typeof value === 'string' || typeof value === 'number'
      )
      .some((value) => String(value).toLowerCase().includes(normalized))
  })
}

export function timelineAccountId(item: RequestTimelineItem): string | null {
  if (item.kind === 'request') {
    return item.request.accountId
  }
  return item.kind === 'log' ? item.event.accountId : item.message.accountId
}

export function timelineModelValue(item: RequestTimelineItem): string {
  if (item.kind === 'request') {
    return item.request.responseModel ?? item.request.requestModel ?? ''
  }
  if (item.kind === 'protocol') {
    return item.message.model ?? ''
  }
  return stringDetail(item.event.detailJson, ['model', 'requestModel', 'responseModel'])
}

export function timelineOutcome(item: RequestTimelineItem): RequestFilter | 'log' {
  if (item.kind === 'request') {
    return item.request.outcome as RequestFilter
  }
  if (item.kind === 'protocol') {
    if (item.message.kind === 'rate_limit') {
      return 'quota_exhausted'
    }
    return item.message.kind === 'error' ? 'failed' : 'log'
  }
  const normalized = `${item.event.level} ${item.event.eventType ?? ''} ${item.event.message}`
    .toLowerCase()
    .trim()
  if (normalized.includes('quota') || normalized.includes('usage_limit_reached')) {
    return 'quota_exhausted'
  }
  if (normalized.includes('reject')) {
    return 'rejected'
  }
  return item.event.level === 'error' || item.event.level === 'warn' ? 'failed' : 'log'
}

export function timelinePathText(item: RequestTimelineItem): string {
  if (item.kind === 'request') {
    return `${item.request.method} ${item.request.path}`
  }
  if (item.kind === 'protocol') {
    return `${item.message.direction} · ${item.message.kind} · ${item.message.text}`
  }
  const path = item.event.path ? `${item.event.method ?? '-'} ${item.event.path}` : '-'
  return `${item.event.message}${path === '-' ? '' : ` · ${path}`}`
}

export function timelinePurposeValue(item: RequestTimelineItem): string {
  if (item.kind === 'request') {
    return `request:${item.request.requestPurpose ?? 'unknown'}`
  }
  if (item.kind === 'protocol') {
    return `protocol:${item.message.kind}`
  }
  return `event:${item.event.eventType ?? item.event.level}`
}

export function timelineRequestId(item: RequestTimelineItem): string | null {
  if (item.kind === 'request') {
    return item.request.id
  }
  return item.kind === 'log' ? item.event.requestId : item.message.requestId
}

function timelineSearchValues(item: RequestTimelineItem): Array<number | string | null> {
  if (item.kind === 'request') {
    const request = item.request
    return [
      request.method,
      request.path,
      request.accountId,
      request.conversationKey,
      request.outcome,
      request.statusCode,
      request.mode,
      request.upstreamHost,
      request.requestPurpose,
      request.requestContentType,
      request.responseContentType,
      request.requestBodyEncoding,
      request.requestModel,
      request.responseModel,
      request.rpcMethod,
      request.rpcId,
      request.tokenUsageSource,
      request.codexSessionId,
      request.codexThreadId,
      request.codexTurnId,
      request.codexVersion,
      request.codexRuntimeOs,
      request.codexRuntimeArch,
      request.userAgent,
      request.originator,
      request.analyticsEventTypes
    ]
  }
  if (item.kind === 'protocol') {
    return [
      item.message.accountId,
      item.message.conversationKey,
      item.message.direction,
      item.message.kind,
      item.message.model,
      item.message.path,
      item.message.previousResponseId,
      item.message.protocolType,
      item.message.requestId,
      item.message.responseId,
      item.message.sequenceNumber,
      item.message.text
    ]
  }
  return [
    item.event.message,
    item.event.level,
    item.event.eventType,
    item.event.method,
    item.event.path,
    item.event.accountId,
    item.event.conversationKey,
    item.event.requestId,
    item.event.detailJson
  ]
}

function stringDetail(detailJson: string | null, keys: string[]): string {
  if (!detailJson) {
    return ''
  }
  try {
    const parsed = JSON.parse(detailJson) as Record<string, unknown>
    for (const key of keys) {
      const value = parsed[key]
      if (typeof value === 'string' && value.length > 0) {
        return value
      }
    }
  } catch {
    return ''
  }
  return ''
}
