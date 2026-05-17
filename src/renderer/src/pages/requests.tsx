import { MetricCard } from '@renderer/components/app-shell/metric-card'
import { PageHeader } from '@renderer/components/app-shell/page-header'
import { StatusBadge } from '@renderer/components/app-shell/status-badge'
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle
} from '@renderer/components/ui/alert-dialog'
import { Button } from '@renderer/components/ui/button'
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle
} from '@renderer/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@renderer/components/ui/input-group'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@renderer/components/ui/table'
import {
  formatDateTime,
  formatDuration,
  redactCaptureContent,
  truncateMiddle
} from '@renderer/data/format'
import {
  accountDisplayForPathFromLookup,
  accountDisplayLookup,
  outcomeKey
} from '@renderer/data/proxy-console'
import { useNearBottomLoadMore } from '@renderer/hooks/use-near-bottom-load-more'
import { useVirtualRows } from '@renderer/hooks/use-virtual-rows'
import { ActivityIcon, FileSearchIcon, SearchIcon, Trash2Icon } from 'lucide-react'
import { type ReactElement, type UIEvent, useMemo, useState } from 'react'
import {
  filterRequests,
  type RequestFilter,
  requestFilters,
  summarizeRequests
} from './requests-model'
import type { PageProps } from './types'

export function RequestsPage({
  actions,
  busyAction,
  capture,
  hasMoreActivity,
  locale,
  onCaptureClose,
  snapshot,
  t
}: PageProps): ReactElement {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<RequestFilter>('all')
  const requests = useMemo(
    () => filterRequests(snapshot.requests, filter, query),
    [filter, query, snapshot.requests]
  )
  const summary = useMemo(() => summarizeRequests(snapshot.requests), [snapshot.requests])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmClearOpen, setConfirmClearOpen] = useState(false)
  const accountLabels = useMemo(
    () => accountDisplayLookup(snapshot.accounts, t('accounts.emailPending')),
    [snapshot.accounts, t]
  )
  const selected = requests.find((request) => request.id === selectedId) ?? requests[0]
  const virtualRequests = useVirtualRows({ rowHeight: 48, rows: requests })
  const maybeLoadMore = useNearBottomLoadMore({
    enabled: hasMoreActivity.requests,
    onLoadMore: actions.loadMoreActivity
  })
  const handleRequestScroll = (event: UIEvent<HTMLDivElement>): void => {
    virtualRequests.onScroll(event)
    maybeLoadMore(event.currentTarget)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
      <PageHeader
        actions={
          <Button
            loading={busyAction === 'clear'}
            onClick={() => setConfirmClearOpen(true)}
            variant="destructive-outline"
          >
            <Trash2Icon data-icon="inline-start" />
            {t('action.clearRecords')}
          </Button>
        }
        description={t('requests.desc')}
        title={t('requests.title')}
      />

      <section className="grid shrink-0 grid-cols-5 gap-3">
        <MetricCard label={t('metric.requests')} value={String(summary.total)} />
        <MetricCard
          label={t('outcome.forwarded')}
          tone="success"
          value={String(summary.forwarded)}
        />
        <MetricCard
          label={t('outcome.quota_exhausted')}
          tone="warning"
          value={String(summary.quota)}
        />
        <MetricCard label={t('outcome.rejected')} tone="error" value={String(summary.rejected)} />
        <MetricCard label={t('action.openCapture')} value={String(summary.captured)} />
      </section>

      <section className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px] min-[1400px]:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="min-w-0 overflow-hidden rounded-xl shadow-none">
          <CardHeader className="pb-3">
            <CardTitle>{t('requests.timeline')}</CardTitle>
            <CardDescription>
              {t('requests.visibleCount', { visible: requests.length })}
            </CardDescription>
          </CardHeader>
          <CardPanel className="flex min-h-0 flex-col gap-3 pt-0">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <InputGroup className="min-w-0 lg:w-72 min-[1400px]:w-96">
                <InputGroupAddon>
                  <SearchIcon />
                </InputGroupAddon>
                <InputGroupInput
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('requests.search')}
                  type="search"
                  value={query}
                />
              </InputGroup>
              <div className="flex flex-wrap gap-1.5">
                {requestFilters.map((item) => (
                  <Button
                    className={
                      filter === item
                        ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                        : ''
                    }
                    key={item}
                    onClick={() => setFilter(item)}
                    size="sm"
                    variant="ghost"
                  >
                    {requestFilterLabel(item, t)}
                  </Button>
                ))}
              </div>
            </div>

            {requests.length === 0 ? (
              <div className="rounded-lg border bg-muted/40 p-6 text-muted-foreground text-sm">
                {t('requests.empty')}
              </div>
            ) : (
              <div
                className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-lg border [overflow-anchor:none]"
                onScroll={handleRequestScroll}
                ref={virtualRequests.containerRef}
              >
                <Table
                  aria-rowcount={requests.length}
                  className="table-fixed text-xs min-[1400px]:text-sm"
                >
                  <colgroup>
                    <col className="w-[54px]" />
                    <col />
                    <col className="w-[72px]" />
                    <col className="w-[82px]" />
                    <col className="w-[112px]" />
                    <col className="w-[58px]" />
                    <col className="w-[76px]" />
                    <col className="w-[116px]" />
                    <col className="w-[68px]" />
                  </colgroup>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('table.method')}</TableHead>
                      <TableHead>{t('table.path')}</TableHead>
                      <TableHead>{t('table.mode')}</TableHead>
                      <TableHead>{t('table.outcome')}</TableHead>
                      <TableHead>{t('table.accountId')}</TableHead>
                      <TableHead>{t('table.code')}</TableHead>
                      <TableHead>{t('table.duration')}</TableHead>
                      <TableHead>{t('table.startedAt')}</TableHead>
                      <TableHead>{t('table.action')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableSpacerRow colSpan={9} height={virtualRequests.topPadding} />
                    {virtualRequests.rows.map(({ item: request }) => {
                      const accountDisplay = accountDisplayForPathFromLookup(
                        accountLabels,
                        request.accountId,
                        request.path,
                        t('accounts.emailPending'),
                        t('accounts.originalAccount')
                      )
                      return (
                        <TableRow
                          className={selected?.id === request.id ? 'h-12 bg-muted/60' : 'h-12'}
                          key={request.id}
                          onClick={() => setSelectedId(request.id)}
                        >
                          <TableCell className="overflow-hidden truncate">
                            {request.method}
                          </TableCell>
                          <TableCell
                            className="max-w-0 overflow-hidden truncate"
                            title={request.path}
                          >
                            {request.path}
                          </TableCell>
                          <TableCell
                            className="max-w-0 overflow-hidden truncate"
                            title={request.mode}
                          >
                            {requestModeLabel(request.mode, t)}
                          </TableCell>
                          <TableCell className="max-w-0 overflow-hidden">
                            <StatusBadge tone={outcomeTone(request.outcome)}>
                              {t(outcomeKey(request.outcome))}
                            </StatusBadge>
                          </TableCell>
                          <TableCell
                            className="max-w-0 overflow-hidden truncate"
                            title={accountDisplay}
                          >
                            {accountDisplay}
                          </TableCell>
                          <TableCell className="overflow-hidden truncate">
                            {request.statusCode ?? '-'}
                          </TableCell>
                          <TableCell className="max-w-0 overflow-hidden truncate">
                            {formatDuration(request.durationMs, locale)}
                          </TableCell>
                          <TableCell className="max-w-0 overflow-hidden truncate">
                            {formatDateTime(request.startedAt, locale)}
                          </TableCell>
                          <TableCell className="overflow-hidden truncate">
                            {request.rawCapturePath ? (
                              <Button
                                onClick={(event) => {
                                  event.stopPropagation()
                                  actions.openCapture(request.id)
                                }}
                                size="sm"
                                variant="outline"
                              >
                                {t('action.openCapture')}
                              </Button>
                            ) : (
                              '-'
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                    <TableSpacerRow colSpan={9} height={virtualRequests.bottomPadding} />
                  </TableBody>
                </Table>
              </div>
            )}
          </CardPanel>
        </Card>

        <aside className="flex min-h-0 min-w-0 flex-col gap-4 overflow-hidden">
          <Card className="h-full min-h-0 overflow-hidden rounded-xl shadow-none">
            <CardHeader className="pb-3">
              <CardTitle>{t('requests.selected')}</CardTitle>
              <CardDescription>
                {selected ? selected.method : t('requests.noSelection')}
              </CardDescription>
            </CardHeader>
            <CardPanel className="flex h-[calc(100%-74px)] min-h-0 flex-col gap-3 overflow-y-auto">
              {selected ? (
                <>
                  <div className="rounded-lg bg-muted/55 p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <FileSearchIcon data-icon="inline-start" />
                      <StatusBadge tone={outcomeTone(selected.outcome)}>
                        {t(outcomeKey(selected.outcome))}
                      </StatusBadge>
                    </div>
                    <div className="break-all font-semibold text-foreground text-sm">
                      {selected.path}
                    </div>
                  </div>
                  <div className="grid gap-2 rounded-lg bg-muted/45 p-3">
                    <RequestDetail
                      label={t('table.startedAt')}
                      value={formatDateTime(selected.startedAt, locale)}
                    />
                    <RequestDetail
                      label={t('table.duration')}
                      value={formatDuration(selected.durationMs, locale)}
                    />
                    <RequestDetail
                      label={t('table.accountId')}
                      value={accountDisplayForPathFromLookup(
                        accountLabels,
                        selected.accountId,
                        selected.path,
                        t('accounts.emailPending'),
                        t('accounts.originalAccount')
                      )}
                    />
                    <RequestDetail
                      label={t('requests.conversation')}
                      value={
                        selected.conversationKey ? truncateMiddle(selected.conversationKey) : '-'
                      }
                    />
                    <RequestDetail label={t('requests.upstream')} value={selected.upstreamHost} />
                    <RequestDetail label={t('proxy.outboundMode')} value={selected.outboundMode} />
                    {selected.errorMessage ? (
                      <RequestDetail
                        label={t('requests.errorMessage')}
                        value={selected.errorMessage}
                      />
                    ) : null}
                  </div>
                  <Button
                    disabled={!selected.rawCapturePath}
                    onClick={() => actions.openCapture(selected.id)}
                    variant="outline"
                  >
                    <ActivityIcon data-icon="inline-start" />
                    {selected.rawCapturePath ? t('action.openCapture') : t('requests.noCapture')}
                  </Button>
                </>
              ) : (
                <div className="rounded-lg border bg-muted/40 p-6 text-muted-foreground text-sm">
                  {t('requests.noSelection')}
                </div>
              )}
            </CardPanel>
          </Card>
        </aside>
      </section>

      <Dialog
        open={capture !== null}
        onOpenChange={(open) => (!open ? onCaptureClose() : undefined)}
      >
        <DialogPopup className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t('dialog.captureTitle')}</DialogTitle>
            <DialogDescription>{t('dialog.captureDesc')}</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            {capture ? (
              <div className="flex flex-col gap-4">
                <div className="rounded-lg border bg-muted/40 p-3 font-mono text-xs">
                  {t('dialog.captureDirectory')}: {capture.directory}
                </div>
                {capture.files.map((file) => (
                  <section className="flex flex-col gap-2" key={file.name}>
                    <div className="font-medium text-sm">{file.name}</div>
                    <pre className="max-h-72 overflow-auto rounded-lg bg-muted p-3 text-xs leading-5">
                      {redactCaptureContent(file.content)}
                    </pre>
                  </section>
                ))}
              </div>
            ) : null}
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>{t('action.close')}</DialogClose>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <AlertDialog open={confirmClearOpen} onOpenChange={setConfirmClearOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('requests.clearConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('requests.clearConfirmDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {t('action.cancel')}
            </AlertDialogClose>
            <Button
              loading={busyAction === 'clear'}
              onClick={() => {
                setConfirmClearOpen(false)
                void actions.clearRecords()
              }}
              variant="destructive-outline"
            >
              <Trash2Icon data-icon="inline-start" />
              {t('action.clearRecords')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  )
}

function outcomeTone(outcome: string): 'default' | 'success' | 'warning' | 'error' {
  if (outcome === 'forwarded') {
    return 'success'
  }
  if (outcome === 'quota_exhausted') {
    return 'warning'
  }
  if (outcome === 'failed' || outcome === 'rejected') {
    return 'error'
  }
  return 'default'
}

function requestModeLabel(mode: string, t: PageProps['t']): string {
  if (mode === 'account') {
    return t('requests.mode.account')
  }
  if (mode === 'account_passthrough') {
    return t('requests.mode.original')
  }
  if (mode === 'api_key') {
    return t('requests.mode.apiKey')
  }
  return t('requests.mode.unknown')
}

function TableSpacerRow({
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
    <TableRow aria-hidden className="border-0">
      <TableCell className="p-0" colSpan={colSpan} style={{ height }} />
    </TableRow>
  )
}

function RequestDetail({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="grid min-w-0 grid-cols-[76px_minmax(0,1fr)] items-start gap-2 text-xs">
      <div className="font-bold text-muted-foreground">{label}</div>
      <div className="truncate font-mono text-foreground" title={value}>
        {value}
      </div>
    </div>
  )
}

function requestFilterLabel(filter: RequestFilter, t: PageProps['t']): string {
  if (filter === 'all') {
    return t('dashboard.filterAll')
  }
  return t(outcomeKey(filter))
}
