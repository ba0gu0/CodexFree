import { PageHeader } from '@renderer/components/app-shell/page-header'
import { Button } from '@renderer/components/ui/button'
import { Card, CardHeader, CardPanel, CardTitle } from '@renderer/components/ui/card'
import {
  ApiVolumeCard,
  InferenceLatencyCard
} from '@renderer/components/vectormotion/codexfree-cards'
import { formatTokenCost, formatTokenCount, formatWholeNumber } from '@renderer/data/format'
import { RefreshCwIcon } from 'lucide-react'
import { type ReactElement, useMemo, useState } from 'react'
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
  cost: string
  dailyGroups: TokenGroup[]
  hourlyGroups: TokenGroup[]
  requestsWithUsage: number
  tokenTotal: string
  totals: TokenGroup
}

type TrendMode = 'day' | 'hour'

export function UsagePage({ actions, busyAction, locale, snapshot, t }: PageProps): ReactElement {
  const [trendMode, setTrendMode] = useState<TrendMode>('hour')
  const analysis = useMemo(
    () => buildUsageAnalysis(snapshot.usageSummary, locale),
    [locale, snapshot.usageSummary]
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

      <section className="grid h-[252px] shrink-0 grid-cols-2 gap-3">
        <ApiVolumeCard locale={locale} snapshot={snapshot} t={t} />
        <InferenceLatencyCard locale={locale} snapshot={snapshot} t={t} />
      </section>

      <Card className="min-h-0 flex-1 overflow-hidden rounded-xl shadow-none">
        <CardHeader className="p-4 pb-2">
          <CardTitle>{t('usage.tokenTotals')}</CardTitle>
        </CardHeader>
        <CardPanel className="grid min-h-0 grid-cols-[330px_minmax(0,1fr)] gap-3 p-3 pt-0">
          <TokenOverview analysis={analysis} locale={locale} t={t} />
          <TokenTrendChart
            groups={trendMode === 'hour' ? analysis.hourlyGroups : analysis.dailyGroups}
            locale={locale}
            mode={trendMode}
            onModeChange={setTrendMode}
            t={t}
          />
        </CardPanel>
      </Card>
    </div>
  )
}

function TokenOverview({
  analysis,
  locale,
  t
}: {
  analysis: UsageAnalysis
  locale: PageProps['locale']
  t: PageProps['t']
}): ReactElement {
  const rows = [
    ['usage.tokenInput', analysis.totals.input, 'text-info'],
    ['usage.tokenCached', analysis.totals.cached, 'text-success'],
    ['usage.tokenOutput', analysis.totals.output, 'text-warning'],
    ['usage.tokenReasoning', analysis.totals.reasoning, 'text-muted-foreground']
  ] as const
  return (
    <section className="min-h-0 rounded-lg border bg-background/45 p-4">
      <div className="grid grid-cols-[minmax(0,1fr)_150px] gap-4">
        <div className="min-w-0">
          <div className="font-bold text-muted-foreground text-xs">{t('usage.tokenOverview')}</div>
          <div className="mt-2 truncate font-extrabold text-3xl">{analysis.tokenTotal}</div>
          <div className="mt-1 text-muted-foreground text-xs">
            {t('usage.usageRequests', { count: analysis.requestsWithUsage })} · {analysis.cost}
          </div>
        </div>
        <div className="rounded-lg bg-muted/35 p-3">
          <div className="font-bold text-muted-foreground text-xs">{t('usage.estimatedCost')}</div>
          <div className="mt-2 truncate font-extrabold text-xl">{analysis.cost}</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {rows.map(([key, value, tone]) => (
          <div className="min-w-0 rounded-lg bg-muted/35 p-2" key={key}>
            <div className="truncate font-bold text-muted-foreground text-[11px]">{t(key)}</div>
            <div className={`mt-1 truncate font-extrabold text-xs tabular-nums ${tone}`}>
              {formatWholeNumber(value, locale)}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function TokenTrendChart({
  groups,
  locale,
  mode,
  onModeChange,
  t
}: {
  groups: TokenGroup[]
  locale: PageProps['locale']
  mode: TrendMode
  onModeChange: (mode: TrendMode) => void
  t: PageProps['t']
}): ReactElement {
  const chartGroups = groups.slice(mode === 'hour' ? -24 : -14)
  const peak = Math.max(1, ...chartGroups.map((group) => group.total))
  const peakTotal = Math.max(0, ...chartGroups.map((group) => group.total))
  return (
    <section className={trendCardClass}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-bold text-foreground text-sm">{t('usage.tokenTrendTitle')}</h3>
          <div className="mt-1 truncate text-muted-foreground text-xs">
            {t('usage.peakHour')} {formatWholeNumber(peakTotal, locale)}
          </div>
        </div>
        <div className="inline-flex rounded-lg bg-muted/45 p-1">
          {(['hour', 'day'] as const).map((item) => (
            <button
              className={trendButtonClass(mode === item)}
              key={item}
              onClick={() => onModeChange(item)}
              type="button"
            >
              {t(item === 'hour' ? 'usage.trendHour' : 'usage.trendDay')}
            </button>
          ))}
        </div>
      </div>
      <div
        className={[
          'flex min-h-0 flex-1 items-end gap-1.5 rounded-lg border',
          'bg-muted/20 px-3 pt-4 pb-3'
        ].join(' ')}
      >
        {chartGroups.length === 0 ? (
          <div className="self-center text-muted-foreground text-xs">{t('usage.noTokenUsage')}</div>
        ) : (
          chartGroups.map((group) => (
            <div
              className="min-h-2 flex-1 rounded-t bg-info/35 data-[peak=true]:bg-info"
              data-peak={group.total === peak}
              key={group.key}
              style={{ height: `${Math.max(8, (group.total / peak) * 100)}%` }}
              title={`${group.key}: ${formatWholeNumber(group.total, locale)}`}
            />
          ))
        )}
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {chartGroups.slice(-4).map((group) => (
          <div className="min-w-0 rounded-md bg-muted/30 p-2" key={group.key}>
            <div className="truncate text-muted-foreground text-[11px]" title={group.key}>
              {group.key}
            </div>
            <div className="truncate font-extrabold text-xs tabular-nums">
              {formatWholeNumber(group.total, locale)}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function buildUsageAnalysis(
  summary: PageProps['snapshot']['usageSummary'],
  locale: PageProps['locale']
): UsageAnalysis {
  const totals = totalGroup(summary)
  return {
    cost: formatTokenCost(summary.tokenTotal, locale),
    dailyGroups: [...summary.dayGroups].sort((left, right) => left.key.localeCompare(right.key)),
    hourlyGroups: [...summary.hourGroups].sort((left, right) => left.key.localeCompare(right.key)),
    requestsWithUsage: summary.requestsWithUsage,
    tokenTotal: formatTokenCount(summary.tokenTotal, locale),
    totals
  }
}

const trendCardClass =
  'flex min-h-0 flex-col overflow-hidden rounded-lg border bg-background/45 p-4'

function trendButtonClass(active: boolean): string {
  return [
    'rounded-md px-3 py-1.5 font-bold text-xs transition-colors',
    active
      ? 'bg-background text-foreground shadow-sm'
      : 'text-muted-foreground hover:text-foreground'
  ].join(' ')
}

function totalGroup(summary: PageProps['snapshot']['usageSummary']): TokenGroup {
  return {
    cached: sumGroups(summary.modelGroups, 'cached'),
    count: summary.requestsWithUsage,
    input: sumGroups(summary.modelGroups, 'input'),
    key: 'total',
    output: sumGroups(summary.modelGroups, 'output'),
    reasoning: sumGroups(summary.modelGroups, 'reasoning'),
    total: summary.tokenTotal
  }
}

function sumGroups(
  groups: TokenGroup[],
  key: keyof Pick<TokenGroup, 'cached' | 'input' | 'output' | 'reasoning'>
): number {
  return groups.reduce((total, group) => total + group[key], 0)
}
