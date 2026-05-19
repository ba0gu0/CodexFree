import type { Locale } from '@renderer/i18n/copy'
import {
  bytePair,
  bytesFromSummary,
  cleanText,
  compactRatio,
  compactStrings,
  compactUniqueStrings,
  formatNumber,
  kindBadgeForRequest,
  logActivityKind,
  logTypeLabel,
  outcomeKey,
  parseJsonObject,
  protocolActivityKind,
  protocolDirection,
  protocolGroupKey,
  protocolKindBadge,
  protocolStatusText,
  quotaMetric,
  quoteShort,
  remainingText,
  requestGroupKey,
  requestMetric,
  routeName,
  stringField,
  stringList,
  type Translator,
  toolArgument,
  toolName,
  turnGroupKey,
  userTextFromProtocol
} from './activity-view-helpers'
import { formatBytes, formatDuration, truncateMiddle } from './format'
import {
  accountDisplayForPathFromLookup,
  type ProtocolMessage,
  type ProxyLogEvent,
  type RecentRequest,
  type TurnSummary,
  tokenBreakdownText
} from './proxy-console'

export type ActivityKind =
  | 'auth'
  | 'http'
  | 'quota'
  | 'sse'
  | 'system'
  | 'tool'
  | 'turn'
  | 'usage'
  | 'wss'

export interface ActivityViewModel {
  account?: string
  badges: string[]
  children?: ActivityViewModel[]
  detail: string
  groupKey?: string
  id: string
  kind: ActivityKind
  metrics: string[]
  model?: string
  statusText: string
  subtitle: string
  title: string
}

export interface ActivityViewContext {
  accountLabels: Map<string, string>
  locale: Locale
  t: Translator
}

export function requestActivityViewModel(
  request: RecentRequest,
  context: ActivityViewContext,
  children: ActivityViewModel[] = []
): ActivityViewModel {
  const summary = parseJsonObject(request.summaryJson)
  const account = accountLabel(context, request.accountId, request.path)
  const model = request.responseModel ?? request.requestModel ?? stringField(summary, 'model')
  const route = routeName(request)
  const statusText = request.statusCode
    ? String(request.statusCode)
    : context.t(outcomeKey(request.outcome))
  const metrics = compactStrings([
    requestMetric(request, context.locale),
    quotaMetric(request, summary, context.t, context.locale),
    request.durationMs > 0 ? formatDuration(request.durationMs, context.locale) : undefined,
    bytePair(request.requestBytes, request.responseBytes, context.locale)
  ])
  const base = {
    account,
    badges: compactUniqueStrings([kindBadgeForRequest(request, context.t), request.mode]),
    children,
    detail: request.path,
    groupKey: requestGroupKey(request),
    id: `request:${request.id}`,
    metrics: compactUniqueStrings(metrics),
    model,
    statusText,
    subtitle: requestSubtitle(request, summary, context),
    title: requestTitle(request, summary, account, model, statusText, context)
  }
  if (request.requestPurpose === 'account_usage') {
    return { ...base, kind: 'usage' }
  }
  if (request.requestPurpose === 'codex_wss') {
    return { ...base, kind: 'wss' }
  }
  if (request.requestPurpose === 'codex_response_sse') {
    return { ...base, kind: 'sse' }
  }
  return { ...base, kind: 'http', title: base.title || `${route} · ${statusText}` }
}

export function protocolActivityViewModel(
  message: ProtocolMessage,
  context: ActivityViewContext,
  children: ActivityViewModel[] = []
): ActivityViewModel {
  const summary = parseJsonObject(message.summaryJson)
  const account = accountLabel(context, message.accountId, message.path)
  const model = message.model ?? stringField(summary, 'model')
  const tool = toolName(message, summary)
  const argument = toolArgument(message, summary)
  const statusText = protocolStatusText(message, context.t)
  return {
    account,
    badges: compactUniqueStrings([
      protocolKindBadge(message.kind, context.t),
      protocolDirection(message, context.t)
    ]),
    children,
    detail: message.text || message.protocolType || message.path,
    groupKey: protocolGroupKey(message),
    id: `protocol:${message.id}`,
    kind: protocolActivityKind(message),
    metrics: compactUniqueStrings([
      tokenBreakdownText(message, context.locale),
      message.payloadBytes === null ? undefined : formatBytes(message.payloadBytes, context.locale)
    ]),
    model,
    statusText,
    subtitle: protocolSubtitle(message, summary, context, tool, argument),
    title: protocolTitle(message, summary, context, tool, argument)
  }
}

export function turnActivityViewModel(
  turn: TurnSummary,
  context: ActivityViewContext,
  children: ActivityViewModel[] = []
): ActivityViewModel {
  const summary = parseJsonObject(turn.summaryJson)
  const account = accountLabel(context, turn.accountId, null)
  const model = stringField(summary, 'model')
  const statusText = turnStatusText(turn.status, context)
  const userText = cleanText(turn.userText)
  const assistantText = cleanText(turn.assistantText)
  return {
    account,
    badges: compactUniqueStrings([
      context.t('activity.kindTurn'),
      turn.toolCallCount > 0
        ? context.t('activity.badgeTools', { count: turn.toolCallCount })
        : undefined
    ]),
    children,
    detail: userText ?? assistantText ?? turn.turnKey,
    groupKey: turnGroupKey(turn),
    id: `turn:${turn.id}`,
    kind: 'turn',
    metrics: compactUniqueStrings([
      tokenBreakdownText(turn, context.locale),
      turn.toolCallCount > 0
        ? context.t('activity.metricToolCalls', { count: turn.toolCallCount })
        : undefined,
      turn.toolResultCount > 0
        ? context.t('activity.metricToolResults', { count: turn.toolResultCount })
        : undefined
    ]),
    model,
    statusText,
    subtitle: turnSubtitle(turn, context),
    title: turnTitle(turn, model, context)
  }
}

export function logActivityViewModel(
  event: ProxyLogEvent,
  context: ActivityViewContext,
  children: ActivityViewModel[] = []
): ActivityViewModel {
  const detail = parseJsonObject(event.detailJson)
  const account = accountLabel(context, event.accountId, event.path)
  const kind = logActivityKind(event)
  return {
    account,
    badges: compactUniqueStrings([
      logTypeLabel(event.eventType, context.t),
      event.level.toUpperCase()
    ]),
    children,
    detail: logDetail(event, detail, context),
    groupKey: event.conversationKey ?? event.requestId ?? event.id,
    id: `log:${event.id}`,
    kind,
    metrics: compactUniqueStrings([
      stringField(detail, 'statusCode')
        ? context.t('activity.metricStatus', { status: stringField(detail, 'statusCode') ?? '-' })
        : undefined,
      stringField(detail, 'reason')
    ]),
    statusText: event.level.toUpperCase(),
    subtitle: logSubtitle(event, detail, context),
    title: logTitle(event, detail, context)
  }
}

export function activityKindLabel(kind: ActivityKind, t: Translator): string {
  switch (kind) {
    case 'auth':
      return t('activity.kindAuth')
    case 'http':
      return t('activity.kindHttp')
    case 'quota':
      return t('activity.kindQuota')
    case 'sse':
      return t('activity.kindSse')
    case 'system':
      return t('activity.kindSystem')
    case 'tool':
      return t('activity.kindTool')
    case 'turn':
      return t('activity.kindTurn')
    case 'usage':
      return t('activity.kindUsage')
    case 'wss':
      return t('activity.kindWss')
  }
}

export function activitySearchValues(activity: ActivityViewModel): string[] {
  return compactStrings([
    activity.account,
    ...activity.badges,
    activity.detail,
    activity.groupKey,
    ...activity.metrics,
    activity.model,
    activity.statusText,
    activity.subtitle,
    activity.title,
    ...(activity.children ?? []).flatMap(activitySearchValues)
  ])
}

function requestTitle(
  request: RecentRequest,
  summary: Record<string, unknown>,
  account: string | undefined,
  model: string | undefined,
  status: string,
  context: ActivityViewContext
): string {
  if (request.requestPurpose === 'account_usage') {
    return context.t('activity.summary.usageQuery', {
      account: account ?? '-',
      plan: request.responsePlanType ?? stringField(summary, 'planType') ?? '-',
      remaining: remainingText(request, summary, context.locale)
    })
  }
  if (request.requestPurpose === 'codex_wss') {
    return context.t('activity.summary.wssConnection', {
      session: truncateMiddle(request.codexSessionId ?? request.conversationKey ?? request.id),
      status
    })
  }
  if (request.requestPurpose === 'codex_response_sse') {
    return context.t('activity.summary.userRequest', {
      model: model ?? '-',
      text: quoteShort(stringField(summary, 'userText'))
    })
  }
  if (request.requestPurpose === 'codex_compact') {
    return context.t('activity.summary.compact', {
      input: bytesFromSummary(summary, 'inputBytes', context.locale),
      output: bytesFromSummary(summary, 'outputBytes', context.locale),
      ratio: compactRatio(summary, context.locale)
    })
  }
  if (request.requestPurpose === 'analytics_events') {
    return context.t('activity.summary.analytics', {
      event: request.analyticsEventTypes ?? stringList(summary, 'eventTypes') ?? '-',
      status
    })
  }
  if (request.requestPurpose === 'wham_apps') {
    return context.t('activity.summary.appsRpc', {
      method: routeName(request),
      status
    })
  }
  return context.t('activity.summary.httpRequest', {
    route: routeName(request),
    status
  })
}

function requestSubtitle(
  request: RecentRequest,
  summary: Record<string, unknown>,
  context: ActivityViewContext
): string {
  const parts = compactStrings([
    request.rpcMethod ? context.t('activity.detail.rpc', { method: request.rpcMethod }) : undefined,
    request.responseItemCount !== null
      ? context.t('activity.detail.items', { count: request.responseItemCount })
      : undefined,
    request.analyticsEventTypes,
    stringField(summary, 'modelSummary'),
    request.errorMessage ?? undefined,
    request.path
  ])
  return parts.join(' · ')
}

function protocolTitle(
  message: ProtocolMessage,
  summary: Record<string, unknown>,
  context: ActivityViewContext,
  tool: string,
  argument: string
): string {
  if (message.kind === 'assistant') {
    return context.t('activity.summary.assistantReply', {
      model: message.model ?? '-',
      tokens: formatNumber(message.outputTokens ?? message.totalTokens, context.locale)
    })
  }
  if (message.kind === 'tool_call') {
    return context.t('activity.summary.toolCall', { arguments: argument, tool })
  }
  if (message.kind === 'tool_result') {
    return context.t('activity.summary.toolResult', {
      result: argument,
      tool
    })
  }
  if (message.kind === 'usage') {
    return context.t('activity.summary.usageResult', {
      model: message.model ?? '-',
      tokens: formatNumber(message.totalTokens, context.locale)
    })
  }
  if (message.kind === 'rate_limit') {
    return context.t('activity.summary.rateLimit', { detail: message.text || '-' })
  }
  if (message.kind === 'user') {
    return context.t('activity.summary.userRequest', {
      model: message.model ?? '-',
      text: quoteShort(userTextFromProtocol(message, summary))
    })
  }
  return message.text || message.protocolType || message.kind
}

function protocolSubtitle(
  message: ProtocolMessage,
  summary: Record<string, unknown>,
  context: ActivityViewContext,
  tool: string,
  argument: string
): string {
  return compactStrings([
    message.protocolType ?? undefined,
    protocolDirection(message, context.t),
    message.responseId
      ? `${context.t('requests.responseId')} ${truncateMiddle(message.responseId)}`
      : undefined,
    message.callId
      ? `${context.t('requests.callId')} ${truncateMiddle(message.callId)}`
      : undefined,
    tool !== '-' && message.kind !== 'tool_call' && message.kind !== 'tool_result'
      ? tool
      : undefined,
    argument !== '-' && message.kind !== 'user' ? argument : undefined,
    stringField(summary, 'status')
  ]).join(' · ')
}

function turnStatusText(status: string | null, context: ActivityViewContext): string {
  if (!status || status === 'completed') {
    return context.t('activity.statusCompleted')
  }
  if (status === 'error') {
    return context.t('outcome.failed')
  }
  return status
}

function turnTitle(
  turn: TurnSummary,
  model: string | undefined,
  context: ActivityViewContext
): string {
  if (turn.userText) {
    return context.t('activity.summary.userRequest', {
      model: model ?? '-',
      text: quoteShort(turn.userText)
    })
  }
  if (turn.assistantText) {
    return context.t('activity.summary.assistantReply', {
      model: model ?? '-',
      tokens: formatNumber(turn.outputTokens ?? turn.totalTokens, context.locale)
    })
  }
  return context.t('activity.summary.turn', {
    status: turn.status ?? '-',
    thread: truncateMiddle(turn.conversationKey ?? turn.turnKey)
  })
}

function turnSubtitle(turn: TurnSummary, context: ActivityViewContext): string {
  return compactStrings([
    turn.assistantText
      ? context.t('activity.detail.assistant', { text: quoteShort(turn.assistantText) })
      : undefined,
    turn.toolCallCount > 0
      ? context.t('activity.detail.tools', {
          calls: turn.toolCallCount,
          results: turn.toolResultCount
        })
      : undefined,
    turn.responseId
      ? `${context.t('requests.responseId')} ${truncateMiddle(turn.responseId)}`
      : undefined
  ]).join(' · ')
}

function logTitle(
  event: ProxyLogEvent,
  detail: Record<string, unknown>,
  context: ActivityViewContext
): string {
  if (event.eventType === 'auth') {
    return context.t('activity.summary.authEvent', {
      reason: stringField(detail, 'reason') ?? event.message
    })
  }
  if (event.eventType === 'quota') {
    return context.t('activity.summary.quotaEvent', {
      account: accountLabel(context, event.accountId, event.path) ?? '-',
      reason: stringField(detail, 'reason') ?? event.message
    })
  }
  if (event.eventType === 'account_switch') {
    return context.t('activity.summary.accountSwitch', {
      account: accountLabel(context, event.accountId, event.path) ?? '-'
    })
  }
  return context.t('activity.summary.systemEvent', { event: event.message })
}

function logSubtitle(
  event: ProxyLogEvent,
  detail: Record<string, unknown>,
  context: ActivityViewContext
): string {
  return compactStrings([
    event.path,
    stringField(detail, 'statusCode')
      ? context.t('activity.metricStatus', { status: stringField(detail, 'statusCode') ?? '-' })
      : undefined,
    stringField(detail, 'body'),
    stringField(detail, 'error')
  ]).join(' · ')
}

function logDetail(
  event: ProxyLogEvent,
  detail: Record<string, unknown>,
  context: ActivityViewContext
): string {
  return compactStrings([
    event.message,
    event.method && event.path ? `${event.method} ${event.path}` : (event.path ?? undefined),
    event.conversationKey
      ? `${context.t('requests.conversation')} ${truncateMiddle(event.conversationKey)}`
      : undefined,
    event.requestId
      ? `${context.t('requests.requestId')} ${truncateMiddle(event.requestId)}`
      : undefined,
    stringField(detail, 'message')
  ]).join(' · ')
}

function accountLabel(
  context: ActivityViewContext,
  accountId: string | null,
  path: string | null
): string | undefined {
  if (!accountId) {
    return undefined
  }
  return accountDisplayForPathFromLookup(
    context.accountLabels,
    accountId,
    path,
    context.t('accounts.emailPending'),
    context.t('accounts.originalAccount')
  )
}
