import {
  type ActivityViewContext,
  type ActivityViewModel,
  activitySearchValues,
  logActivityViewModel,
  protocolActivityViewModel,
  requestActivityViewModel,
  turnActivityViewModel
} from '@renderer/data/activity-view-model'
import type {
  ProtocolMessage,
  ProxyLogEvent,
  RecentRequest,
  TurnSummary
} from '@renderer/data/proxy-console'

export type RequestFilter = 'all' | 'forwarded' | 'quota_exhausted' | 'failed' | 'rejected'
export type RequestSelectFilter = 'all' | string
interface RequestTimelineBase {
  activity: ActivityViewModel
  id: string
  timestamp: number
}

export type RequestTimelineItem =
  | (RequestTimelineBase & {
      kind: 'request'
      request: RecentRequest
    })
  | (RequestTimelineBase & {
      event: ProxyLogEvent
      kind: 'log'
    })
  | (RequestTimelineBase & {
      kind: 'protocol'
      message: ProtocolMessage
    })
  | (RequestTimelineBase & {
      kind: 'turn'
      turn: TurnSummary
    })

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
  messages: ProtocolMessage[],
  turns: TurnSummary[] = [],
  context: ActivityViewContext
): RequestTimelineItem[] {
  const meaningfulTurns = turns.filter(isMeaningfulTurn)
  const messagesInTurns = messages.filter((message) =>
    meaningfulTurns.some((turn) => matchesTurn(message, turn))
  )
  const orphanMessages = messages.filter(
    (message) =>
      !requests.some((request) => matchesRequest(message, request)) &&
      !meaningfulTurns.some((turn) => matchesTurn(message, turn))
  )
  const visibleRequests = requests.filter((request) =>
    isVisibleRequestParent(request, meaningfulTurns)
  )
  return [
    ...meaningfulTurns.map((turn): RequestTimelineItem => {
      const children = messagesInTurns
        .filter((message) => matchesTurn(message, turn))
        .map((message) => protocolActivityViewModel(message, context))
        .sort(compareActivityId)
      const activity = turnActivityViewModel(turn, context, children)
      return {
        activity,
        id: activity.id,
        kind: 'turn',
        timestamp: turn.updatedAt,
        turn
      }
    }),
    ...visibleRequests.map((request): RequestTimelineItem => {
      const children = [
        ...messages
          .filter((message) => matchesRequest(message, request))
          .filter((message) => !messagesInTurns.includes(message))
          .map((message) => protocolActivityViewModel(message, context)),
        ...events
          .filter((event) => matchesRequest(event, request))
          .map((event) => logActivityViewModel(event, context)),
        ...meaningfulTurns
          .filter((turn) => matchesRequest(turn, request))
          .filter((turn) => !isCodexStreamRequest(request, turn))
          .map((turn) => turnActivityViewModel(turn, context))
      ].sort(compareActivityId)
      const activity = requestActivityViewModel(request, context, children)
      return {
        activity,
        id: activity.id,
        kind: 'request',
        request,
        timestamp: request.startedAt
      }
    }),
    ...events
      .filter((event) => isTopLevelLogEvent(event, visibleRequests))
      .map((event): RequestTimelineItem => {
        const activity = logActivityViewModel(event, context)
        return {
          activity,
          event,
          id: activity.id,
          kind: 'log',
          timestamp: event.createdAt
        }
      }),
    ...orphanMessages.filter(isVisibleProtocolParent).map((message): RequestTimelineItem => {
      const activity = protocolActivityViewModel(message, context)
      return {
        activity,
        id: activity.id,
        kind: 'protocol',
        message,
        timestamp: message.createdAt
      }
    })
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
  if (item.kind === 'turn') {
    return item.turn.accountId
  }
  return item.kind === 'log' ? item.event.accountId : item.message.accountId
}

export function timelineModelValue(item: RequestTimelineItem): string {
  if (item.activity.model) {
    return item.activity.model
  }
  if (item.kind === 'request') {
    return item.request.responseModel ?? item.request.requestModel ?? ''
  }
  if (item.kind === 'protocol') {
    return item.message.model ?? ''
  }
  if (item.kind === 'turn') {
    return ''
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
  if (item.kind === 'turn') {
    return item.turn.status === 'error' ? 'failed' : 'forwarded'
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
  return [item.activity.title, item.activity.subtitle, item.activity.detail].join(' ')
}

export function timelinePurposeValue(item: RequestTimelineItem): string {
  if (item.kind === 'request') {
    return `request:${item.request.requestPurpose ?? 'unknown'}`
  }
  if (item.kind === 'protocol') {
    return `protocol:${item.message.kind}`
  }
  if (item.kind === 'turn') {
    return 'turn:summary'
  }
  return `event:${item.event.eventType ?? item.event.level}`
}

export function timelineRequestId(item: RequestTimelineItem): string | null {
  if (item.kind === 'request') {
    return item.request.id
  }
  if (item.kind === 'turn') {
    return item.turn.requestId
  }
  return item.kind === 'log' ? item.event.requestId : item.message.requestId
}

function timelineSearchValues(item: RequestTimelineItem): Array<number | string | null> {
  const activityValues = activitySearchValues(item.activity)
  if (item.kind === 'request') {
    const request = item.request
    return [
      ...activityValues,
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
      ...activityValues,
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
  if (item.kind === 'turn') {
    return [
      ...activityValues,
      item.turn.accountId,
      item.turn.assistantText,
      item.turn.conversationKey,
      item.turn.parentResponseId,
      item.turn.requestId,
      item.turn.responseId,
      item.turn.status,
      item.turn.summaryJson,
      item.turn.turnKey,
      item.turn.userText
    ]
  }
  return [
    ...activityValues,
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

function matchesRequest(
  item: ProtocolMessage | ProxyLogEvent | TurnSummary,
  request: RecentRequest
): boolean {
  if (item.requestId === request.id) {
    return true
  }
  return Boolean(item.conversationKey && item.conversationKey === request.conversationKey)
}

function matchesTurn(message: ProtocolMessage, turn: TurnSummary): boolean {
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

function isMeaningfulTurn(turn: TurnSummary): boolean {
  const hasConversation =
    hasText(turn.assistantText) || turn.toolCallCount > 0 || turn.toolResultCount > 0
  if (hasConversation) {
    return true
  }
  return hasText(turn.userText) && !turn.userText?.startsWith('发起模型请求:')
}

function isVisibleRequestParent(request: RecentRequest, turns: TurnSummary[]): boolean {
  if (request.outcome !== 'forwarded') {
    return true
  }
  if (!['codex_wss', 'codex_response_sse'].includes(request.requestPurpose ?? '')) {
    return true
  }
  return !turns.some((turn) => turn.requestId === request.id)
}

function isCodexStreamRequest(request: RecentRequest, turn: TurnSummary): boolean {
  if (request.id !== turn.requestId) {
    return false
  }
  return request.requestPurpose === 'codex_wss' || request.requestPurpose === 'codex_response_sse'
}

function isVisibleProtocolParent(message: ProtocolMessage): boolean {
  return message.kind === 'error' || message.kind === 'rate_limit'
}

function isVisibleLogEvent(event: ProxyLogEvent): boolean {
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

function isTopLevelLogEvent(event: ProxyLogEvent, visibleRequests: RecentRequest[]): boolean {
  if (!isVisibleLogEvent(event)) {
    return false
  }
  return !visibleRequests.some((request) => matchesRequest(event, request))
}

function hasText(value: string | null): boolean {
  return Boolean(value?.trim())
}

function compareActivityId(left: ActivityViewModel, right: ActivityViewModel): number {
  return left.id.localeCompare(right.id)
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
