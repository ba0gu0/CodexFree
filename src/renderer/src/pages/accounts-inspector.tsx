import { StatusBadge } from '@renderer/components/app-shell/status-badge'
import { Button } from '@renderer/components/ui/button'
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle
} from '@renderer/components/ui/card'
import { logEventDisplayTitle, requestDisplayTitle } from '@renderer/data/activity-display'
import { formatDateTime, truncateMiddle } from '@renderer/data/format'
import {
  accountDisplayName,
  accountStatusKey,
  type ManagedAccount
} from '@renderer/data/proxy-console'
import { UserCheckIcon } from 'lucide-react'
import { type ReactElement, useMemo } from 'react'
import {
  accountFormatLabel,
  fiveHourQuotaResetAt,
  statusTone,
  weeklyQuotaResetAt
} from './accounts-model'
import type { PageProps } from './types'

export function AccountInspector({
  actions,
  account,
  busyAction,
  locale,
  snapshot,
  t
}: Pick<PageProps, 'actions' | 'busyAction' | 'locale' | 'snapshot' | 't'> & {
  account?: ManagedAccount
}): ReactElement {
  const canSwitchAccount = Boolean(
    snapshot.status.running && account && account.status === 'available' && account.active !== 1
  )
  const requests = useMemo(
    () => takeAccountRequests(snapshot.requests, account?.accountId, 3),
    [account?.accountId, snapshot.requests]
  )
  const events = useMemo(
    () => takeAccountEvents(snapshot.logEvents, account?.accountId, 3),
    [account?.accountId, snapshot.logEvents]
  )

  return (
    <Card className="h-full min-h-0 overflow-hidden rounded-xl shadow-none">
      <CardHeader className="p-4 pb-2">
        <CardTitle>{t('accounts.selected')}</CardTitle>
        <CardDescription>
          {account
            ? accountDisplayName(account, t('accounts.emailPending'))
            : t('accounts.noAccount')}
        </CardDescription>
      </CardHeader>
      <CardPanel className="flex min-h-0 flex-col gap-2 overflow-y-auto p-3 pt-0">
        {account ? (
          <>
            <div className="flex flex-col gap-2 rounded-lg bg-muted/55 p-2.5">
              <AccountStatus account={account} t={t} />
              <DetailRow label={t('accounts.format')} value={accountFormatLabel(account, t)} />
              <DetailRow
                label={t('accounts.email')}
                value={accountDisplayName(account, t('accounts.emailPending'))}
              />
              <DetailRow label={t('accounts.secretState')} value={t('accounts.secretMasked')} />
              <DetailRow
                label={t('accounts.fingerprint')}
                value={truncateMiddle(account.fingerprint, 18)}
              />
              <DetailRow
                label={t('accounts.weeklyResetAt')}
                value={formatDateTime(weeklyResetAt(account), locale)}
              />
              <DetailRow
                label={t('accounts.fiveHourResetAt')}
                value={formatDateTime(fiveHourResetAt(account), locale)}
              />
              <DetailRow
                label={t('table.lastCheck')}
                value={formatDateTime(account.lastUsageCheckedAt, locale)}
              />
              <DetailRow label={t('requests.errorMessage')} value={account.lastUsageError ?? '-'} />
            </div>
            <ContextList
              empty={t('status.empty')}
              items={requests.map((request) => ({
                id: request.id,
                meta: formatDateTime(request.startedAt, locale),
                title: requestDisplayTitle(request, t)
              }))}
              title={t('accounts.requestHistory')}
            />
            <ContextList
              empty={t('status.empty')}
              items={events.map((event) => ({
                id: event.id,
                meta: formatDateTime(event.createdAt, locale),
                title: logEventDisplayTitle(event, t)
              }))}
              title={t('accounts.quotaHistory')}
            />
            <Button
              disabled={!canSwitchAccount || busyAction === 'account'}
              loading={busyAction === 'account'}
              onClick={() => actions.setCurrentAccount(account.accountId)}
              variant="outline"
            >
              <UserCheckIcon data-icon="inline-start" />
              {t('action.setCurrentAccount')}
            </Button>
            <Button onClick={() => actions.showRequests(account.accountId)} variant="outline">
              {t('accounts.viewAllEvents')}
            </Button>
          </>
        ) : (
          <div className="rounded-lg bg-muted/40 p-4 text-muted-foreground text-sm">
            {t('accounts.empty')}
          </div>
        )}
      </CardPanel>
    </Card>
  )
}

function weeklyResetAt(account: ManagedAccount): number | null {
  return weeklyQuotaResetAt(account)
}

function fiveHourResetAt(account: ManagedAccount): number | null {
  return fiveHourQuotaResetAt(account)
}

export function AccountStatus({
  account,
  t
}: {
  account: ManagedAccount
  t: PageProps['t']
}): ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {account.active === 1 ? (
        <StatusBadge tone="success">{t('status.current')}</StatusBadge>
      ) : null}
      <StatusBadge tone={statusTone(account)}>
        {account.lastUsageError ? t('accounts.statusInvalid') : t(accountStatusKey(account.status))}
      </StatusBadge>
    </div>
  )
}

function takeAccountRequests(
  requests: PageProps['snapshot']['requests'],
  accountId: string | undefined,
  limit: number
): PageProps['snapshot']['requests'] {
  if (!accountId) {
    return []
  }
  const items: PageProps['snapshot']['requests'] = []
  for (const request of requests) {
    if (request.accountId === accountId) {
      items.push(request)
      if (items.length >= limit) {
        break
      }
    }
  }
  return items
}

function takeAccountEvents(
  events: PageProps['snapshot']['logEvents'],
  accountId: string | undefined,
  limit: number
): PageProps['snapshot']['logEvents'] {
  if (!accountId) {
    return []
  }
  const items: PageProps['snapshot']['logEvents'] = []
  for (const event of events) {
    if (event.accountId === accountId) {
      items.push(event)
      if (items.length >= limit) {
        break
      }
    }
  }
  return items
}

function ContextList({
  empty,
  items,
  title
}: {
  empty: string
  items: { id: string; meta: string; title: string }[]
  title: string
}): ReactElement {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-semibold text-xs">{title}</h3>
      {items.length === 0 ? (
        <div className="rounded-lg bg-muted/40 p-3 text-muted-foreground text-xs">{empty}</div>
      ) : (
        items.map((item) => (
          <div className="rounded-lg border bg-background p-2.5" key={item.id}>
            <div className="truncate font-medium text-xs">{item.title}</div>
            <div className="text-muted-foreground text-xs">{item.meta}</div>
          </div>
        ))
      )}
    </section>
  )
}

function DetailRow({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="flex min-w-0 justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-medium">{value}</span>
    </div>
  )
}
