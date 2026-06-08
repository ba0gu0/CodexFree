import type { CopyKey, Locale } from '@renderer/i18n/copy'
import { formatBytes, formatPercent } from './format'
import {
  type ProtocolMessage,
  type ProxyLogEvent,
  type RecentRequest,
  type TurnSummary,
  tokenBreakdownText
} from './proxy-console'

export type Translator = (key: CopyKey, values?: Record<string, string | number>) => string

export function routeName(request: RecentRequest): string {
  const purpose = request.requestPurpose
  if (isInstalledPluginsPath(request.path)) return 'ps/plugins/installed'
  if (purpose === 'analytics_events') return 'analytics-events/events'
  if (purpose === 'account_usage') return 'wham/usage'
  if (purpose === 'codex_compact') return 'responses/compact'
  if (purpose === 'models') return 'models'
  if (purpose === 'wham_apps') return request.rpcMethod ?? 'wham/apps'
  if (purpose === 'connector_directory') return 'connectors/directory'
  if (purpose === 'plugin_featured') return 'plugins/featured'
  if (purpose === 'plugin_installed') return 'ps/plugins/installed'
  if (purpose === 'codex_wss') return 'codex/responses WSS'
  if (purpose === 'codex_response_sse') return 'codex/responses SSE'
  return `${request.method} ${request.path}`
}

export function isInstalledPluginsPath(path: string | null | undefined): boolean {
  return path?.includes('/backend-api/ps/plugins/installed') ?? false
}

export function installedPluginsScope(path: string | null | undefined): string {
  if (!path) {
    return '-'
  }
  const url = new URL(path, 'http://codexfree.local')
  return url.searchParams.get('scope') ?? '-'
}

export function remainingText(
  request: RecentRequest,
  summary: Record<string, unknown>,
  locale: Locale
): string {
  const direct = numberField(summary, 'primaryRemainingPercent')
  if (direct !== undefined) {
    return `${formatNumber(direct, locale)}%`
  }
  return formatPercent(invertPercent(request.responsePrimaryUsedPercent), locale)
}

export function bytePair(input: number, output: number, locale: Locale): string {
  return `${formatBytes(input, locale)} -> ${formatBytes(output, locale)}`
}

export function bytesFromSummary(
  summary: Record<string, unknown>,
  key: string,
  locale: Locale
): string {
  return formatBytes(numberField(summary, key), locale)
}

export function compactRatio(summary: Record<string, unknown>, locale: Locale): string {
  const ratio = numberField(summary, 'compressionRatio')
  if (ratio === undefined) {
    return '-'
  }
  const saved = Math.max(0, Math.min(100, 100 - ratio * 100))
  return `${formatNumber(saved, locale)}%`
}

export function requestMetric(request: RecentRequest, locale: Locale): string | undefined {
  const tokens = tokenBreakdownText(request, locale)
  return tokens === '-' ? undefined : tokens
}

export function quotaMetric(
  request: RecentRequest,
  summary: Record<string, unknown>,
  t: Translator,
  locale: Locale
): string | undefined {
  if (request.requestPurpose !== 'account_usage') {
    return undefined
  }
  return t('activity.metricRemaining', {
    remaining: remainingText(request, summary, locale)
  })
}

export function kindBadgeForRequest(request: RecentRequest, t: Translator): string {
  if (request.requestPurpose === 'account_usage') return t('activity.kindUsage')
  if (request.requestPurpose === 'codex_wss') return t('activity.kindWss')
  if (request.requestPurpose === 'codex_response_sse') return t('activity.kindSse')
  return t('activity.kindHttp')
}

export function protocolKindBadge(kind: string, t: Translator): string {
  switch (kind) {
    case 'assistant':
      return t('protocol.kindAssistant')
    case 'tool_call':
      return t('protocol.kindTool')
    case 'tool_result':
      return t('protocol.kindToolResult')
    case 'usage':
      return t('protocol.kindUsage')
    case 'rate_limit':
      return t('protocol.kindRateLimit')
    case 'user':
      return t('protocol.kindUser')
    default:
      return kind
  }
}

export function protocolDirection(message: ProtocolMessage, t: Translator): string {
  return message.direction === 'codex-to-upstream'
    ? t('protocol.directionCodexToUpstream')
    : t('protocol.directionUpstreamToCodex')
}

export function protocolStatusText(message: ProtocolMessage, t: Translator): string {
  if (message.kind === 'error') return t('outcome.failed')
  if (message.kind === 'rate_limit') return t('protocol.kindRateLimit')
  if (message.kind === 'usage') return t('activity.statusCompleted')
  return message.sequenceNumber === null ? t('source.protocol') : `#${message.sequenceNumber}`
}

export function logTypeLabel(type: string | null, t: Translator): string {
  if (type === 'auth') return t('activity.kindAuth')
  if (type === 'quota') return t('activity.kindQuota')
  if (type === 'account_switch') return t('activity.typeSwitch')
  return t('activity.kindSystem')
}

export function requestGroupKey(request: RecentRequest): string {
  return request.conversationKey ?? request.codexTurnId ?? request.codexThreadId ?? request.id
}

export function protocolGroupKey(message: ProtocolMessage): string {
  return (
    message.callId ??
    message.itemId ??
    message.responseId ??
    message.previousResponseId ??
    message.conversationKey ??
    message.requestId
  )
}

export function turnGroupKey(turn: TurnSummary): string {
  return turn.responseId ?? turn.parentResponseId ?? turn.conversationKey ?? turn.turnKey
}

export function toolName(message: ProtocolMessage, summary: Record<string, unknown>): string {
  return (
    stringField(summary, 'tool') ??
    stringField(summary, 'name') ??
    message.text.match(/工具(?:调用|结果):\s*([^ 参数]+)/)?.[1] ??
    message.text.match(/Tool(?: call| result)?:\s*([^ ]+)/i)?.[1] ??
    'unknown_tool'
  )
}

export function toolArgument(message: ProtocolMessage, summary: Record<string, unknown>): string {
  return quoteShort(
    stringField(summary, 'arguments') ??
      stringField(summary, 'result') ??
      message.text.match(/参数:\s*(.+)$/)?.[1] ??
      message.text
  )
}

export function userTextFromProtocol(
  message: ProtocolMessage,
  summary: Record<string, unknown>
): string {
  return stringField(summary, 'userText') ?? message.text.replace(/^用户请求:\s*/, '')
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

export function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) {
    return {}
  }
  try {
    const parsed = JSON.parse(value) as unknown
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key]
  if (typeof field === 'string' && field.length > 0) {
    return field
  }
  if (typeof field === 'number') {
    return String(field)
  }
  return undefined
}

export function numberField(value: Record<string, unknown>, key: string): number | undefined {
  const field = value[key]
  if (typeof field === 'number' && Number.isFinite(field)) {
    return field
  }
  if (typeof field !== 'string') {
    return undefined
  }
  const numeric = Number(field)
  return Number.isFinite(numeric) ? numeric : undefined
}

export function stringList(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key]
  if (!Array.isArray(field)) {
    return undefined
  }
  return field
    .filter((item): item is string => typeof item === 'string' && item.length > 0)
    .slice(0, 3)
    .join(',')
}

export function cleanText(value: string | null | undefined): string | undefined {
  const text = value?.trim()
  return text && text.length > 0 ? text : undefined
}

export function quoteShort(value: string | null | undefined): string {
  const text = cleanText(value) ?? '-'
  const normalized = text.replace(/\s+/g, ' ')
  const short = normalized.length > 80 ? `${normalized.slice(0, 80)}...` : normalized
  return short === '-' ? short : `“${short}”`
}

export function formatNumber(value: number | null | undefined, locale: Locale): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '-'
  }
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)
}

export function compactStrings(values: Array<string | undefined | null | false>): string[] {
  return values.filter((value): value is string => typeof value === 'string' && value.length > 0)
}

export function compactUniqueStrings(values: Array<string | undefined | null | false>): string[] {
  return [...new Set(compactStrings(values))]
}

export function logActivityKind(event: ProxyLogEvent): 'auth' | 'quota' | 'system' {
  if (event.eventType === 'auth') return 'auth'
  if (event.eventType === 'quota') return 'quota'
  if (event.eventType === 'account_switch') return 'auth'
  return 'system'
}

export function protocolActivityKind(
  message: ProtocolMessage
): 'quota' | 'sse' | 'tool' | 'usage' | 'wss' {
  if (message.kind === 'tool_call' || message.kind === 'tool_result') return 'tool'
  if (message.kind === 'usage') return 'usage'
  if (message.kind === 'rate_limit') return 'quota'
  if (message.protocolType === 'sse') return 'sse'
  if (message.protocolType === 'wss') return 'wss'
  if (message.path.includes('/codex/responses')) return 'wss'
  return 'sse'
}

function invertPercent(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }
  const numeric = Number.parseFloat(value)
  return Number.isFinite(numeric) ? String(Math.max(0, Math.min(100, 100 - numeric))) : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
