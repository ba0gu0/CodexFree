import { StatusBadge } from '@renderer/components/app-shell/status-badge'
import {
  protocolMessageDisplayMeta,
  protocolMessageDisplayTitle
} from '@renderer/data/activity-display'
import { type ActivityViewModel, activityKindLabel } from '@renderer/data/activity-view-model'
import { redactCaptureContent } from '@renderer/data/format'
import type { ProtocolMessage } from '@renderer/data/proxy-console'
import { tokenBreakdownText } from '@renderer/data/proxy-console'
import type { ReactElement, ReactNode } from 'react'
import type { PageProps } from './types'

export function ActivityOverview({
  activity,
  t
}: {
  activity: ActivityViewModel
  t: PageProps['t']
}): ReactElement {
  const kindLabel = activityKindLabel(activity.kind, t)
  const badges = [...new Set(activity.badges)].filter((badge) => badge !== kindLabel).slice(0, 3)
  const metrics = [...new Set(activity.metrics)]
  return (
    <DetailSection title={t('requests.eventOverview')}>
      <div className="grid gap-2 rounded-md bg-background p-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <StatusBadge>{kindLabel}</StatusBadge>
          {badges.map((badge) => (
            <StatusBadge key={badge}>{badge}</StatusBadge>
          ))}
        </div>
        <div className="break-words font-semibold text-foreground text-sm leading-5">
          {activity.title}
        </div>
        <div className="max-h-28 overflow-y-auto break-words text-muted-foreground text-xs leading-5">
          {activity.subtitle || activity.detail || '-'}
        </div>
      </div>
      <RequestDetail label={t('table.accountId')} value={activity.account ?? '-'} />
      <RequestDetail label={t('table.model')} value={activity.model ?? '-'} />
      <RequestDetail label={t('table.result')} value={activity.statusText || '-'} />
      <RequestDetail
        label={t('table.usageQuota')}
        value={metrics.length > 0 ? metrics.join(' · ') : '-'}
      />
    </DetailSection>
  )
}

export function RelatedActivityList({
  activities,
  t
}: {
  activities: ActivityViewModel[]
  t: PageProps['t']
}): ReactElement {
  return (
    <DetailSection title={t('requests.relatedEvents')}>
      {activities.length === 0 ? (
        <div className="text-muted-foreground text-xs">{t('requests.noRelatedEvents')}</div>
      ) : (
        activities.slice(0, 5).map((activity) => (
          <div className="min-w-0 rounded-md bg-background p-2 text-xs" key={activity.id}>
            <div className="mb-1 flex min-w-0 items-center justify-between gap-2">
              <span className="min-w-0 truncate font-bold">{activity.title}</span>
              <span className="shrink-0 text-muted-foreground">
                {activityKindLabel(activity.kind, t)}
              </span>
            </div>
            <div className="max-h-16 overflow-y-auto break-words text-muted-foreground leading-5">
              {activity.subtitle || activity.detail || '-'}
            </div>
            {activity.metrics.length > 0 ? (
              <div className="mt-1 truncate text-muted-foreground">
                {activity.metrics.join(' · ')}
              </div>
            ) : null}
          </div>
        ))
      )}
    </DetailSection>
  )
}

export function ProtocolMessages({
  locale,
  messages,
  t
}: {
  locale: PageProps['locale']
  messages: ProtocolMessage[]
  t: PageProps['t']
}): ReactElement {
  return (
    <DetailSection title={t('requests.protocolMessages')}>
      {messages.length === 0 ? (
        <div className="text-muted-foreground text-xs">{t('requests.noProtocolMessages')}</div>
      ) : (
        messages.map((message) => (
          <div
            className="min-w-0 overflow-hidden rounded-md bg-background p-2 text-xs"
            key={message.id}
          >
            <div className="flex min-w-0 justify-between gap-2 font-bold">
              <span className="min-w-0 flex-1 truncate">
                {message.sequenceNumber ?? '-'} · {protocolMessageDisplayTitle(message, t)}
              </span>
              <span className="max-w-[45%] shrink-0 truncate">
                {tokenBreakdownText(message, locale)}
              </span>
            </div>
            <div className="mt-1 max-h-10 overflow-hidden break-all text-muted-foreground">
              {protocolMessageDisplayMeta(message, locale, t)}
            </div>
          </div>
        ))
      )}
    </DetailSection>
  )
}

export function DetailSection({
  children,
  title
}: {
  children: ReactNode
  title: string
}): ReactElement {
  return (
    <section className="grid min-w-0 gap-2 rounded-lg bg-muted/45 p-3">
      <h3 className="font-bold text-foreground text-xs">{title}</h3>
      {children}
    </section>
  )
}

export function RequestDetail({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="grid min-w-0 grid-cols-[76px_minmax(0,1fr)] items-start gap-2 text-xs">
      <div className="font-bold text-muted-foreground">{label}</div>
      <div
        className="max-h-28 overflow-y-auto whitespace-pre-wrap break-words font-mono text-foreground leading-5 [overflow-wrap:anywhere]"
        title={value}
      >
        {value}
      </div>
    </div>
  )
}

export function LogDetailJson({
  detailJson,
  t
}: {
  detailJson: string | null
  t: PageProps['t']
}): ReactElement {
  const content = detailJson ? redactCaptureContent(formatJson(detailJson)) : '-'
  return (
    <DetailSection title={t('requests.rawData')}>
      <pre className="max-h-56 min-w-0 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background p-2 font-mono text-[11px] leading-5">
        {content}
      </pre>
    </DetailSection>
  )
}

function formatJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

export function outcomeTone(outcome: string): 'default' | 'success' | 'warning' | 'error' {
  if (outcome === 'forwarded') {
    return 'success'
  }
  if (outcome === 'quota_exhausted') {
    return 'warning'
  }
  return outcome === 'failed' || outcome === 'rejected' ? 'error' : 'default'
}

export function eventTone(level: string): 'default' | 'success' | 'warning' | 'error' {
  if (level === 'error') {
    return 'error'
  }
  if (level === 'warn') {
    return 'warning'
  }
  return 'success'
}
