import { MetricCard } from '@renderer/components/app-shell/metric-card'
import { PageHeader } from '@renderer/components/app-shell/page-header'
import { Button } from '@renderer/components/ui/button'
import { Card, CardHeader, CardPanel, CardTitle } from '@renderer/components/ui/card'
import { formatBytes, formatDuration } from '@renderer/data/format'
import { tokenUsageSourceLabel } from '@renderer/data/proxy-console'
import { BarChart3Icon, RefreshCwIcon } from 'lucide-react'
import { type ReactElement, useMemo } from 'react'
import type { PageProps } from './types'

interface TokenGroup {
  cached: number
  count: number
  input: number
  key: string
  output: number
  reasoning: number
  total: number
}

interface UsageAnalysis {
  averageDuration: string
  failureRate: string
  requestCount: number
  requestsWithUsage: number
  sourceGroups: TokenGroup[]
  successRate: string
  tokenMoneyTotal: string
  totalTraffic: string
  tokenTotal: string
  trafficTotal: string
  topAccounts: TokenGroup[]
  topDays: TokenGroup[]
  topModels: TokenGroup[]
  topTurns: TokenGroup[]
}

export function UsagePage({ actions, busyAction, locale, snapshot, t }: PageProps): ReactElement {
  const analysis = useMemo(
    () => buildUsageAnalysis(snapshot.usageSummary, locale, t),
    [locale, snapshot.usageSummary, t]
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      <PageHeader
        actions={
          <Button loading={busyAction === 'refresh'} onClick={actions.refresh}>
            <RefreshCwIcon data-icon="inline-start" />
            {t('usage.refreshAnalysis')}
          </Button>
        }
        description={t('usage.desc')}
        title={t('usage.title')}
      />

      <section className="grid h-[92px] shrink-0 grid-cols-4 gap-3">
        <MetricCard
          label={t('usage.tokenMoneyTotals')}
          tone="info"
          value={analysis.tokenMoneyTotal}
        />
        <MetricCard
          label={t('usage.requestsWithUsage')}
          value={String(analysis.requestsWithUsage)}
        />
        <MetricCard label={t('usage.successRate')} tone="success" value={analysis.successRate} />
        <MetricCard label={t('usage.totalTraffic')} tone="warning" value={analysis.trafficTotal} />
      </section>

      <section className="grid min-h-0 flex-1 grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] gap-3">
        <Card className="min-h-0 overflow-hidden rounded-xl shadow-none">
          <CardHeader className="p-4 pb-2">
            <CardTitle>{t('usage.qualityTitle')}</CardTitle>
          </CardHeader>
          <CardPanel className="grid min-h-0 grid-cols-2 gap-2.5 p-3 pt-0">
            <AnalysisBlock label={t('usage.requestWindow')} value={String(analysis.requestCount)} />
            <AnalysisBlock
              label={t('usage.failureRate')}
              tone="warning"
              value={analysis.failureRate}
            />
            <AnalysisBlock label={t('usage.avgLatency')} value={analysis.averageDuration} />
            <AnalysisBlock label={t('usage.totalTraffic')} value={analysis.totalTraffic} />
            <GroupList
              className="col-span-2"
              groups={analysis.sourceGroups}
              title={t('usage.tokenSourceTitle')}
            />
          </CardPanel>
        </Card>

        <Card className="min-h-0 overflow-hidden rounded-xl shadow-none">
          <CardHeader className="p-4 pb-2">
            <CardTitle>{t('usage.tokenTotals')}</CardTitle>
          </CardHeader>
          <CardPanel className="grid min-h-0 grid-cols-2 gap-2.5 overflow-y-auto p-3 pt-0">
            <GroupList groups={analysis.topModels} title={t('usage.tokenModelTitle')} />
            <GroupList groups={analysis.topAccounts} title={t('usage.tokenAccountTitle')} />
            <GroupList groups={analysis.topDays} title={t('usage.tokenDayTitle')} />
            <GroupList groups={analysis.topTurns} title={t('usage.threadTurnTitle')} />
            {analysis.requestsWithUsage === 0 ? (
              <div className="col-span-2 rounded-lg bg-muted/35 p-3 text-muted-foreground text-xs">
                {t('usage.noTokenUsage')}
              </div>
            ) : null}
          </CardPanel>
        </Card>
      </section>
    </div>
  )
}

function AnalysisBlock({
  label,
  tone = 'default',
  value
}: {
  label: string
  tone?: 'default' | 'warning'
  value: string
}): ReactElement {
  return (
    <section className="min-w-0 rounded-lg bg-muted/35 p-2.5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="font-bold text-muted-foreground text-xs">{label}</span>
        <BarChart3Icon
          className={tone === 'warning' ? 'size-4 text-warning' : 'size-4 text-muted-foreground'}
        />
      </div>
      <div className="truncate font-extrabold text-foreground text-xl">{value}</div>
    </section>
  )
}

function GroupList({
  className,
  groups,
  title
}: {
  className?: string
  groups: TokenGroup[]
  title: string
}): ReactElement {
  return (
    <section
      className={`min-h-0 min-w-0 overflow-hidden rounded-lg border bg-background/45 p-2.5 ${className ?? ''}`}
    >
      <h3 className="mb-2 font-bold text-foreground text-sm">{title}</h3>
      <div className="grid gap-1.5">
        {groups.length === 0 ? (
          <div className="text-muted-foreground text-xs">-</div>
        ) : (
          groups.slice(0, 6).map((group) => (
            <div className="min-w-0 overflow-hidden rounded-md bg-muted/35 p-2" key={group.key}>
              <div className="truncate font-semibold text-xs" title={group.key}>
                {group.key}
              </div>
              <div className="mt-1 max-w-full overflow-hidden truncate whitespace-nowrap font-bold text-foreground text-[11px] tabular-nums">
                T {group.total} · I {group.input} · C {group.cached} · O {group.output} · R{' '}
                {group.reasoning}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

function buildUsageAnalysis(
  summary: PageProps['snapshot']['usageSummary'],
  locale: PageProps['locale'],
  t: PageProps['t']
): UsageAnalysis {
  const requestCount = Math.max(summary.total, 1)
  const averageDuration =
    summary.averageDurationMs === null ? '-' : formatDuration(summary.averageDurationMs, locale)

  return {
    averageDuration,
    failureRate: `${Math.round((summary.failed / requestCount) * 100)}%`,
    requestCount: summary.total,
    requestsWithUsage: summary.requestsWithUsage,
    sourceGroups: summary.sourceGroups.map((group) =>
      group.key === '-' ? group : { ...group, key: tokenUsageSourceLabel(group.key, t) }
    ),
    successRate: `${Math.round((summary.successful / requestCount) * 100)}%`,
    tokenMoneyTotal: `${formatTokenCount(summary.tokenTotal, locale)}/ ${formatTokenCost(
      summary.tokenTotal,
      locale
    )}`,
    tokenTotal: formatTokenCount(summary.tokenTotal, locale),
    totalTraffic: formatBytes(summary.requestBytes, locale),
    trafficTotal: `${formatMegabytes(summary.requestBytes, locale)}/ ${formatMegabytes(
      summary.responseBytes,
      locale
    )}`,
    topAccounts: summary.accountGroups,
    topDays: summary.dayGroups,
    topModels: summary.modelGroups,
    topTurns: summary.turnGroups
  }
}

function formatTokenCount(value: number, locale: PageProps['locale']): string {
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
  if (value >= 1_000_000) {
    return `${formatter.format(value / 1_000_000)}M`
  }
  if (value >= 1_000) {
    return `${formatter.format(value / 1_000)}K`
  }
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)
}

function formatTokenCost(tokens: number, locale: PageProps['locale']): string {
  const usd = (tokens / 1_000_000) * 5
  return `$${new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2
  }).format(usd)}`
}

function formatMegabytes(value: number, locale: PageProps['locale']): string {
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
  return `${formatter.format(Math.max(0, value) / 1024 / 1024)} Mb`
}
