import { MetricCard } from '@renderer/components/app-shell/metric-card'
import { PageHeader } from '@renderer/components/app-shell/page-header'
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
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { redactCaptureContent } from '@renderer/data/format'
import { accountDisplayLookup } from '@renderer/data/proxy-console'
import { RefreshCwIcon, Trash2Icon } from 'lucide-react'
import { type ReactElement, useMemo, useState } from 'react'
import { SelectedRequestPanel } from './requests-detail'
import { buildRequestTimeline, timelineRequestId } from './requests-model'
import { RequestTimelinePanel } from './requests-timeline'
import type { PageProps } from './types'

export function RequestsPage({
  actions,
  busyAction,
  capture,
  hasMoreActivity,
  locale,
  onCaptureClose,
  requestSearchQuery,
  snapshot,
  t
}: PageProps): ReactElement {
  const accountLabels = useMemo(
    () => accountDisplayLookup(snapshot.accounts, t('accounts.emailPending')),
    [snapshot.accounts, t]
  )
  const timelineItems = useMemo(
    () =>
      buildRequestTimeline(
        snapshot.requests,
        snapshot.logEvents,
        snapshot.protocolMessages,
        snapshot.turnSummaries,
        { accountLabels, locale, t }
      ),
    [
      accountLabels,
      locale,
      snapshot.logEvents,
      snapshot.protocolMessages,
      snapshot.requests,
      snapshot.turnSummaries,
      t
    ]
  )
  const summary = snapshot.requestSummary
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmClearOpen, setConfirmClearOpen] = useState(false)
  const selected = timelineItems.find((item) => item.id === selectedId) ?? timelineItems[0]
  const selectedRequestId = selected ? timelineRequestId(selected) : null
  const selectedRequest =
    selected?.kind === 'request'
      ? selected.request
      : snapshot.requests.find((request) => request.id === selectedRequestId)
  const selectedTurnSummaries = useMemo(
    () =>
      selectedRequestId
        ? snapshot.turnSummaries.filter(
            (summary) =>
              summary.requestId === selectedRequestId ||
              (selectedRequest?.conversationKey &&
                summary.conversationKey === selectedRequest.conversationKey)
          )
        : [],
    [selectedRequest?.conversationKey, selectedRequestId, snapshot.turnSummaries]
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
      <PageHeader
        actions={
          <>
            <Button loading={busyAction === 'refresh'} onClick={actions.refresh} variant="outline">
              <RefreshCwIcon data-icon="inline-start" />
              {t('shell.refresh')}
            </Button>
            <Button
              loading={busyAction === 'clear'}
              onClick={() => setConfirmClearOpen(true)}
              variant="destructive-outline"
            >
              <Trash2Icon data-icon="inline-start" />
              {t('action.clearRecords')}
            </Button>
          </>
        }
        description={t('requests.desc')}
        title={t('requests.title')}
      />

      <section className="grid h-[92px] shrink-0 grid-cols-5 gap-3">
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
        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          <RequestTimelinePanel
            accountLabels={accountLabels}
            hasMoreActivity={hasMoreActivity}
            initialQuery={requestSearchQuery}
            locale={locale}
            onLoadMore={actions.loadMoreActivity}
            onSelect={setSelectedId}
            selectedId={selected?.id ?? selectedId}
            t={t}
            timelineItems={timelineItems}
          />
        </div>

        <SelectedRequestPanel
          accountLabels={accountLabels}
          actions={actions}
          linkedRequest={selectedRequest}
          locale={locale}
          selected={selected}
          t={t}
          turnSummaries={selectedTurnSummaries}
        />
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
