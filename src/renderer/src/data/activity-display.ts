import type { CopyKey, Locale } from '@renderer/i18n/copy'
import { formatBytes, truncateMiddle } from './format'
import {
  type ProtocolMessage,
  type ProxyLogEvent,
  type RecentRequest,
  requestPurposeLabel,
  tokenBreakdownText
} from './proxy-console'

type Translator = (key: CopyKey, values?: Record<string, string | number>) => string

export function requestDisplayTitle(request: RecentRequest, t: Translator): string {
  return `${requestPurposeLabel(request.requestPurpose, t)} · ${request.method} ${request.path}`
}

export function logEventDisplayTitle(event: ProxyLogEvent, t: Translator): string {
  const detail = parseDetailJson(event.detailJson)
  if (event.message === 'Routing event') {
    return routingEventTitle(stringValue(detail.eventType), t)
  }
  if (event.message === 'Quota event') {
    return t('activity.quotaEvent')
  }
  if (event.message === 'WSS lifecycle') {
    return websocketPhaseLabel(stringValue(detail.phase), t)
  }
  if (event.message === 'WSS message') {
    return `${t('activity.wssMessage')} · ${protocolKindLabel(stringValue(detail.kind), t)}`
  }
  return t(messageTitleKey(event.message) ?? logEventTypeKey(event.eventType))
}

export function logEventDisplayMeta(event: ProxyLogEvent, t: Translator): string {
  const detail = parseDetailJson(event.detailJson)
  const path = event.path ?? stringValue(detail.path)
  const method = event.method ?? stringValue(detail.method)
  const purpose = stringValue(detail.requestPurpose)
  const status = stringValue(detail.statusCode)
  const model = stringValue(detail.responseModel) ?? stringValue(detail.requestModel)
  const reason = stringValue(detail.reason)
  const plan = stringValue(detail.planType)
  const activeLimit = stringValue(detail.activeLimit)
  const usedPercent = stringValue(detail.primaryUsedPercent)
  const thread = stringValue(detail.codexThreadId)
  const turn = stringValue(detail.codexTurnId)
  const parts = [
    purpose ? requestPurposeLabel(purpose, t) : undefined,
    path ? `${method ?? '-'} ${path}` : undefined,
    model ? `${t('table.model')} ${model}` : undefined,
    status ? `${t('table.status')} ${status}` : undefined,
    reason ? `${t('activity.reason')} ${reason}` : undefined,
    plan ? `${t('table.plan')} ${plan}` : undefined,
    activeLimit ? `${t('activity.activeLimit')} ${activeLimit}` : undefined,
    usedPercent ? `${t('table.primaryUsage')} ${usedPercent}` : undefined,
    thread ? `${t('requests.codexThread')} ${truncateMiddle(thread)}` : undefined,
    turn ? `${t('requests.codexTurn')} ${truncateMiddle(turn)}` : undefined
  ]
  return parts.filter(Boolean).join(' · ') || event.message
}

export function logEventTypeLabel(type: string | null | undefined, t: Translator): string {
  return t(logEventTypeKey(type))
}

export function protocolMessageDisplayTitle(message: ProtocolMessage, t: Translator): string {
  return [
    protocolDirectionLabel(message.direction, t),
    protocolKindLabel(message.kind, t),
    message.protocolType ?? undefined
  ]
    .filter(Boolean)
    .join(' · ')
}

export function protocolMessageDisplayMeta(
  message: ProtocolMessage,
  locale: Locale,
  t: Translator
): string {
  const parts = [
    message.model ? `${t('table.model')} ${message.model}` : undefined,
    message.sequenceNumber === null ? undefined : `#${message.sequenceNumber}`,
    message.payloadBytes === null
      ? undefined
      : `${t('table.bytes')} ${formatBytes(message.payloadBytes, locale)}`,
    tokenBreakdownText(message, locale),
    message.text || undefined
  ]
  return parts.filter((part) => part && part !== '-').join(' · ') || '-'
}

export function protocolDirectionLabel(
  direction: string | null | undefined,
  t: Translator
): string {
  if (direction === 'codex-to-upstream') {
    return t('protocol.directionCodexToUpstream')
  }
  if (direction === 'upstream-to-codex') {
    return t('protocol.directionUpstreamToCodex')
  }
  return direction ?? '-'
}

export function protocolKindLabel(kind: string | null | undefined, t: Translator): string {
  switch (kind) {
    case 'user':
      return t('protocol.kindUser')
    case 'assistant':
      return t('protocol.kindAssistant')
    case 'tool':
    case 'tool_call':
      return t('protocol.kindTool')
    case 'tool_result':
      return t('protocol.kindToolResult')
    case 'response_started':
      return t('protocol.kindResponseStarted')
    case 'error':
      return t('protocol.kindError')
    case 'usage':
      return t('protocol.kindUsage')
    case 'rate_limit':
      return t('protocol.kindRateLimit')
    case 'heartbeat':
      return t('protocol.kindHeartbeat')
    default:
      return kind ?? '-'
  }
}

export function parseDetailJson(value: string | null): Record<string, unknown> {
  if (!value) {
    return {}
  }
  try {
    const parsed = JSON.parse(value) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function messageTitleKey(message: string): CopyKey | null {
  switch (message) {
    case 'Transparent proxy started':
      return 'activity.proxyStarted'
    case 'Daemon admin API started':
      return 'activity.adminStarted'
    case 'Admin API mutation':
      return 'activity.adminMutation'
    case 'HTTP forward':
      return 'activity.httpForward'
    case 'HTTP result':
      return 'activity.httpResult'
    case 'WSS client connected':
      return 'activity.wssClientConnected'
    case 'Active account selected':
      return 'activity.accountSelected'
    case 'Switched active account after usage limit':
      return 'activity.accountSwitchQuota'
    case 'Switched active account after auth failure':
      return 'activity.accountSwitchAuth'
    case 'Auth failed; disabling account':
      return 'activity.authFailed'
    case 'Usage limit reached; marking account exhausted':
      return 'activity.usageLimit'
    case 'No replacement account is available after usage limit':
      return 'activity.noReplacement'
    case 'Waiting for active account switch':
      return 'activity.waitingSwitch'
    case 'Active account switch lock expired':
      return 'activity.switchExpired'
    case 'Ledger updated from usage response':
      return 'activity.usageUpdated'
    case 'Routing event':
      return 'activity.routingEvent'
    case 'Quota event':
      return 'activity.quotaEvent'
    default:
      return null
  }
}

function routingEventTitle(eventType: string | undefined, t: Translator): string {
  switch (eventType) {
    case 'selected':
      return t('activity.routeSelected')
    case 'auth_retry_selected':
      return t('activity.routeAuthRetry')
    case 'auth_failed':
      return t('activity.routeAuthFailed')
    case 'quota_retry_selected':
      return t('activity.routeQuotaRetry')
    case 'quota_exhausted':
      return t('activity.routeQuotaExhausted')
    case 'all_accounts_exhausted':
      return t('activity.routeAllExhausted')
    default:
      return eventType ?? t('activity.routingEvent')
  }
}

function websocketPhaseLabel(phase: string | undefined, t: Translator): string {
  switch (phase) {
    case 'client_connected':
      return t('activity.wssClientConnected')
    case 'upstream_connecting':
      return t('activity.wssUpstreamConnecting')
    case 'upstream_connected':
      return t('activity.wssUpstreamConnected')
    case 'upstream_closed':
      return t('activity.wssUpstreamClosed')
    case 'quota_frame_suppressed':
      return t('activity.wssQuotaSuppressed')
    case 'terminal_quota_forwarded':
      return t('activity.wssTerminalQuota')
    case 'ping':
      return t('activity.wssPing')
    case 'pong':
      return t('activity.wssPong')
    default:
      return phase ?? t('activity.wssLifecycle')
  }
}

function logEventTypeKey(type: string | null | undefined): CopyKey {
  switch (type) {
    case 'account_switch':
      return 'activity.typeSwitch'
    case 'network':
      return 'activity.typeNetwork'
    case 'quota':
      return 'activity.typeQuota'
    case 'auth':
      return 'activity.typeAuth'
    case 'system':
      return 'activity.typeSystem'
    default:
      return 'activity.typeRequest'
  }
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) {
    return value
  }
  if (typeof value === 'number') {
    return String(value)
  }
  return undefined
}
