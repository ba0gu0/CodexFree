import { Card, CardHeader, CardPanel, CardTitle } from '@renderer/components/ui/card'
import {
  logEventDisplayMeta,
  logEventDisplayTitle,
  protocolMessageDisplayTitle,
  requestDisplayTitle
} from '@renderer/data/activity-display'
import { formatBytes, formatDateTime, formatDuration } from '@renderer/data/format'
import { accountDisplayForPathFromLookup, requestByteSummary } from '@renderer/data/proxy-console'
import { useNearBottomLoadMore } from '@renderer/hooks/use-near-bottom-load-more'
import { useVirtualRows } from '@renderer/hooks/use-virtual-rows'
import { type ReactElement, type UIEvent, useEffect, useMemo, useState } from 'react'
import {
  filterRequestTimeline,
  type RequestFilter,
  type RequestSelectFilter,
  type RequestTimelineItem,
  timelineAccountId
} from './requests-model'
import { RequestFilters } from './requests-timeline-filters'
import {
  nextRequestSort,
  type RequestSort,
  type RequestSortKey,
  requestColumns,
  requestFilterOptionSets,
  sortTimelineItems,
  timelineModelLabel,
  timelinePurposeLabel,
  timelineStatusClass,
  timelineStatusText,
  timelineTokenSource,
  timelineTokenText
} from './requests-timeline-model'
import type { PageProps } from './types'

interface RequestTimelinePanelProps {
  accountLabels: Map<string, string>
  hasMoreActivity: PageProps['hasMoreActivity']
  initialQuery: string | null
  locale: PageProps['locale']
  onLoadMore: PageProps['actions']['loadMoreActivity']
  onSelect: (id: string) => void
  selectedId: string | null
  t: PageProps['t']
  timelineItems: RequestTimelineItem[]
}

export function RequestTimelinePanel({
  accountLabels,
  hasMoreActivity,
  initialQuery,
  locale,
  onLoadMore,
  onSelect,
  selectedId,
  t,
  timelineItems
}: RequestTimelinePanelProps): ReactElement {
  const [query, setQuery] = useState(initialQuery ?? '')
  const [outcomeFilter, setOutcomeFilter] = useState<RequestFilter>('all')
  const [purposeFilter, setPurposeFilter] = useState<RequestSelectFilter>('all')
  const [modelFilter, setModelFilter] = useState<RequestSelectFilter>('all')
  const [sort, setSort] = useState<RequestSort>({ direction: 'desc', key: 'startedAt' })
  const filteredItems = useMemo(
    () => filterRequestTimeline(timelineItems, outcomeFilter, purposeFilter, modelFilter, query),
    [modelFilter, outcomeFilter, purposeFilter, query, timelineItems]
  )
  const timeline = useMemo(() => sortTimelineItems(filteredItems, sort), [filteredItems, sort])
  const filterOptions = useMemo(() => requestFilterOptionSets(timelineItems, t), [timelineItems, t])
  const virtualRows = useVirtualRows({ rowHeight: 48, rows: timeline })
  const columns = requestColumns(t)
  const maybeLoadMore = useNearBottomLoadMore({
    enabled:
      hasMoreActivity.requests || hasMoreActivity.logEvents || hasMoreActivity.protocolMessages,
    onLoadMore
  })

  useEffect(() => {
    setQuery(initialQuery ?? '')
  }, [initialQuery])

  useEffect(() => {
    if (timeline.length === 0) {
      return
    }
    if (!selectedId || !timeline.some((item) => item.id === selectedId)) {
      onSelect(timeline[0].id)
    }
  }, [onSelect, selectedId, timeline])

  const handleScroll = (event: UIEvent<HTMLDivElement>): void => {
    virtualRows.onScroll(event)
    maybeLoadMore(event.currentTarget)
  }

  return (
    <Card className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl shadow-none">
      <CardHeader className="p-4 pb-2">
        <CardTitle>{t('requests.timeline')}</CardTitle>
      </CardHeader>
      <CardPanel className="flex min-h-0 flex-col p-3 pt-0">
        <RequestFilters
          modelFilter={modelFilter}
          modelOptions={filterOptions.models}
          onModelChange={setModelFilter}
          onOutcomeChange={setOutcomeFilter}
          onPurposeChange={setPurposeFilter}
          onQueryChange={setQuery}
          outcomeFilter={outcomeFilter}
          purposeFilter={purposeFilter}
          purposeOptions={filterOptions.purposes}
          query={query}
          t={t}
        />
        {timeline.length === 0 ? (
          <div className="rounded-lg border bg-muted/40 p-6 text-muted-foreground text-sm">
            {t('requests.empty')}
          </div>
        ) : (
          <RequestTimelineTable
            accountLabels={accountLabels}
            columns={columns}
            locale={locale}
            onScroll={handleScroll}
            onSelect={onSelect}
            onSort={(key) => setSort((current) => nextRequestSort(current, key))}
            rowCount={timeline.length}
            selectedId={selectedId}
            sort={sort}
            t={t}
            virtualRows={virtualRows}
          />
        )}
      </CardPanel>
    </Card>
  )
}

function RequestTimelineTable({
  accountLabels,
  columns,
  locale,
  onScroll,
  onSelect,
  onSort,
  rowCount,
  selectedId,
  sort,
  t,
  virtualRows
}: {
  accountLabels: Map<string, string>
  columns: Array<{ key: RequestSortKey; label: string }>
  locale: PageProps['locale']
  onScroll: (event: UIEvent<HTMLDivElement>) => void
  onSelect: (id: string) => void
  onSort: (key: RequestSortKey) => void
  rowCount: number
  selectedId: string | null
  sort: RequestSort
  t: PageProps['t']
  virtualRows: ReturnType<typeof useVirtualRows<RequestTimelineItem>>
}): ReactElement {
  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-lg border [overflow-anchor:none]"
      onScroll={onScroll}
      ref={virtualRows.containerRef}
    >
      <table
        aria-rowcount={rowCount}
        className="w-full table-fixed border-separate border-spacing-0 text-[11px] min-[1400px]:text-xs"
      >
        <colgroup>
          <col className="w-[86px] min-[1400px]:w-[116px]" />
          <col className="w-[54px] min-[1400px]:w-[72px]" />
          <col className="w-[74px] min-[1400px]:w-[96px]" />
          <col />
          <col className="w-[88px] min-[1400px]:w-[112px]" />
          <col className="w-[70px] min-[1400px]:w-[92px]" />
          <col className="w-[100px] min-[1400px]:w-[150px]" />
          <col className="w-[58px] min-[1400px]:w-[76px]" />
          <col className="w-[72px] min-[1400px]:w-[112px]" />
        </colgroup>
        <RequestTimelineHeader columns={columns} onSort={onSort} sort={sort} />
        <tbody>
          <PlainSpacerRow colSpan={9} height={virtualRows.topPadding} />
          {virtualRows.rows.map(({ index, item }) => (
            <RequestTimelineRow
              accountLabels={accountLabels}
              index={index}
              item={item}
              key={item.id}
              locale={locale}
              onSelect={onSelect}
              selected={selectedId === item.id}
              t={t}
            />
          ))}
          <PlainSpacerRow colSpan={9} height={virtualRows.bottomPadding} />
        </tbody>
      </table>
    </div>
  )
}

function RequestTimelineHeader({
  columns,
  onSort,
  sort
}: {
  columns: Array<{ key: RequestSortKey; label: string }>
  onSort: (key: RequestSortKey) => void
  sort: RequestSort
}): ReactElement {
  return (
    <thead className="sticky top-0 z-10">
      <tr className="bg-muted/60 text-muted-foreground">
        {columns.map((column, index) => (
          <th className={headerClassName(index, columns.length)} key={column.key}>
            <button
              className="block w-full truncate text-left"
              onClick={() => onSort(column.key)}
              type="button"
            >
              {column.label}
              {sort.key === column.key ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ''}
            </button>
          </th>
        ))}
      </tr>
    </thead>
  )
}

function RequestTimelineRow({
  accountLabels,
  index,
  item,
  locale,
  onSelect,
  selected,
  t
}: {
  accountLabels: Map<string, string>
  index: number
  item: RequestTimelineItem
  locale: PageProps['locale']
  onSelect: (id: string) => void
  selected: boolean
  t: PageProps['t']
}): ReactElement {
  const accountDisplay = accountDisplayForPathFromLookup(
    accountLabels,
    timelineAccountId(item),
    timelineItemPath(item),
    t('accounts.emailPending'),
    t('accounts.originalAccount')
  )
  const title = timelineTitle(item, t)
  return (
    <tr
      className={[
        'h-12 cursor-pointer',
        selected ? 'bg-muted/60' : index % 2 === 0 ? 'bg-card' : 'bg-muted/40'
      ].join(' ')}
      onClick={() => onSelect(item.id)}
    >
      <TimelineCell className="font-semibold text-muted-foreground">
        {formatDateTime(item.timestamp, locale)}
      </TimelineCell>
      <TimelineCell className={`font-bold ${timelineStatusClass(item)}`}>
        {timelineStatusText(item, t)}
      </TimelineCell>
      <TimelineCell className="font-semibold">{timelinePurposeLabel(item, t)}</TimelineCell>
      <TimelineCell className="font-semibold" title={title}>
        {title}
      </TimelineCell>
      <TimelineCell className="font-semibold text-muted-foreground" title={accountDisplay}>
        {accountDisplay}
      </TimelineCell>
      <TimelineCell>{timelineModelLabel(item)}</TimelineCell>
      <TimelineCell title={timelineTokenSource(item, t)}>
        {timelineTokenText(item, locale)}
      </TimelineCell>
      <TimelineCell className="text-right">
        {item.kind === 'request' ? formatDuration(item.request.durationMs, locale) : '-'}
      </TimelineCell>
      <TimelineCell className="text-right">{timelineByteText(item, locale)}</TimelineCell>
    </tr>
  )
}

function timelineTitle(item: RequestTimelineItem, t: PageProps['t']): string {
  if (item.kind === 'request') {
    return requestDisplayTitle(item.request, t)
  }
  if (item.kind === 'protocol') {
    return protocolMessageDisplayTitle(item.message, t)
  }
  return `${logEventDisplayTitle(item.event, t)} · ${logEventDisplayMeta(item.event, t)}`
}

function timelineByteText(item: RequestTimelineItem, locale: PageProps['locale']): string {
  if (item.kind === 'request') {
    return requestByteSummary(item.request, locale)
  }
  if (item.kind === 'protocol') {
    return formatBytes(item.message.payloadBytes, locale)
  }
  return '-'
}

function timelineItemPath(item: RequestTimelineItem): string | null {
  if (item.kind === 'request') {
    return item.request.path
  }
  if (item.kind === 'protocol') {
    return item.message.path
  }
  return item.event.path
}

function TimelineCell({
  children,
  className = '',
  title
}: {
  children: string
  className?: string
  title?: string
}): ReactElement {
  return (
    <td className={`max-w-0 overflow-hidden px-2 align-middle min-[1400px]:px-3 ${className}`}>
      <span className="block truncate" title={title ?? children}>
        {children}
      </span>
    </td>
  )
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
    <tr aria-hidden className="border-0">
      <td className="p-0" colSpan={colSpan} style={{ height }} />
    </tr>
  )
}

function headerClassName(index: number, total: number): string {
  const base = 'h-9 px-2 text-left align-middle font-bold leading-none min-[1400px]:px-3'
  if (index === 0) {
    return `${base} rounded-l-lg`
  }
  if (index === total - 1) {
    return `${base} rounded-r-lg`
  }
  return base
}
