import { formatBytes, formatDuration } from '@renderer/data/format'
import {
  type ConsoleSnapshot,
  type ProtocolMessage,
  type RecentRequest,
  requestPurposeLabel
} from '@renderer/data/proxy-console'
import type { CopyKey, Locale } from '@renderer/i18n/copy'
import { ActivityIcon, BarChart3Icon, GaugeIcon, NetworkIcon } from 'lucide-react'
import type { ReactElement } from 'react'

type Translator = (key: CopyKey, values?: Record<string, string | number>) => string

interface CardProps {
  className?: string
  locale: Locale
  snapshot: ConsoleSnapshot
  t: Translator
}

export function ActiveProxyCard({ className = '', locale, snapshot, t }: CardProps): ReactElement {
  const running = snapshot.status.running
  const requestCount = compactNumber(snapshot.requestSummary.total, locale)
  const latencyStats = firstResponseLatencyStats(snapshot.protocolMessages)
  const latency = formatDuration(latencyStats.average, locale)
  const traffic = `${positiveBytes(snapshot.usageSummary.requestBytes, locale)} / ${positiveBytes(
    snapshot.usageSummary.responseBytes,
    locale
  )}`
  const runtimeTone = running ? 'text-success bg-success/10' : 'text-warning bg-warning/10'
  return (
    <section className={`${vmCard} ${className}`}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate font-extrabold text-lg">{t('vm.proxyRuntime')}</h2>
            <span className={`inline-flex shrink-0 items-center ${cardToplineClass(runtimeTone)}`}>
              <NetworkIcon className="size-4" />
              {running ? t('vm.live') : t('vm.offline')}
            </span>
          </div>
          <div
            className="mt-1 truncate text-muted-foreground text-xs"
            title={snapshot.status.endpoint}
          >
            {t('vm.endpoint')}: {snapshot.status.endpoint}
          </div>
        </div>
        <ActivityIcon className="mt-1 size-4 shrink-0 text-muted-foreground" />
      </div>
      <div
        className={[
          'grid min-h-0 gap-2',
          'grid-cols-[minmax(0,0.82fr)_minmax(0,1.28fr)_minmax(0,0.9fr)]'
        ].join(' ')}
      >
        <TinyMetric label={t('vm.requests')} value={requestCount} />
        <TinyMetric label={t('vm.latency')} value={latency} />
        <TinyMetric
          label={t('vm.activeWss')}
          value={snapshot.status.runtime?.activeWebSocketSessions ?? 0}
        />
      </div>
      <Sparkline
        bars={requestBars(snapshot.requests)}
        footer={`${t('vm.traffic')} ${traffic}`}
        title={t('vm.proxyRuntime')}
        tone={running ? 'info' : 'warning'}
      />
    </section>
  )
}

export function ApiVolumeCard({ className = '', locale, snapshot, t }: CardProps): ReactElement {
  const segments = requestPurposeSegments(snapshot, t, locale)
  const successRatio = boundedRatio(
    snapshot.usageSummary.successful,
    Math.max(snapshot.usageSummary.total, 1)
  )
  const successRate = ratioPercent(successRatio, locale)
  const topPurpose = segments[0]
  const topPurposeValue = topPurpose
    ? `${topPurpose.label} ${ratioPercent(topPurpose.ratio, locale)}`
    : '-'
  return (
    <section className={`${vmCard} ${className}`}>
      <CardTopline icon={<BarChart3Icon className="size-4" />} label={t('vm.requestMix')} />
      <div className="flex min-w-0 items-center justify-between gap-4">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="truncate font-extrabold text-lg">{t('vm.apiVolume')}</h2>
          <span className="shrink-0 font-extrabold text-2xl">
            {compactNumber(snapshot.requestSummary.total, locale)}
          </span>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 font-bold text-xs ${successToneClass(
              successRatio
            )}`}
          >
            {t('usage.successRate')} {successRate}
          </span>
        </div>
        <TinyMetric label={t('vm.topPurpose')} value={topPurposeValue} />
      </div>
      <PurposeMixField emptyLabel={t('vm.noTraffic')} locale={locale} segments={segments} />
    </section>
  )
}

export function InferenceLatencyCard({
  className = '',
  locale,
  snapshot,
  t
}: CardProps): ReactElement {
  const latencyStats = firstResponseLatencyStats(snapshot.protocolMessages)
  return (
    <section className={`${vmCard} ${className}`}>
      <CardTopline
        icon={<GaugeIcon className="size-4" />}
        label={t('vm.sampleWindow')}
        tone="warning"
      />
      <div className="flex min-w-0 items-center justify-between gap-4">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="truncate font-extrabold text-lg">{t('vm.inferenceLatency')}</h2>
          <span className="shrink-0 font-extrabold text-2xl">
            {formatDuration(latencyStats.p95, locale)}
          </span>
          <span className="shrink-0 font-bold text-muted-foreground text-xs">
            {t('vm.p95Latency')}
          </span>
        </div>
        <TinyMetric
          label={t('vm.avgLatency')}
          value={formatDuration(latencyStats.average, locale)}
        />
      </div>
      <LineField points={latencyStats.points} title={t('vm.inferenceLatency')} />
    </section>
  )
}

const vmCard = [
  'flex min-h-0 min-w-0 flex-col gap-3 overflow-hidden rounded-xl border',
  'border-border/70 bg-card p-4 shadow-sm'
].join(' ')

function CardTopline({
  icon,
  label,
  tone = 'info'
}: {
  icon: ReactElement
  label: string
  tone?: 'info' | 'success' | 'warning'
}): ReactElement {
  const color =
    tone === 'success'
      ? 'text-success bg-success/10'
      : tone === 'warning'
        ? 'text-warning bg-warning/10'
        : 'text-info bg-info/10'
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={`inline-flex items-center ${cardToplineClass(color)}`}>
        {icon}
        {label}
      </span>
      <ActivityIcon className="size-4 text-muted-foreground" />
    </div>
  )
}

function TinyMetric({ label, value }: { label: string; value: number | string }): ReactElement {
  return (
    <div className="min-w-0 rounded-lg bg-muted/45 p-2">
      <div className="truncate font-bold text-[10px] text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-extrabold text-foreground text-xs" title={String(value)}>
        {value}
      </div>
    </div>
  )
}

function Sparkline({
  bars,
  footer,
  title,
  tone
}: {
  bars: number[]
  footer: string
  title: string
  tone: 'info' | 'warning'
}): ReactElement {
  const points = linePoints(bars, 180, 34)
  const stroke = tone === 'info' ? 'stroke-info' : 'stroke-warning'
  return (
    <div className="min-h-[76px] rounded-lg border bg-muted/25 p-2">
      <svg className="h-[42px] w-full" viewBox="0 0 180 42" role="img">
        <title>{title}</title>
        <path d="M0 28H180" className="stroke-border" />
        <path
          d={points}
          className={`${stroke} fill-none`}
          strokeLinecap="round"
          strokeWidth="2.5"
        />
      </svg>
      <div className="truncate pt-0.5 font-medium text-muted-foreground text-[11px]">{footer}</div>
    </div>
  )
}

interface PurposeSegment {
  color: PurposeColor
  count: number
  key: string
  label: string
  ratio: number
  share: string
}

interface PurposeColor {
  barClassName: string
  dotClassName: string
}

function PurposeMixField({
  emptyLabel,
  locale,
  segments
}: {
  emptyLabel: string
  locale: Locale
  segments: PurposeSegment[]
}): ReactElement {
  const visibleSegments = segments.slice(0, 5)
  if (visibleSegments.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border bg-muted/25 text-muted-foreground text-xs">
        {emptyLabel}
      </div>
    )
  }
  const label = visibleSegments.map((segment) => `${segment.label} ${segment.share}`).join(' / ')
  return (
    <div className="flex min-h-[112px] shrink-0 flex-col rounded-lg border bg-muted/25 p-3">
      <div
        aria-label={label}
        className="flex h-9 overflow-hidden rounded-md bg-muted/50"
        role="img"
      >
        {visibleSegments.map((segment) => (
          <div
            className={`h-full ${segment.color.barClassName}`}
            key={segment.key}
            style={{
              minWidth: segment.ratio > 0 ? 2 : 0,
              width: `${segment.ratio * 100}%`
            }}
          />
        ))}
      </div>
      <div className="mt-2 grid min-w-0 grid-cols-2 gap-x-3 gap-y-1.5">
        {visibleSegments.slice(0, 4).map((segment) => (
          <div className="flex min-w-0 items-center gap-1.5 text-[10px]" key={segment.key}>
            <span className={`size-2 shrink-0 rounded-full ${segment.color.dotClassName}`} />
            <span className="truncate font-semibold">{segment.label}</span>
            <span className="ml-auto shrink-0 text-muted-foreground">
              {compactNumber(segment.count, locale)} · {segment.share}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function LineField({ points, title }: { points: number[]; title: string }): ReactElement {
  return (
    <div className="min-h-0 flex-1 rounded-lg border bg-muted/25 p-3">
      <svg className="size-full min-h-[74px]" viewBox="0 0 240 84" role="img">
        <title>{title}</title>
        <path d="M0 54H240" className="stroke-border" strokeDasharray="3 5" />
        <path
          d={linePoints(points, 240, 74)}
          className="fill-none stroke-warning"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.5"
        />
      </svg>
    </div>
  )
}

function requestBars(requests: RecentRequest[]): number[] {
  const buckets = Array.from({ length: 12 }, () => 0)
  const sorted = [...requests].sort((left, right) => left.startedAt - right.startedAt).slice(-120)
  if (sorted.length === 0) {
    return buckets
  }
  const firstStartedAt = sorted[0]?.startedAt ?? 0
  const lastStartedAt = sorted.at(-1)?.startedAt ?? firstStartedAt
  const span = Math.max(1, lastStartedAt - firstStartedAt)
  for (const request of sorted) {
    const ratio = (request.startedAt - firstStartedAt) / span
    const index = Math.min(11, Math.max(0, Math.floor(ratio * 12)))
    buckets[index] += 1
  }
  return buckets
}

function requestPurposeSegments(
  snapshot: ConsoleSnapshot,
  t: Translator,
  locale: Locale
): PurposeSegment[] {
  const groups = snapshot.requestSummary.purposeGroups.filter((group) => group.count > 0)
  const groupedTotal = groups.reduce((total, group) => total + group.count, 0)
  const total = Math.max(snapshot.requestSummary.total, groupedTotal, 1)
  const segments = groups.map((group, index) =>
    purposeSegment(group.key, group.count, total, index, t, locale)
  )
  const remaining = Math.max(0, snapshot.requestSummary.total - groupedTotal)
  if (remaining > 0) {
    segments.push(purposeSegment('other', remaining, total, segments.length, t, locale))
  }
  return segments.sort((left, right) => right.count - left.count)
}

function purposeSegment(
  key: string,
  count: number,
  total: number,
  index: number,
  t: Translator,
  locale: Locale
): PurposeSegment {
  const ratio = boundedRatio(count, total)
  return {
    color: purposeColor(key, index),
    count,
    key,
    label: purposeLabel(key, t),
    ratio,
    share: ratioPercent(ratio, locale)
  }
}

function purposeLabel(key: string, t: Translator): string {
  if (key === 'unknown') {
    return t('vm.unknownPurpose')
  }
  if (key === 'other') {
    return t('vm.otherPurpose')
  }
  return requestPurposeLabel(key, t)
}

function purposeColor(key: string, index: number): PurposeColor {
  return (
    PURPOSE_COLOR_BY_KEY[key] ?? PURPOSE_FALLBACK_COLORS[index % PURPOSE_FALLBACK_COLORS.length]
  )
}

function firstResponseLatencyStats(messages: ProtocolMessage[]): {
  average: number | null
  p95: number | null
  points: number[]
} {
  const latencies = firstResponseLatencies(messages)
  const average =
    latencies.length === 0
      ? null
      : latencies.reduce((total, value) => total + value, 0) / latencies.length
  return {
    average,
    p95: percentile(latencies, 0.95),
    points: latencies.slice(-12)
  }
}

function firstResponseLatencies(messages: ProtocolMessage[]): number[] {
  const responses = new Map<string, ProtocolMessage[]>()
  const users = messages.filter(isUserProtocolMessage).sort(compareMessageTime)
  for (const message of messages.filter(isFirstResponseProtocolMessage).sort(compareMessageTime)) {
    const rows = responses.get(message.requestId) ?? []
    rows.push(message)
    responses.set(message.requestId, rows)
  }
  return users.flatMap((message) => {
    const response = responses
      .get(message.requestId)
      ?.find((item) => item.createdAt >= message.createdAt)
    const latency = response ? response.createdAt - message.createdAt : null
    return latency !== null && latency >= 0 ? [latency] : []
  })
}

function isUserProtocolMessage(message: ProtocolMessage): boolean {
  return message.direction === 'codex-to-upstream' && message.kind === 'user'
}

function isFirstResponseProtocolMessage(message: ProtocolMessage): boolean {
  if (message.direction !== 'upstream-to-codex') {
    return false
  }
  return [
    'response_started',
    'assistant',
    'tool_call',
    'tool_result',
    'rate_limit',
    'error'
  ].includes(message.kind)
}

function compareMessageTime(left: ProtocolMessage, right: ProtocolMessage): number {
  return left.createdAt - right.createdAt
}

function linePoints(values: number[], width: number, height: number): string {
  const source = values.length > 0 ? values : [0, 0]
  const max = Math.max(1, ...source)
  return source
    .map((value, index) => {
      const x = source.length === 1 ? width / 2 : (index / (source.length - 1)) * width
      const y = height - (Math.max(0, value) / max) * (height - 8) + 4
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
}

function percentile(values: number[], ratio: number): number | null {
  if (values.length === 0) {
    return null
  }
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.ceil((sorted.length - 1) * ratio)]
}

function ratioPercent(ratio: number, locale: Locale): string {
  const formatted = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(ratio * 100)
  return `${formatted}%`
}

function boundedRatio(value: number, total: number): number {
  if (total <= 0) {
    return 0
  }
  return Math.max(0, Math.min(1, value / total))
}

function successToneClass(ratio: number): string {
  if (ratio >= 0.9) {
    return 'bg-success/10 text-success'
  }
  if (ratio >= 0.7) {
    return 'bg-warning/10 text-warning'
  }
  return 'bg-destructive/10 text-destructive'
}

function compactNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1, notation: 'compact' }).format(
    value
  )
}

function positiveBytes(value: number, locale: Locale): string {
  return value <= 0 ? '0 B' : formatBytes(value, locale)
}

function cardToplineClass(color: string): string {
  return `gap-1.5 rounded-full px-2 py-1 font-bold text-[10px] uppercase ${color}`
}

const PURPOSE_COLOR_BY_KEY: Record<string, PurposeColor> = {
  account_usage: { barClassName: 'bg-emerald-500', dotClassName: 'bg-emerald-500' },
  analytics_events: { barClassName: 'bg-violet-500', dotClassName: 'bg-violet-500' },
  api_key_compat: { barClassName: 'bg-rose-500', dotClassName: 'bg-rose-500' },
  codex_compact: { barClassName: 'bg-sky-500', dotClassName: 'bg-sky-500' },
  codex_response_sse: { barClassName: 'bg-cyan-500', dotClassName: 'bg-cyan-500' },
  codex_wss: { barClassName: 'bg-indigo-500', dotClassName: 'bg-indigo-500' },
  connector_directory: { barClassName: 'bg-purple-500', dotClassName: 'bg-purple-500' },
  models: { barClassName: 'bg-teal-500', dotClassName: 'bg-teal-500' },
  other: { barClassName: 'bg-muted-foreground/60', dotClassName: 'bg-muted-foreground/60' },
  plugin_featured: { barClassName: 'bg-fuchsia-500', dotClassName: 'bg-fuchsia-500' },
  unknown: { barClassName: 'bg-muted-foreground', dotClassName: 'bg-muted-foreground' },
  upstream: { barClassName: 'bg-blue-500', dotClassName: 'bg-blue-500' },
  wham_apps: { barClassName: 'bg-amber-500', dotClassName: 'bg-amber-500' }
}

const PURPOSE_FALLBACK_COLORS: PurposeColor[] = [
  { barClassName: 'bg-blue-500', dotClassName: 'bg-blue-500' },
  { barClassName: 'bg-emerald-500', dotClassName: 'bg-emerald-500' },
  { barClassName: 'bg-amber-500', dotClassName: 'bg-amber-500' },
  { barClassName: 'bg-cyan-500', dotClassName: 'bg-cyan-500' },
  { barClassName: 'bg-violet-500', dotClassName: 'bg-violet-500' }
]
