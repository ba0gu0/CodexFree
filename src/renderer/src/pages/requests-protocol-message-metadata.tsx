import { protocolDirectionLabel, protocolKindLabel } from '@renderer/data/activity-display'
import { formatBytes, formatDateTime } from '@renderer/data/format'
import {
  accountDisplayForPathFromLookup,
  type ProtocolMessage,
  tokenBreakdownText
} from '@renderer/data/proxy-console'
import type { ReactElement } from 'react'
import { DetailSection, RequestDetail } from './requests-detail-shared'
import type { PageProps } from './types'

export function ProtocolMessageMetadata({
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
      <RequestDetail
        label={t('requests.parentResponseId')}
        value={message.parentResponseId ?? '-'}
      />
      <RequestDetail label={t('requests.responseId')} value={message.responseId ?? '-'} />
      <RequestDetail label={t('requests.itemId')} value={message.itemId ?? '-'} />
      <RequestDetail label={t('requests.callId')} value={message.callId ?? '-'} />
      <RequestDetail label={t('requests.sequence')} value={String(message.sequenceNumber ?? '-')} />
      <RequestDetail label={t('table.bytes')} value={formatBytes(message.payloadBytes, locale)} />
      <RequestDetail label={t('requests.message')} value={message.text || '-'} />
      <RequestDetail label={t('requests.summaryJson')} value={message.summaryJson ?? '-'} />
    </DetailSection>
  )
}
