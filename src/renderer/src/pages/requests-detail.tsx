import { Button } from '@renderer/components/ui/button'
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle
} from '@renderer/components/ui/card'
import { logEventDisplayTitle, logEventTypeLabel } from '@renderer/data/activity-display'
import type { ActivityViewModel } from '@renderer/data/activity-view-model'
import { formatDateTime, truncateMiddle } from '@renderer/data/format'
import type {
  ProtocolMessage,
  ProxyLogEvent,
  RecentRequest,
  TurnSummary
} from '@renderer/data/proxy-console'
import {
  accountDisplayForPathFromLookup,
  requestByteSummary,
  tokenBreakdownText,
  tokenUsageSourceLabel
} from '@renderer/data/proxy-console'
import { ActivityIcon } from 'lucide-react'
import type { ReactElement } from 'react'
import {
  ActivityOverview,
  DetailSection,
  LogDetailJson,
  RelatedActivityList,
  RequestDetail
} from './requests-detail-shared'
import type { RequestTimelineItem } from './requests-model'
import { ProtocolMessageMetadata } from './requests-protocol-message-metadata'
import { TurnOnlyDetails, TurnSummaries } from './requests-turn-summary'
import type { PageProps } from './types'

export function SelectedRequestPanel({
  accountLabels,
  actions,
  linkedRequest,
  locale,
  selected,
  t,
  turnSummaries
}: {
  accountLabels: Map<string, string>
  actions: PageProps['actions']
  linkedRequest: RecentRequest | undefined
  locale: PageProps['locale']
  selected: RequestTimelineItem | undefined
  t: PageProps['t']
  turnSummaries: TurnSummary[]
}): ReactElement {
  return (
    <aside className="flex min-h-0 min-w-0 flex-col gap-4 overflow-hidden">
      <Card className="h-full min-h-0 overflow-hidden rounded-xl shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-xl">
            {selected?.kind === 'request' ? t('requests.selected') : t('requests.selectedEvent')}
          </CardTitle>
          <CardDescription className="max-h-20 overflow-y-auto break-words text-sm leading-5 [overflow-wrap:anywhere]">
            {selected
              ? selected.activity.subtitle || selected.activity.title
              : t('requests.noSelection')}
          </CardDescription>
        </CardHeader>
        <CardPanel className="flex h-[calc(100%-74px)] min-h-0 min-w-0 flex-col gap-3 overflow-y-auto overflow-x-hidden">
          {selected?.kind === 'request' ? (
            <RequestDetails
              accountLabels={accountLabels}
              actions={actions}
              activity={selected.activity}
              locale={locale}
              selected={selected.request}
              t={t}
              turnSummaries={turnSummaries}
            />
          ) : selected?.kind === 'log' ? (
            <EventDetails
              accountLabels={accountLabels}
              actions={actions}
              activity={selected.activity}
              event={selected.event}
              linkedRequest={linkedRequest}
              locale={locale}
              t={t}
              turnSummaries={turnSummaries}
            />
          ) : selected?.kind === 'protocol' ? (
            <ProtocolMessageDetails
              accountLabels={accountLabels}
              activity={selected.activity}
              linkedRequest={linkedRequest}
              locale={locale}
              message={selected.message}
              t={t}
              turnSummaries={turnSummaries}
            />
          ) : selected?.kind === 'turn' ? (
            <>
              <ActivityOverview activity={selected.activity} t={t} />
              <TurnOnlyDetails locale={locale} t={t} turn={selected.turn} />
              <RelatedActivityList activities={selected.activity.children ?? []} t={t} />
            </>
          ) : (
            <div className="rounded-lg border bg-muted/40 p-6 text-muted-foreground text-sm">
              {t('requests.noSelection')}
            </div>
          )}
        </CardPanel>
      </Card>
    </aside>
  )
}

function RequestDetails({
  accountLabels,
  actions,
  activity,
  locale,
  selected,
  t,
  turnSummaries
}: {
  accountLabels: Map<string, string>
  actions: PageProps['actions']
  activity: ActivityViewModel
  locale: PageProps['locale']
  selected: RecentRequest
  t: PageProps['t']
  turnSummaries: TurnSummary[]
}): ReactElement {
  return (
    <>
      <ActivityOverview activity={activity} t={t} />
      <HttpMetadata selected={selected} locale={locale} t={t} />
      <TokenMetadata selected={selected} locale={locale} t={t} />
      <CodexMetadata accountLabels={accountLabels} locale={locale} selected={selected} t={t} />
      <TurnSummaries locale={locale} summaries={turnSummaries} t={t} />
      <RelatedActivityList activities={activity.children ?? []} t={t} />
      <Button
        disabled={!selected.rawCapturePath}
        onClick={() => actions.openCapture(selected.id)}
        variant="outline"
      >
        <ActivityIcon data-icon="inline-start" />
        {selected.rawCapturePath ? t('action.openCapture') : t('requests.noCapture')}
      </Button>
    </>
  )
}

function EventDetails({
  accountLabels,
  actions,
  activity,
  event,
  linkedRequest,
  locale,
  t,
  turnSummaries
}: {
  accountLabels: Map<string, string>
  actions: PageProps['actions']
  activity: ActivityViewModel
  event: ProxyLogEvent
  linkedRequest: RecentRequest | undefined
  locale: PageProps['locale']
  t: PageProps['t']
  turnSummaries: TurnSummary[]
}): ReactElement {
  return (
    <>
      <ActivityOverview activity={activity} t={t} />
      <EventMetadata accountLabels={accountLabels} event={event} locale={locale} t={t} />
      <LogDetailJson detailJson={event.detailJson} t={t} />
      {linkedRequest ? (
        <>
          <HttpMetadata selected={linkedRequest} locale={locale} t={t} />
          <TokenMetadata selected={linkedRequest} locale={locale} t={t} />
          <CodexMetadata
            accountLabels={accountLabels}
            locale={locale}
            selected={linkedRequest}
            t={t}
          />
          <TurnSummaries locale={locale} summaries={turnSummaries} t={t} />
        </>
      ) : null}
      <RelatedActivityList activities={activity.children ?? []} t={t} />
      <Button
        disabled={!linkedRequest?.rawCapturePath}
        onClick={() => {
          if (linkedRequest) {
            actions.openCapture(linkedRequest.id)
          }
        }}
        variant="outline"
      >
        <ActivityIcon data-icon="inline-start" />
        {linkedRequest?.rawCapturePath ? t('action.openCapture') : t('requests.noCapture')}
      </Button>
    </>
  )
}

function ProtocolMessageDetails({
  accountLabels,
  activity,
  linkedRequest,
  locale,
  message,
  t,
  turnSummaries
}: {
  accountLabels: Map<string, string>
  activity: ActivityViewModel
  linkedRequest: RecentRequest | undefined
  locale: PageProps['locale']
  message: ProtocolMessage
  t: PageProps['t']
  turnSummaries: TurnSummary[]
}): ReactElement {
  return (
    <>
      <ActivityOverview activity={activity} t={t} />
      <ProtocolMessageMetadata
        accountLabels={accountLabels}
        locale={locale}
        message={message}
        t={t}
      />
      {linkedRequest ? (
        <>
          <HttpMetadata selected={linkedRequest} locale={locale} t={t} />
          <TokenMetadata selected={linkedRequest} locale={locale} t={t} />
          <CodexMetadata
            accountLabels={accountLabels}
            locale={locale}
            selected={linkedRequest}
            t={t}
          />
          <TurnSummaries locale={locale} summaries={turnSummaries} t={t} />
        </>
      ) : null}
      <RelatedActivityList activities={activity.children ?? []} t={t} />
    </>
  )
}

function EventMetadata({
  accountLabels,
  event,
  locale,
  t
}: {
  accountLabels: Map<string, string>
  event: ProxyLogEvent
  locale: PageProps['locale']
  t: PageProps['t']
}): ReactElement {
  return (
    <DetailSection title={t('requests.eventMetadata')}>
      <RequestDetail label={t('table.startedAt')} value={formatDateTime(event.createdAt, locale)} />
      <RequestDetail label={t('requests.logLevel')} value={event.level.toUpperCase()} />
      <RequestDetail
        label={t('requests.eventType')}
        value={logEventTypeLabel(event.eventType, t)}
      />
      <RequestDetail label={t('requests.message')} value={logEventDisplayTitle(event, t)} />
      <RequestDetail
        label={t('table.accountId')}
        value={accountDisplayForPathFromLookup(
          accountLabels,
          event.accountId,
          event.path,
          t('accounts.emailPending'),
          t('accounts.originalAccount')
        )}
      />
      <RequestDetail label={t('requests.conversation')} value={event.conversationKey ?? '-'} />
      <RequestDetail label={t('requests.requestId')} value={event.requestId ?? '-'} />
      <RequestDetail label={t('table.path')} value={event.path ?? '-'} />
      <RequestDetail label={t('table.method')} value={event.method ?? '-'} />
    </DetailSection>
  )
}

function HttpMetadata({
  locale,
  selected,
  t
}: {
  locale: PageProps['locale']
  selected: RecentRequest
  t: PageProps['t']
}): ReactElement {
  return (
    <DetailSection title={t('requests.requestContent')}>
      <RequestDetail
        label={t('table.startedAt')}
        value={formatDateTime(selected.startedAt, locale)}
      />
      <RequestDetail
        label={t('requests.contentTypes')}
        value={`${selected.requestContentType ?? '-'} / ${selected.responseContentType ?? '-'}`}
      />
      <RequestDetail
        label={t('requests.bodyEncoding')}
        value={selected.requestBodyEncoding ?? '-'}
      />
      <RequestDetail
        label={t('requests.itemCounts')}
        value={`${selected.requestInputItemCount ?? '-'} / ${selected.responseItemCount ?? '-'}`}
      />
      <RequestDetail
        label={t('requests.rpc')}
        value={`${selected.rpcMethod ?? '-'} / ${selected.rpcId ?? '-'}`}
      />
      <RequestDetail label={t('requests.upstream')} value={selected.upstreamHost} />
      <RequestDetail label={t('table.bytes')} value={requestByteSummary(selected, locale)} />
      {selected.errorMessage ? (
        <RequestDetail label={t('requests.errorMessage')} value={selected.errorMessage} />
      ) : null}
    </DetailSection>
  )
}

function TokenMetadata({
  locale,
  selected,
  t
}: {
  locale: PageProps['locale']
  selected: RecentRequest
  t: PageProps['t']
}): ReactElement {
  return (
    <DetailSection title={t('requests.responseContent')}>
      <RequestDetail
        label={t('table.model')}
        value={`${selected.requestModel ?? '-'} / ${selected.responseModel ?? '-'}`}
      />
      <RequestDetail label={t('table.tokens')} value={tokenBreakdownText(selected, locale)} />
      <RequestDetail
        label={t('table.source')}
        value={tokenUsageSourceLabel(selected.tokenUsageSource, t)}
      />
      <RequestDetail
        label={t('requests.analyticsEvents')}
        value={selected.analyticsEventTypes ?? '-'}
      />
    </DetailSection>
  )
}

function CodexMetadata({
  accountLabels,
  selected,
  t
}: {
  accountLabels: Map<string, string>
  locale: PageProps['locale']
  selected: RecentRequest
  t: PageProps['t']
}): ReactElement {
  const runtime =
    [selected.codexVersion, selected.codexRuntimeOs, selected.codexRuntimeArch]
      .filter(Boolean)
      .join(' / ') || '-'
  return (
    <DetailSection title={t('requests.codexMetadata')}>
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
        value={selected.conversationKey ? truncateMiddle(selected.conversationKey) : '-'}
      />
      <RequestDetail label={t('requests.codexThread')} value={selected.codexThreadId ?? '-'} />
      <RequestDetail label={t('requests.codexTurn')} value={selected.codexTurnId ?? '-'} />
      <RequestDetail label={t('requests.codexRuntime')} value={runtime} />
    </DetailSection>
  )
}
