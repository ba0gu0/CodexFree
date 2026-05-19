import { Button } from '@renderer/components/ui/button'
import { formatDateTime } from '@renderer/data/format'
import { accountDisplayName, type ManagedAccount } from '@renderer/data/proxy-console'
import { type ReactElement, useState } from 'react'
import { remainingQuota } from './dashboard-model'
import type { PageProps } from './types'

const panel = 'rounded-xl border border-border/70 bg-card p-4 shadow-sm'
const muted = 'text-muted-foreground'
const title = 'font-extrabold text-foreground'

export function ActiveAccountPanel({
  active,
  actions,
  busyAction,
  locale,
  t,
  usageProgress
}: {
  active?: ManagedAccount
  actions: PageProps['actions']
  busyAction: string | null
  locale: PageProps['locale']
  t: PageProps['t']
  usageProgress: PageProps['usageProgress']
}): ReactElement {
  const remaining = remainingQuota(active)
  const accountName = active ? accountDisplayName(active, t('accounts.emailPending')) : '-'
  const [checkingUsage, setCheckingUsage] = useState(false)
  return (
    <section
      className={`${panel} flex h-full min-h-0 flex-col gap-2.5 overflow-hidden p-3.5 min-[1400px]:p-4`}
    >
      <div className={`${muted} font-bold text-xs`}>{t('dashboard.activeAccount')}</div>
      <div className={`${title} text-sm leading-5 min-[1400px]:text-base`} title={accountName}>
        <AccountNameText value={accountName} />
      </div>
      <div className="font-extrabold text-success text-xs">
        {t('dashboard.planAvailable', { plan: active?.planType ?? '-' })}
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-success" style={{ width: quotaWidth(remaining) }} />
      </div>
      <div className={`${muted} font-bold text-[11px]`}>
        {t('dashboard.resetAt', { time: formatDateTime(active?.rateLimitResetsAt, locale) })}
      </div>
      <div className="grid shrink-0 grid-cols-1 gap-2.5">
        <MiniMeta
          label={t('dashboard.remainingQuota')}
          sub={t('dashboard.quotaSource')}
          tone="good"
          value={remainingText(remaining, t)}
        />
        <MiniMeta
          label={t('dashboard.accountCost')}
          sub={t('dashboard.moneyCost', { cost: '-' })}
          value={t('dashboard.tokenCost', { tokens: '-' })}
        />
      </div>
      <div className="grid grid-cols-1 gap-1 text-muted-foreground text-xs">
        <span className="truncate">
          {t('dashboard.recentSwitch', { time: formatDateTime(active?.updatedAt, locale) })}
        </span>
        <span className="truncate">{t('dashboard.nextCheck')}</span>
      </div>
      <div className="mt-auto grid shrink-0 gap-2">
        <Button
          className="h-8 rounded-lg font-bold text-xs"
          disabled={!active || busyAction === 'usage'}
          loading={checkingUsage}
          onClick={async () => {
            if (active) {
              setCheckingUsage(true)
              try {
                await actions.checkUsageForAccounts([active.accountId])
              } finally {
                setCheckingUsage(false)
              }
            }
          }}
          variant="outline"
        >
          {busyAction === 'usage'
            ? (usageProgressText(usageProgress) ?? t('dashboard.refreshUsage'))
            : t('dashboard.refreshUsage')}
        </Button>
        <Button
          className="h-8 rounded-lg font-bold text-xs"
          onClick={actions.showUsage}
          variant="secondary"
        >
          {t('dashboard.accountAnalysis')}
        </Button>
      </div>
    </section>
  )
}

function usageProgressText(progress: PageProps['usageProgress']): string | null {
  if (!progress) {
    return null
  }
  return progress.total > 0 ? `${progress.completed}/${progress.total}` : '0/0'
}

function AccountNameText({ value }: { value: string }): ReactElement {
  const atIndex = value.lastIndexOf('@')
  if (atIndex <= 0 || atIndex === value.length - 1) {
    return <span className="break-words">{value}</span>
  }
  return (
    <span className="flex min-w-0 flex-col">
      <span className="min-w-0 break-words">{value.slice(0, atIndex + 1)}</span>
      <span className="min-w-0 break-words">{value.slice(atIndex + 1)}</span>
    </span>
  )
}

function MiniMeta({
  label,
  sub,
  tone,
  value
}: {
  label: string
  sub: string
  tone?: 'good'
  value: string
}): ReactElement {
  const className = tone === 'good' ? 'bg-success/12 text-success' : 'bg-muted/60'
  return (
    <div className={`rounded-[10px] p-2 ${className}`}>
      <div className={`${title} truncate text-sm`}>{value}</div>
      <div className="truncate font-bold text-foreground text-[10px] min-[1400px]:text-xs">
        {label}
      </div>
      <div className={`${muted} truncate font-semibold text-[9px]`}>{sub}</div>
    </div>
  )
}

function quotaWidth(remaining: number | undefined): string {
  return remaining === undefined ? '0%' : `${remaining}%`
}

function remainingText(remaining: number | undefined, t: PageProps['t']): string {
  return remaining === undefined
    ? '-'
    : t('dashboard.approxPercent', { percent: Math.round(remaining) })
}
