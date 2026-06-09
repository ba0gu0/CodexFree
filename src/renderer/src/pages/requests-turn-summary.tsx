import { formatDateTime } from '@renderer/data/format'
import { type TurnSummary, tokenBreakdownText } from '@renderer/data/proxy-console'
import type { ReactElement } from 'react'
import { DetailSection, RequestDetail } from './requests-detail-shared'
import type { PageProps } from './types'

export function TurnSummaries({
  locale,
  summaries,
  t
}: {
  locale: PageProps['locale']
  summaries: TurnSummary[]
  t: PageProps['t']
}): ReactElement {
  if (summaries.length === 0) {
    return (
      <DetailSection title={t('requests.turnSummary')}>
        <div className="text-muted-foreground text-xs">{t('requests.noTurnSummary')}</div>
      </DetailSection>
    )
  }
  return (
    <DetailSection title={t('requests.turnSummary')}>
      {summaries.slice(0, 3).map((summary) => (
        <div className="grid gap-1 border-muted border-b py-2 last:border-b-0" key={summary.id}>
          <RequestDetail
            label={t('table.startedAt')}
            value={summary.startedAt ? formatDateTime(summary.startedAt, locale) : '-'}
          />
          <RequestDetail
            label={t('table.completedAt')}
            value={summary.completedAt ? formatDateTime(summary.completedAt, locale) : '-'}
          />
          <RequestDetail label={t('table.result')} value={summary.status ?? '-'} />
          <RequestDetail
            label={t('requests.conversation')}
            value={summary.conversationKey ?? '-'}
          />
          <RequestDetail label={t('requests.responseId')} value={summary.responseId ?? '-'} />
          <RequestDetail
            label={t('requests.parentResponseId')}
            value={summary.parentResponseId ?? '-'}
          />
          <RequestDetail label={t('table.tokens')} value={tokenBreakdownText(summary, locale)} />
          <RequestDetail label={t('requests.toolCalls')} value={String(summary.toolCallCount)} />
          <RequestDetail
            label={t('requests.toolResults')}
            value={String(summary.toolResultCount)}
          />
          <RequestDetail label={t('requests.message')} value={summary.userText ?? '-'} />
          <RequestDetail
            label={t('requests.assistantMessage')}
            value={summary.assistantText ?? '-'}
          />
        </div>
      ))}
    </DetailSection>
  )
}

export function TurnOnlyDetails({
  locale,
  t,
  turn
}: {
  locale: PageProps['locale']
  t: PageProps['t']
  turn: TurnSummary
}): ReactElement {
  return <TurnSummaries locale={locale} summaries={[turn]} t={t} />
}
