import { StatusBadge } from '@renderer/components/app-shell/status-badge'
import { Button } from '@renderer/components/ui/button'
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle
} from '@renderer/components/ui/card'
import {
  logEventDisplayMeta,
  logEventDisplayTitle,
  logEventTypeLabel,
  protocolDirectionLabel,
  protocolKindLabel,
  protocolMessageDisplayMeta,
  protocolMessageDisplayTitle
} from '@renderer/data/activity-display'
import { formatBytes, formatDateTime, truncateMiddle } from '@renderer/data/format'
import type { ProtocolMessage, ProxyLogEvent, RecentRequest } from '@renderer/data/proxy-console'
import {
  accountDisplayForPathFromLookup,
  outcomeKey,
  requestByteSummary,
  requestPurposeLabel,
  tokenBreakdownText,
  tokenUsageSourceLabel
} from '@renderer/data/proxy-console'
import { ActivityIcon, FileSearchIcon } from 'lucide-react'
import type { ReactElement } from 'react'
import {
  DetailSection,
  eventTone,
  LogDetailJson,
  outcomeTone,
  ProtocolMessages,
  RequestDetail
} from './requests-detail-shared'
import type { RequestTimelineItem } from './requests-model'
import type { PageProps } from './types'

export function SelectedRequestPanel({
  accountLabels,
  actions,
  linkedRequest,
  locale,
  messages,
  selected,
  t
}: {
  accountLabels: Map<string, string>
  actions: PageProps['actions']
  linkedRequest: RecentRequest | undefined
  locale: PageProps['locale']
  messages: ProtocolMessage[]
  selected: RequestTimelineItem | undefined
  t: PageProps['t']
}): ReactElement {
  return (
    <aside className="flex min-h-0 min-w-0 flex-col gap-4 overflow-hidden">
      <Card className="h-full min-h-0 overflow-hidden rounded-xl shadow-none">
        <CardHeader className="pb-3">
          <CardTitle>
            {selected?.kind === 'request' ? t('requests.selected') : t('requests.selectedEvent')}
          </CardTitle>
          <CardDescription>
            {selected ? selectedDescription(selected, t) : t('requests.noSelection')}
          </CardDescription>
        </CardHeader>
        <CardPanel className="flex h-[calc(100%-74px)] min-h-0 min-w-0 flex-col gap-3 overflow-y-auto overflow-x-hidden">
          {selected?.kind === 'request' ? (
            <RequestDetails
              accountLabels={accountLabels}
              actions={actions}
              locale={locale}
              messages={messages}
              selected={selected.request}
              t={t}
            />
          ) : selected?.kind === 'log' ? (
            <EventDetails
              accountLabels={accountLabels}
              actions={actions}
              event={selected.event}
              linkedRequest={linkedRequest}
              locale={locale}
              messages={messages}
              t={t}
            />
          ) : selected?.kind === 'protocol' ? (
            <ProtocolMessageDetails
              accountLabels={accountLabels}
              linkedRequest={linkedRequest}
              locale={locale}
              message={selected.message}
              messages={messages}
              t={t}
            />
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

function selectedDescription(item: RequestTimelineItem, t: PageProps['t']): string {
  if (item.kind === 'request') {
    return requestPurposeLabel(item.request.requestPurpose, t)
  }
  if (item.kind === 'protocol') {
    return protocolMessageDisplayTitle(item.message, t)
  }
  return logEventDisplayTitle(item.event, t)
}

function RequestDetails({
  accountLabels,
  actions,
  locale,
  messages,
  selected,
  t
}: {
  accountLabels: Map<string, string>
  actions: PageProps['actions']
  locale: PageProps['locale']
  messages: ProtocolMessage[]
  selected: RecentRequest
  t: PageProps['t']
}): ReactElement {
  return (
    <>
      <div className="rounded-lg bg-muted/55 p-3">
        <div className="mb-2 flex items-center gap-2">
          <FileSearchIcon data-icon="inline-start" />
          <StatusBadge tone={outcomeTone(selected.outcome)}>
            {t(outcomeKey(selected.outcome))}
          </StatusBadge>
        </div>
        <div className="break-all font-semibold text-foreground text-sm">
          {selected.method} {selected.path}
        </div>
      </div>
      <HttpMetadata selected={selected} locale={locale} t={t} />
      <TokenMetadata selected={selected} locale={locale} t={t} />
      <CodexMetadata accountLabels={accountLabels} locale={locale} selected={selected} t={t} />
      <ProtocolMessages locale={locale} messages={messages} t={t} />
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
  event,
  linkedRequest,
  locale,
  messages,
  t
}: {
  accountLabels: Map<string, string>
  actions: PageProps['actions']
  event: ProxyLogEvent
  linkedRequest: RecentRequest | undefined
  locale: PageProps['locale']
  messages: ProtocolMessage[]
  t: PageProps['t']
}): ReactElement {
  return (
    <>
      <div className="rounded-lg bg-muted/55 p-3">
        <div className="mb-2 flex items-center gap-2">
          <FileSearchIcon data-icon="inline-start" />
          <StatusBadge tone={eventTone(event.level)}>{event.level.toUpperCase()}</StatusBadge>
          {event.eventType ? (
            <StatusBadge>{logEventTypeLabel(event.eventType, t)}</StatusBadge>
          ) : null}
        </div>
        <div className="break-all font-semibold text-foreground text-sm">
          {logEventDisplayTitle(event, t)}
        </div>
        <div className="mt-1 break-all text-muted-foreground text-xs">
          {logEventDisplayMeta(event, t)}
        </div>
      </div>
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
        </>
      ) : null}
      <ProtocolMessages locale={locale} messages={messages} t={t} />
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
  linkedRequest,
  locale,
  message,
  messages,
  t
}: {
  accountLabels: Map<string, string>
  linkedRequest: RecentRequest | undefined
  locale: PageProps['locale']
  message: ProtocolMessage
  messages: ProtocolMessage[]
  t: PageProps['t']
}): ReactElement {
  return (
    <>
      <div className="rounded-lg bg-muted/55 p-3">
        <div className="mb-2 flex items-center gap-2">
          <FileSearchIcon data-icon="inline-start" />
          <StatusBadge tone={message.kind === 'error' ? 'error' : 'success'}>
            {protocolKindLabel(message.kind, t)}
          </StatusBadge>
          <StatusBadge>{protocolDirectionLabel(message.direction, t)}</StatusBadge>
        </div>
        <div className="break-all font-semibold text-foreground text-sm">
          {protocolMessageDisplayTitle(message, t)}
        </div>
        <div className="mt-1 break-all text-muted-foreground text-xs">
          {protocolMessageDisplayMeta(message, locale, t)}
        </div>
      </div>
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
        </>
      ) : null}
      <ProtocolMessages locale={locale} messages={messages} t={t} />
    </>
  )
}

function ProtocolMessageMetadata({
  accountLabels,
  locale,
  message,
  t
}: {
  accountLabels: Map<string, string>
  locale: PageProps['locale']
  message: ProtocolMessage
  t: PageProps['t']
}): ReactElement {
  return (
    <DetailSection title={t('requests.protocolMessages')}>
      <RequestDetail
        label={t('table.startedAt')}
        value={formatDateTime(message.createdAt, locale)}
      />
      <RequestDetail
        label={t('table.accountId')}
        value={accountDisplayForPathFromLookup(
          accountLabels,
          message.accountId,
          message.path,
          t('accounts.emailPending'),
          t('accounts.originalAccount')
        )}
      />
      <RequestDetail label={t('requests.requestId')} value={message.requestId} />
      <RequestDetail label={t('table.path')} value={message.path} />
      <RequestDetail label={t('requests.eventType')} value={message.protocolType ?? '-'} />
      <RequestDetail
        label={t('table.source')}
        value={protocolDirectionLabel(message.direction, t)}
      />
      <RequestDetail label={t('table.purpose')} value={protocolKindLabel(message.kind, t)} />
      <RequestDetail label={t('table.model')} value={message.model ?? '-'} />
      <RequestDetail label={t('table.tokens')} value={tokenBreakdownText(message, locale)} />
      <RequestDetail label={t('requests.conversation')} value={message.conversationKey ?? '-'} />
      <RequestDetail
        label={t('requests.previousResponseId')}
        value={message.previousResponseId ?? '-'}
      />
      <RequestDetail label={t('requests.responseId')} value={message.responseId ?? '-'} />
      <RequestDetail label={t('requests.sequence')} value={String(message.sequenceNumber ?? '-')} />
      <RequestDetail label={t('table.bytes')} value={formatBytes(message.payloadBytes, locale)} />
      <RequestDetail label={t('requests.message')} value={message.text || '-'} />
    </DetailSection>
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
    <DetailSection title={t('requests.httpMetadata')}>
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
    <DetailSection title={t('requests.tokenMetadata')}>
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
