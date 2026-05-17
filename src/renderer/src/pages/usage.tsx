import { MetricCard } from '@renderer/components/app-shell/metric-card'
import { PageHeader } from '@renderer/components/app-shell/page-header'
import { Button } from '@renderer/components/ui/button'
import { Card, CardHeader, CardPanel, CardTitle } from '@renderer/components/ui/card'
import { formatBytes } from '@renderer/data/format'
import type { RecentRequest } from '@renderer/data/proxy-console'
import type { CopyKey } from '@renderer/i18n/copy'
import { BarChart3Icon, RefreshCwIcon } from 'lucide-react'
import { type ReactElement, useMemo } from 'react'
import type { PageProps } from './types'

interface UsageAnalysis {
  activeStreams: number
  averageDuration: string
  averagePayload: string
  downloadTraffic: string
  failureRate: string
  httpRequests: number
  p95Duration: string
  requestCount: number
  resultBuckets: Array<{
    count: number
    key: CopyKey
    percent: number
    tone: 'success' | 'warning' | 'error' | 'default'
  }>
  successRate: string
  totalTraffic: string
  uploadTraffic: string
  wssMessages: number
}

export function UsagePage({ actions, busyAction, locale, snapshot, t }: PageProps): ReactElement {
  const analysis = useMemo(
    () => buildUsageAnalysis(snapshot.requests, locale),
    [locale, snapshot.requests]
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

      <section className="grid shrink-0 grid-cols-4 gap-3">
        <MetricCard label={t('usage.totalTraffic')} value={analysis.totalTraffic} />
        <MetricCard label={t('usage.successRate')} tone="success" value={analysis.successRate} />
        <MetricCard label={t('usage.avgLatency')} value={analysis.averageDuration} />
        <MetricCard label={t('usage.activeStreams')} value={String(analysis.activeStreams)} />
      </section>

      <section className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] gap-3">
        <Card className="min-h-0 overflow-hidden rounded-xl shadow-none">
          <CardHeader className="p-4 pb-2">
            <CardTitle>{t('usage.qualityTitle')}</CardTitle>
          </CardHeader>
          <CardPanel className="grid min-h-0 grid-cols-2 gap-2.5 p-3 pt-0">
            <AnalysisBlock
              label={t('usage.requestWindow')}
              meta={t('usage.recentWindow')}
              value={String(analysis.requestCount)}
            />
            <AnalysisBlock
              label={t('usage.failureRate')}
              meta={t('usage.failureRateDesc')}
              tone="warning"
              value={analysis.failureRate}
            />
            <AnalysisBlock
              label={t('usage.trafficSendReceive')}
              meta={t('usage.trafficDesc')}
              value={analysis.totalTraffic}
            />
            <AnalysisBlock
              label={t('usage.p95Latency')}
              meta={t('usage.p95LatencyDesc')}
              value={analysis.p95Duration}
            />
          </CardPanel>
        </Card>

        <Card className="min-h-0 overflow-hidden rounded-xl shadow-none">
          <CardHeader className="p-4 pb-2">
            <CardTitle>{t('usage.trafficTitle')}</CardTitle>
          </CardHeader>
          <CardPanel className="flex min-h-0 flex-col gap-2.5 p-3 pt-0">
            <div className="grid grid-cols-2 gap-2.5">
              <AnalysisBlock
                label={t('usage.uploadTraffic')}
                meta={t('usage.uploadTrafficDesc')}
                tone="success"
                value={analysis.uploadTraffic}
              />
              <AnalysisBlock
                label={t('usage.downloadTraffic')}
                meta={t('usage.downloadTrafficDesc')}
                tone="warning"
                value={analysis.downloadTraffic}
              />
              <AnalysisBlock
                label={t('usage.httpRequests')}
                meta={t('usage.httpRequestsDesc')}
                value={String(analysis.httpRequests)}
              />
              <AnalysisBlock
                label={t('usage.wssMessages')}
                meta={t('usage.wssMessagesDesc')}
                value={String(analysis.wssMessages)}
              />
            </div>
            <ResultDistribution analysis={analysis} t={t} />
          </CardPanel>
        </Card>
      </section>
    </div>
  )
}

function AnalysisBlock({
  label,
  meta,
  tone = 'default',
  value
}: {
  label: string
  meta: string
  tone?: 'default' | 'success' | 'warning'
  value: string
}): ReactElement {
  return (
    <section className="min-w-0 rounded-lg bg-muted/35 p-2.5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="font-bold text-muted-foreground text-xs">{label}</span>
        <BarChart3Icon className={analysisIcon(tone)} />
      </div>
      <div className="truncate font-extrabold text-foreground text-xl">{value}</div>
      <div className="mt-1 line-clamp-2 text-muted-foreground text-xs">{meta}</div>
    </section>
  )
}

function ResultDistribution({
  analysis,
  t
}: {
  analysis: UsageAnalysis
  t: PageProps['t']
}): ReactElement {
  return (
    <section className="rounded-lg border bg-background/45 p-2.5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <div className="font-bold text-foreground text-sm">{t('usage.resultDistribution')}</div>
          <div className="text-muted-foreground text-xs">{t('usage.resultDistributionDesc')}</div>
        </div>
        <div className="shrink-0 rounded-full bg-muted px-2.5 py-1 font-bold text-foreground text-xs">
          {t('usage.avgPayload')} {analysis.averagePayload}
        </div>
      </div>
      <div className="flex h-3 overflow-hidden rounded-full bg-muted">
        {analysis.resultBuckets.map((bucket) => (
          <span
            className={bucketTone(bucket.tone)}
            key={bucket.key}
            style={{ width: `${bucket.percent}%` }}
            title={`${t(bucket.key)}: ${bucket.count}`}
          />
        ))}
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {analysis.resultBuckets.map((bucket) => (
          <div className="rounded-md bg-muted/35 p-2" key={bucket.key}>
            <div className="font-extrabold text-foreground text-lg">{bucket.count}</div>
            <div className="truncate text-muted-foreground text-[11px]">{t(bucket.key)}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function buildUsageAnalysis(requests: RecentRequest[], locale: PageProps['locale']): UsageAnalysis {
  const failed = requests.filter((request) => request.outcome === 'failed').length
  const rejected = requests.filter((request) => request.outcome === 'rejected').length
  const requestCount = Math.max(requests.length, 1)
  const successful = requests.filter(isSuccessfulRequest)
  const durationValues = requests
    .map((request) => request.durationMs)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right)
  const requestBytes = requests.reduce((sum, request) => sum + request.requestBytes, 0)
  const responseBytes = requests.reduce((sum, request) => sum + request.responseBytes, 0)
  const totalBytes = requestBytes + responseBytes
  const resultBuckets = buildResultBuckets(requests, requestCount)
  const numberFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
  const averageDuration =
    durationValues.length === 0
      ? '-'
      : `${numberFormat.format(
          durationValues.reduce((sum, value) => sum + value, 0) / durationValues.length
        )} ms`
  const p95Duration =
    durationValues.length === 0
      ? '-'
      : `${numberFormat.format(durationValues[Math.ceil(durationValues.length * 0.95) - 1])} ms`

  return {
    activeStreams: requests.filter((request) => request.streaming === 1).length,
    averageDuration,
    averagePayload: requests.length === 0 ? '-' : formatBytes(totalBytes / requests.length, locale),
    downloadTraffic: formatBytes(responseBytes, locale),
    failureRate: `${Math.round(((failed + rejected) / requestCount) * 100)}%`,
    httpRequests: requests.filter((request) => !isWssRequest(request)).length,
    p95Duration,
    requestCount: requests.length,
    resultBuckets,
    successRate: `${Math.round((successful.length / requestCount) * 100)}%`,
    totalTraffic: formatBytes(totalBytes, locale),
    uploadTraffic: formatBytes(requestBytes, locale),
    wssMessages: requests.filter(isWssRequest).length
  }
}

function buildResultBuckets(
  requests: RecentRequest[],
  requestCount: number
): UsageAnalysis['resultBuckets'] {
  const bucketsBase: Array<Omit<UsageAnalysis['resultBuckets'][number], 'percent'>> = [
    {
      count: requests.filter((request) => request.outcome === 'forwarded').length,
      key: 'outcome.forwarded',
      tone: 'success'
    },
    {
      count: requests.filter((request) => request.outcome === 'quota_exhausted').length,
      key: 'outcome.quota_exhausted',
      tone: 'warning'
    },
    {
      count: requests.filter((request) => request.outcome === 'rejected').length,
      key: 'outcome.rejected',
      tone: 'default'
    },
    {
      count: requests.filter((request) => request.outcome === 'failed').length,
      key: 'outcome.failed',
      tone: 'error'
    }
  ]
  const buckets = bucketsBase.map((bucket) => ({
    ...bucket,
    percent: Math.max((bucket.count / requestCount) * 100, bucket.count > 0 ? 3 : 0)
  }))
  return buckets
}

function isSuccessfulRequest(request: RecentRequest): boolean {
  if (request.outcome === 'failed' || request.outcome === 'rejected') {
    return false
  }
  if (request.outcome === 'quota_exhausted') {
    return false
  }
  return request.statusCode === null || request.statusCode < 400
}

function isWssRequest(request: RecentRequest): boolean {
  return request.streaming === 1 || request.method.toUpperCase().includes('WSS')
}

function analysisIcon(tone: 'default' | 'success' | 'warning'): string {
  if (tone === 'success') {
    return 'size-4 text-success'
  }
  if (tone === 'warning') {
    return 'size-4 text-warning'
  }
  return 'size-4 text-muted-foreground'
}

function bucketTone(tone: 'success' | 'warning' | 'error' | 'default'): string {
  if (tone === 'success') {
    return 'bg-success'
  }
  if (tone === 'warning') {
    return 'bg-warning'
  }
  if (tone === 'error') {
    return 'bg-destructive'
  }
  return 'bg-muted-foreground/40'
}
