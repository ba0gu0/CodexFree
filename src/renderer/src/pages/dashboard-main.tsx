import { Button } from '@renderer/components/ui/button'
import { CodeBlock } from '@renderer/components/ui/code-block'
import { formatBytes } from '@renderer/data/format'
import { codexConfigText, requestPurposeLabel } from '@renderer/data/proxy-console'
import { useNearBottomLoadMore } from '@renderer/hooks/use-near-bottom-load-more'
import { useVirtualRows } from '@renderer/hooks/use-virtual-rows'
import { type ReactElement, type UIEvent, useMemo, useState } from 'react'
import {
  type ActivityFilter,
  type ActivityRow,
  activityFilters,
  kindClass,
  typeLabel
} from './dashboard-model'
import type { PageProps } from './types'

const panel = 'rounded-xl border border-border/70 bg-card p-4 shadow-sm'
const muted = 'text-muted-foreground'
const title = 'font-extrabold text-foreground'

export function ProxyControlPanel({
  locale,
  snapshot,
  t
}: Pick<PageProps, 'locale' | 'snapshot' | 't'>): ReactElement {
  const runtime = snapshot.status.runtime
  const traffic = {
    downTotal: snapshot.usageSummary.responseBytes,
    upTotal: snapshot.usageSummary.requestBytes
  }
  return (
    <section
      className={`${panel} flex h-full min-h-0 flex-col gap-2.5 p-4 min-[1400px]:gap-3 min-[1400px]:p-5`}
    >
      <div className="flex h-9 shrink-0 items-center justify-between gap-4 min-[1400px]:h-12">
        <h2 className={`${title} truncate text-xl min-[1400px]:text-2xl`}>
          {t('dashboard.proxyConfig')}
        </h2>
        <span className="shrink-0 rounded-full bg-success/12 px-5 py-1.5 font-bold text-success text-sm min-[1400px]:px-7 min-[1400px]:py-2 min-[1400px]:text-base">
          {snapshot.status.running ? t('status.running') : t('status.stopped')}
        </span>
      </div>
      <CodeBlock
        className="code-scrollbar-hidden max-h-[112px] shrink-0 [&_button]:size-7 [&_code]:whitespace-pre [&_pre]:p-3 [&_pre]:text-[10px] min-[1400px]:max-h-[120px] min-[1400px]:[&_pre]:text-[11px]"
        code={codexConfigText(snapshot.status)}
        language="toml"
      />
      <div className="grid min-h-0 flex-1 grid-cols-3 gap-2 text-xs">
        <RuntimeStat
          label={t('dashboard.runMode')}
          value={
            snapshot.daemonControl.launchAgent.enabled
              ? t('dashboard.runModeService')
              : t('dashboard.runModeApp')
          }
        />
        <RuntimeStat
          label={t('dashboard.totalPackets')}
          value={`${formatTrafficBytes(traffic.upTotal, locale)} / ${formatTrafficBytes(traffic.downTotal, locale)}`}
        />
        <RuntimeStat
          label={t('dashboard.activeSessions')}
          value={String(runtime?.activeWebSocketSessions ?? 0)}
        />
      </div>
    </section>
  )
}

export function AccountPoolPanel({ snapshot, t }: Pick<PageProps, 'snapshot' | 't'>): ReactElement {
  const available = snapshot.status.authPoolAvailableAccounts
  const purposeStats = topPurposeStats(snapshot.requestSummary.purposeGroups, t)
  return (
    <section
      className={`${panel} flex h-full min-h-0 flex-col gap-2.5 p-4 min-[1400px]:gap-3 min-[1400px]:p-5`}
    >
      <div className="flex h-9 shrink-0 items-center justify-between gap-3 min-[1400px]:h-11">
        <h2 className={`${title} truncate text-lg min-[1400px]:text-2xl`}>
          {t('dashboard.accountPoolHealth')}
        </h2>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-3 gap-2">
        <SmallStat label={t('metric.available')} value={String(available)} />
        <SmallStat
          label={t('metric.exhausted')}
          tone="warn"
          value={String(snapshot.status.authPoolExhaustedAccounts)}
        />
        <SmallStat
          label={t('account.disabled')}
          value={String(snapshot.status.authPoolDisabledAccounts)}
        />
        {purposeStats.map((item) => (
          <SmallStat key={item.label} label={item.label} value={String(item.count)} />
        ))}
      </div>
    </section>
  )
}

export function RecentActivityPanel({
  actions,
  filter,
  hasMoreActivity,
  rows,
  setFilter,
  t
}: {
  actions: PageProps['actions']
  filter: ActivityFilter
  hasMoreActivity: PageProps['hasMoreActivity']
  rows: ActivityRow[]
  setFilter: (filter: ActivityFilter) => void
  t: PageProps['t']
}): ReactElement {
  const [sort, setSort] = useState<ActivitySort>({ direction: 'desc', key: 'time' })
  const sortedRows = useMemo(() => sortActivityRows(rows, sort), [rows, sort])
  const virtualRows = useVirtualRows({ rowHeight: 48, rows: sortedRows })
  const maybeLoadMore = useNearBottomLoadMore({
    enabled: hasMoreActivity.requests || hasMoreActivity.logEvents,
    onLoadMore: actions.loadMoreActivity
  })
  const handleScroll = (event: UIEvent<HTMLDivElement>): void => {
    virtualRows.onScroll(event)
    maybeLoadMore(event.currentTarget)
  }

  return (
    <section
      className={`${panel} flex min-h-0 flex-1 flex-col gap-3 p-4 min-[1400px]:gap-4 min-[1400px]:p-5`}
    >
      <div className="flex h-10 shrink-0 items-center justify-between gap-4">
        <h2 className={`${title} shrink-0 text-xl min-[1400px]:text-2xl`}>
          {t('dashboard.recentEvents')}
        </h2>
        <div className="flex shrink-0 justify-end gap-1.5">
          {activityFilters.map(([id, key]) => (
            <Button
              className={
                filter === id
                  ? 'bg-primary/12 text-foreground ring-1 ring-border hover:bg-primary/14'
                  : 'text-muted-foreground hover:bg-accent/80'
              }
              key={id}
              onClick={() => setFilter(id)}
              size="sm"
              variant="ghost"
            >
              {t(key)}
            </Button>
          ))}
        </div>
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [overflow-anchor:none]"
        onScroll={handleScroll}
        ref={virtualRows.containerRef}
      >
        <table
          aria-rowcount={sortedRows.length}
          className="w-full table-fixed border-separate border-spacing-0 text-left text-xs leading-tight min-[1400px]:text-sm"
        >
          <colgroup>
            <col className="w-[104px] min-[1400px]:w-[128px]" />
            <col className="w-[58px] min-[1400px]:w-[78px]" />
            <col />
            <col className="w-[100px] min-[1400px]:w-[170px]" />
            <col className="w-[54px] min-[1400px]:w-[76px]" />
            <col className="w-[58px] min-[1400px]:w-[70px]" />
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className="bg-muted/60 text-muted-foreground">
              {activityColumns(t).map((column) => (
                <th
                  className="h-9 overflow-hidden px-2 font-bold first:rounded-l-lg last:rounded-r-lg min-[1400px]:px-3"
                  key={column.key}
                >
                  <button
                    className="block w-full truncate text-left"
                    onClick={() => setSort(nextActivitySort(sort, column.key))}
                    type="button"
                  >
                    {column.label}
                    {sort.key === column.key ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr>
                <td className={`${muted} h-12 px-2 font-semibold min-[1400px]:px-3`} colSpan={6}>
                  {t('status.empty')}
                </td>
              </tr>
            ) : (
              <>
                <PlainSpacerRow colSpan={6} height={virtualRows.topPadding} />
                {virtualRows.rows.map(({ index, item: row }) => (
                  <tr
                    className={index % 2 === 0 ? 'h-12 bg-card' : 'h-12 bg-muted/40'}
                    key={row.id}
                  >
                    <td className={`${muted} overflow-hidden px-2 font-semibold min-[1400px]:px-3`}>
                      <span className="block truncate">{row.time}</span>
                    </td>
                    <td
                      className={`overflow-hidden px-2 font-bold min-[1400px]:px-3 ${kindClass(row.kind)}`}
                    >
                      <span className="block truncate">{typeLabel(row.kind, t)}</span>
                    </td>
                    <td className="overflow-hidden px-2 font-semibold text-foreground min-[1400px]:px-3">
                      <span className="block truncate">{row.event}</span>
                    </td>
                    <td className="overflow-hidden px-2 font-semibold text-muted-foreground min-[1400px]:px-3">
                      <span className="block truncate">{row.account}</span>
                    </td>
                    <td
                      className={`overflow-hidden px-2 font-bold min-[1400px]:px-3 ${statusColor(row.kind)}`}
                    >
                      <span className="block truncate">{row.status}</span>
                    </td>
                    <td
                      className={`${muted} overflow-hidden px-2 text-right font-semibold min-[1400px]:px-3`}
                    >
                      <span className="block truncate">{row.duration}</span>
                    </td>
                  </tr>
                ))}
                <PlainSpacerRow colSpan={6} height={virtualRows.bottomPadding} />
              </>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

type SortDirection = 'asc' | 'desc'
type ActivitySortKey = 'account' | 'duration' | 'event' | 'kind' | 'status' | 'time'

interface ActivitySort {
  direction: SortDirection
  key: ActivitySortKey
}

function activityColumns(t: PageProps['t']): Array<{ key: ActivitySortKey; label: string }> {
  return [
    { key: 'time', label: t('table.startedAt') },
    { key: 'kind', label: t('table.mode') },
    { key: 'event', label: t('dashboard.pathEvent') },
    { key: 'account', label: t('table.account') },
    { key: 'status', label: t('table.status') },
    { key: 'duration', label: t('dashboard.latency') }
  ]
}

function nextActivitySort(current: ActivitySort, key: ActivitySortKey): ActivitySort {
  return {
    direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    key
  }
}

function sortActivityRows(rows: ActivityRow[], sort: ActivitySort): ActivityRow[] {
  return [...rows].sort((left, right) => compareActivityRows(left, right, sort))
}

function compareActivityRows(left: ActivityRow, right: ActivityRow, sort: ActivitySort): number {
  const direction = sort.direction === 'asc' ? 1 : -1
  if (sort.key === 'time') {
    return (left.timestamp - right.timestamp) * direction
  }
  const leftValue = left[sort.key]
  const rightValue = right[sort.key]
  return String(leftValue).localeCompare(String(rightValue)) * direction
}

function PlainSpacerRow({
  colSpan,
  height
}: {
  colSpan: number
  height: number
}): ReactElement | null {
  if (height <= 0) {
    return null
  }
  return (
    <tr aria-hidden>
      <td colSpan={colSpan} style={{ border: 0, height, padding: 0 }} />
    </tr>
  )
}

function RuntimeStat({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="min-w-0 rounded-lg bg-muted/45 p-2">
      <div className="truncate font-bold text-[10px] text-muted-foreground min-[1400px]:text-xs">
        {label}
      </div>
      <div className="mt-1 truncate font-semibold text-foreground text-[11px] min-[1400px]:text-xs">
        {value}
      </div>
    </div>
  )
}

function topPurposeStats(
  groups: PageProps['snapshot']['requestSummary']['purposeGroups'],
  t: PageProps['t']
): Array<{ count: number; label: string }> {
  return groups
    .slice(0, 3)
    .map((group) => ({ count: group.count, label: requestPurposeLabel(group.key, t) }))
}

function formatTrafficBytes(value: number, locale: PageProps['locale']): string {
  return value <= 0 ? '0 B' : formatBytes(value, locale)
}

function SmallStat({
  label,
  tone,
  value
}: {
  label: string
  tone?: 'bad' | 'warn'
  value: string
}): ReactElement {
  const className =
    tone === 'bad'
      ? 'bg-destructive/12 text-destructive'
      : tone === 'warn'
        ? 'bg-warning/12 text-warning'
        : 'bg-muted/60 text-foreground'
  return (
    <div className={`min-h-0 rounded-lg p-1.5 text-center ${className}`}>
      <div className="font-bold text-lg leading-none min-[1400px]:text-xl">{value}</div>
      <div className="mt-1 font-semibold text-[10px] text-muted-foreground leading-tight">
        {label}
      </div>
    </div>
  )
}

function statusColor(kind: ActivityRow['kind']): string {
  if (kind === 'error' || kind === 'rejected') {
    return 'text-destructive'
  }
  if (kind === 'network' || kind === 'quota' || kind === 'auth') {
    return 'text-warning'
  }
  return 'text-success'
}
