import { MetricCard } from '@renderer/components/app-shell/metric-card'
import { PageHeader } from '@renderer/components/app-shell/page-header'
import { Button } from '@renderer/components/ui/button'
import { Card, CardHeader, CardPanel, CardTitle } from '@renderer/components/ui/card'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { formatDateTime } from '@renderer/data/format'
import { accountDisplayName, type ManagedAccount } from '@renderer/data/proxy-console'
import { useVirtualRows, VIRTUAL_ROW_BATCH_SIZE } from '@renderer/hooks/use-virtual-rows'
import {
  DownloadIcon,
  PowerIcon,
  RefreshCwIcon,
  Trash2Icon,
  UploadIcon,
  XCircleIcon
} from 'lucide-react'
import { type ReactElement, useMemo, useState } from 'react'
import { AccountFilters } from './accounts-filters'
import { AccountInspector, AccountStatus } from './accounts-inspector'
import {
  type AccountFormatFilter,
  type AccountPlanFilter,
  type AccountStatusFilter,
  accountFormatLabel,
  accountLastCheckSummary,
  accountNeedsReview,
  accountPlanKind,
  accountRemainingQuotaPercent,
  filterAccounts,
  fiveHourQuotaResetAt,
  hasShortQuotaWindow,
  remainingUsagePercent,
  weeklyQuotaResetAt
} from './accounts-model'
import type { PageProps } from './types'

export function AccountsPage({
  actions,
  busyAction,
  locale,
  snapshot,
  t,
  usageProgress
}: PageProps): ReactElement {
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<AccountStatusFilter>('all')
  const [formatFilter, setFormatFilter] = useState<AccountFormatFilter>('all')
  const [planFilter, setPlanFilter] = useState<AccountPlanFilter>('all')
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [checkedAccountIds, setCheckedAccountIds] = useState<Set<string>>(() => new Set())
  const visibleAccounts = useMemo(
    () => filterAccounts(snapshot.accounts, query, statusFilter, formatFilter, planFilter),
    [formatFilter, planFilter, query, snapshot.accounts, statusFilter]
  )
  const selectedAccount =
    visibleAccounts.find((account) => account.accountId === selectedAccountId) ??
    visibleAccounts[0] ??
    snapshot.accounts[0]
  const checkedIds = [...checkedAccountIds]
  const hasCheckedAccounts = checkedIds.length > 0
  const importProgressText = busyAction === 'import' ? usageProgressText(usageProgress) : undefined

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      <PageHeader
        actions={
          <>
            <Button loading={busyAction === 'refresh'} onClick={actions.refresh} variant="outline">
              <RefreshCwIcon data-icon="inline-start" />
              {t('shell.refresh')}
            </Button>
            <Button
              disabled={busyAction === 'import'}
              loading={busyAction === 'import' && !importProgressText}
              onClick={actions.importAuthFiles}
            >
              <UploadIcon data-icon="inline-start" />
              {importProgressText ?? t('action.importShort')}
            </Button>
            <Button
              loading={busyAction === 'export'}
              onClick={actions.exportAuthFiles}
              variant="outline"
            >
              <DownloadIcon data-icon="inline-start" />
              {t('action.exportShort')}
            </Button>
            <Button
              disabled={busyAction === 'usage'}
              onClick={() =>
                hasCheckedAccounts
                  ? actions.checkUsageForAccounts(checkedIds)
                  : actions.checkUsage()
              }
              variant="outline"
            >
              <RefreshCwIcon data-icon="inline-start" />
              {busyAction === 'usage'
                ? (usageProgressText(usageProgress) ?? t('action.checkUsage'))
                : t('action.checkUsage')}
            </Button>
            <Button
              disabled={!hasCheckedAccounts}
              loading={busyAction === 'account'}
              onClick={() => actions.setAccountsDisabled(checkedIds, false)}
              variant="outline"
            >
              <PowerIcon data-icon="inline-start" />
              {t('action.enableSelected')}
            </Button>
            <Button
              disabled={!hasCheckedAccounts}
              loading={busyAction === 'account'}
              onClick={() => actions.setAccountsDisabled(checkedIds, true)}
              variant="destructive-outline"
            >
              <XCircleIcon data-icon="inline-start" />
              {t('action.disableSelected')}
            </Button>
            <Button
              disabled={!hasCheckedAccounts}
              loading={busyAction === 'account'}
              onClick={() => actions.deleteAccounts(checkedIds)}
              variant="destructive-outline"
            >
              <Trash2Icon data-icon="inline-start" />
              {t('action.deleteSelected')}
            </Button>
            <Button
              loading={busyAction === 'clean'}
              onClick={actions.cleanExpired}
              variant="outline"
            >
              {t('action.cleanExpired')}
            </Button>
          </>
        }
        description={t('accounts.desc')}
        title={t('accounts.title')}
      />

      <section className="grid h-[92px] shrink-0 grid-cols-5 gap-3">
        <MetricCard
          label={t('accounts.managedAccounts')}
          tone="info"
          value={String(snapshot.status.authPoolAccounts)}
        />
        <MetricCard
          label={t('metric.available')}
          tone="success"
          value={String(snapshot.status.authPoolAvailableAccounts)}
        />
        <MetricCard
          label={t('metric.exhausted')}
          tone="warning"
          value={String(snapshot.status.authPoolExhaustedAccounts)}
        />
        <MetricCard
          label={t('status.disabled')}
          value={String(snapshot.status.authPoolDisabledAccounts)}
        />
        <MetricCard
          label={t('accounts.needsReview')}
          tone="warning"
          value={String(needsReviewCount(snapshot.accounts))}
        />
      </section>

      <section className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_330px] min-[1400px]:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          <Card className="min-h-0 flex-1 overflow-hidden rounded-xl shadow-none">
            <CardHeader className="p-4 pb-2">
              <CardTitle>{t('accounts.title')}</CardTitle>
            </CardHeader>
            <CardPanel className="flex min-h-0 flex-col p-3 pt-0">
              <AccountFilters
                formatFilter={formatFilter}
                onFormatChange={setFormatFilter}
                onPlanChange={setPlanFilter}
                onQueryChange={setQuery}
                onStatusChange={setStatusFilter}
                planFilter={planFilter}
                query={query}
                statusFilter={statusFilter}
                t={t}
              />
              {visibleAccounts.length === 0 ? (
                <div className="rounded-lg border bg-muted/40 p-6 text-muted-foreground text-sm">
                  {snapshot.accounts.length === 0 ? t('accounts.empty') : t('accounts.noMatch')}
                </div>
              ) : (
                <AccountTable
                  accounts={visibleAccounts}
                  actions={actions}
                  checkedAccountIds={checkedAccountIds}
                  locale={locale}
                  setCheckedAccountIds={setCheckedAccountIds}
                  selectedAccountId={selectedAccount?.accountId}
                  setSelectedAccountId={setSelectedAccountId}
                  t={t}
                />
              )}
            </CardPanel>
          </Card>
        </div>

        <AccountInspector
          account={selectedAccount}
          actions={actions}
          busyAction={busyAction}
          locale={locale}
          snapshot={snapshot}
          t={t}
        />
      </section>
    </div>
  )
}

function usageProgressText(progress: PageProps['usageProgress']): string | null {
  if (!progress) {
    return null
  }
  return progress.total > 0 ? `${progress.completed}/${progress.total}` : '0/0'
}

function needsReviewCount(accounts: ManagedAccount[]): number {
  return accounts.filter(accountNeedsReview).length
}

function AccountTable({
  accounts,
  actions,
  checkedAccountIds,
  locale,
  selectedAccountId,
  setCheckedAccountIds,
  setSelectedAccountId,
  t
}: Pick<PageProps, 'actions' | 'locale' | 't'> & {
  accounts: ManagedAccount[]
  checkedAccountIds: Set<string>
  selectedAccountId?: string
  setCheckedAccountIds: (value: Set<string>) => void
  setSelectedAccountId: (accountId: string) => void
}): ReactElement {
  const [sort, setSort] = useState<AccountSort>({ direction: 'desc', key: 'primaryUsage' })
  const [checkingAccountId, setCheckingAccountId] = useState<string | null>(null)
  const sortedAccounts = useMemo(() => sortAccounts(accounts, sort), [accounts, sort])
  const virtualAccounts = useVirtualRows({
    renderedRowLimit: VIRTUAL_ROW_BATCH_SIZE,
    rowHeight: 80,
    rows: sortedAccounts
  })
  const allVisibleChecked =
    sortedAccounts.length > 0 &&
    sortedAccounts.every((account) => checkedAccountIds.has(account.accountId))
  const toggleAllVisible = (checked: boolean): void => {
    const next = new Set(checkedAccountIds)
    for (const account of sortedAccounts) {
      if (checked) {
        next.add(account.accountId)
      } else {
        next.delete(account.accountId)
      }
    }
    setCheckedAccountIds(next)
  }
  const toggleAccount = (accountId: string, checked: boolean): void => {
    const next = new Set(checkedAccountIds)
    if (checked) {
      next.add(accountId)
    } else {
      next.delete(accountId)
    }
    setCheckedAccountIds(next)
  }

  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-lg border [overflow-anchor:none]"
      onScroll={virtualAccounts.onScroll}
      ref={virtualAccounts.containerRef}
    >
      <table
        aria-rowcount={sortedAccounts.length}
        className="w-full table-fixed border-separate border-spacing-0 text-xs min-[1400px]:text-sm"
      >
        <colgroup>
          <col className="w-[38px]" />
          <col className="w-[210px] min-[1400px]:w-[250px]" />
          <col className="w-[76px] min-[1400px]:w-[82px]" />
          <col className="w-[72px] min-[1400px]:w-[82px]" />
          <col className="w-[250px] min-[1400px]:w-[320px]" />
          <col className="w-[140px] min-[1400px]:w-[178px]" />
          <col className="w-[86px] min-[1400px]:w-[96px]" />
        </colgroup>
        <thead className="sticky top-0 z-10">
          <tr className="bg-muted/60 text-muted-foreground">
            <th className="h-9 rounded-l-lg px-2.5 text-left align-middle font-bold leading-none">
              <Checkbox
                checked={allVisibleChecked}
                onCheckedChange={(checked) => toggleAllVisible(checked === true)}
              />
            </th>
            {accountColumns(t).map((column) => (
              <th
                className="h-9 px-2.5 text-left align-middle font-bold leading-none"
                key={column.key}
              >
                <button
                  className="block w-full truncate text-left"
                  onClick={() => setSort(nextAccountSort(sort, column.key))}
                  type="button"
                >
                  {column.label}
                  {sort.key === column.key ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ''}
                </button>
              </th>
            ))}
            <th className="h-9 rounded-r-lg px-2.5 text-right align-middle font-bold leading-none">
              {t('table.action')}
            </th>
          </tr>
        </thead>
        <tbody>
          <PlainSpacerRow colSpan={7} height={virtualAccounts.topPadding} />
          {virtualAccounts.rows.map(({ index, item: account }) => (
            <tr
              className={[
                'h-20 cursor-pointer border-b',
                selectedAccountId === account.accountId
                  ? 'bg-muted/60'
                  : index % 2 === 0
                    ? 'bg-card'
                    : 'bg-muted/40'
              ].join(' ')}
              key={account.accountId}
              onClick={() => setSelectedAccountId(account.accountId)}
            >
              <td className="w-px px-2.5 align-middle">
                <Checkbox
                  checked={checkedAccountIds.has(account.accountId)}
                  onCheckedChange={(checked) => toggleAccount(account.accountId, checked === true)}
                  onClick={(event) => event.stopPropagation()}
                />
              </td>
              <td className="max-w-0 overflow-hidden px-2.5 align-middle">
                <div className="flex flex-col gap-1">
                  <span
                    className="truncate font-medium"
                    title={accountDisplayName(account, t('accounts.emailPending'))}
                  >
                    {accountDisplayName(account, t('accounts.emailPending'))}
                  </span>
                  <span className="text-muted-foreground text-[11px]">
                    {account.planType ?? '-'}
                  </span>
                </div>
              </td>
              <td className="px-2.5 align-middle">
                <AccountStatus account={account} t={t} />
              </td>
              <td className="overflow-hidden px-2.5 align-middle">
                {accountFormatLabel(account, t)}
              </td>
              <td className="max-w-0 overflow-hidden px-2.5 align-middle">
                <AccountQuota account={account} locale={locale} t={t} />
              </td>
              <td className="max-w-0 overflow-hidden px-2.5 align-middle">
                <AccountLastCheck account={account} locale={locale} t={t} />
              </td>
              <td className="overflow-hidden px-2.5 align-middle">
                <div className="flex justify-end gap-1.5">
                  <Button
                    loading={checkingAccountId === account.accountId}
                    onClick={async (event) => {
                      event.stopPropagation()
                      setCheckingAccountId(account.accountId)
                      try {
                        await actions.checkUsageForAccounts([account.accountId])
                      } finally {
                        setCheckingAccountId(null)
                      }
                    }}
                    size="icon"
                    title={t('dashboard.refreshUsage')}
                    variant="outline"
                  >
                    <RefreshCwIcon />
                  </Button>
                  <Button
                    onClick={(event) => {
                      event.stopPropagation()
                      actions.setAccountDisabled(account.accountId, account.status !== 'disabled')
                    }}
                    size="icon"
                    title={account.status === 'disabled' ? t('action.enable') : t('action.disable')}
                    variant="outline"
                  >
                    {account.status === 'disabled' ? <PowerIcon /> : <XCircleIcon />}
                  </Button>
                </div>
              </td>
            </tr>
          ))}
          <PlainSpacerRow colSpan={7} height={virtualAccounts.bottomPadding} />
        </tbody>
      </table>
    </div>
  )
}

function AccountLastCheck({
  account,
  locale,
  t
}: Pick<PageProps, 'locale' | 't'> & { account: ManagedAccount }): ReactElement {
  const summary = accountLastCheckSummary(account, locale, t)
  return (
    <div className="flex min-w-0 flex-col gap-1" title={summary.title}>
      <span className={`truncate font-medium ${lastCheckSummaryClass(summary.severity)}`}>
        {summary.label}
      </span>
      <span className="truncate text-muted-foreground text-[11px]">{summary.checkedAt}</span>
    </div>
  )
}

function lastCheckSummaryClass(
  severity: ReturnType<typeof accountLastCheckSummary>['severity']
): string {
  if (severity === 'error') {
    return 'text-destructive'
  }
  if (severity === 'warning') {
    return 'text-amber-700 dark:text-amber-300'
  }
  if (severity === 'success') {
    return 'text-emerald-700 dark:text-emerald-300'
  }
  return 'text-muted-foreground'
}

type SortDirection = 'asc' | 'desc'
type AccountSortKey = 'account' | 'format' | 'lastCheck' | 'primaryUsage' | 'status'

interface AccountSort {
  direction: SortDirection
  key: AccountSortKey
}

function accountColumns(t: PageProps['t']): Array<{ key: AccountSortKey; label: string }> {
  return [
    { key: 'account', label: t('table.account') },
    { key: 'status', label: t('table.status') },
    { key: 'format', label: t('accounts.format') },
    { key: 'primaryUsage', label: t('table.primaryUsage') },
    { key: 'lastCheck', label: t('table.lastCheck') }
  ]
}

function nextAccountSort(current: AccountSort, key: AccountSortKey): AccountSort {
  return {
    direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    key
  }
}

function sortAccounts(accounts: ManagedAccount[], sort: AccountSort): ManagedAccount[] {
  return [...accounts].sort((left, right) => compareAccounts(left, right, sort))
}

function compareAccounts(left: ManagedAccount, right: ManagedAccount, sort: AccountSort): number {
  const direction = sort.direction === 'asc' ? 1 : -1
  if (sort.key === 'lastCheck') {
    return ((left.lastUsageCheckedAt ?? 0) - (right.lastUsageCheckedAt ?? 0)) * direction
  }
  if (sort.key === 'primaryUsage') {
    const planPriority = accountPlanSortPriority(left) - accountPlanSortPriority(right)
    if (planPriority !== 0) {
      return planPriority
    }
    const leftUsage = accountRemainingQuotaPercent(left)
    const rightUsage = accountRemainingQuotaPercent(right)
    return (leftUsage - rightUsage) * direction
  }
  const leftValue = accountSortValue(left, sort.key)
  const rightValue = accountSortValue(right, sort.key)
  return leftValue.localeCompare(rightValue) * direction
}

function accountPlanSortPriority(account: ManagedAccount): number {
  const plan = accountPlanKind(account)
  if (plan === 'pro') {
    return 0
  }
  if (plan === 'team') {
    return 1
  }
  if (plan === 'plus') {
    return 2
  }
  if (plan === 'free') {
    return 3
  }
  return 4
}

function AccountQuota({
  account,
  locale,
  t
}: {
  account: ManagedAccount
  locale: PageProps['locale']
  t: PageProps['t']
}): ReactElement {
  const showFiveHour = hasShortQuotaWindow(account)
  const weeklyPercent = showFiveHour ? account.secondaryUsedPercent : account.primaryUsedPercent
  const weeklyResetAt = weeklyQuotaResetAt(account)
  const fiveHourPercent = account.primaryUsedPercent
  const fiveHourResetAt = fiveHourQuotaResetAt(account)
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {showFiveHour ? (
        <QuotaWindow
          label={t('accounts.fiveHourLimit')}
          locale={locale}
          percent={fiveHourPercent}
          resetAt={fiveHourResetAt}
          t={t}
        />
      ) : null}
      <QuotaWindow
        label={t('accounts.weeklyLimit')}
        locale={locale}
        percent={weeklyPercent}
        resetAt={weeklyResetAt}
        t={t}
      />
    </div>
  )
}

function QuotaWindow({
  label,
  locale,
  percent,
  resetAt,
  t
}: {
  label: string
  locale: PageProps['locale']
  percent: string | null | undefined
  resetAt: number | null | undefined
  t: PageProps['t']
}): ReactElement {
  const remaining = remainingUsagePercent(percent)
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <span className="shrink-0 text-muted-foreground text-[11px]">{label}</span>
        <span className="truncate font-medium text-[11px]">
          {formatRemainingUsage(percent, locale)}
        </span>
      </div>
      <div className="truncate text-muted-foreground text-[10px]">
        {t('table.resetAt')}: {formatDateTime(resetAt, locale)}
      </div>
      <QuotaProgress percent={remaining} />
    </div>
  )
}

function formatRemainingUsage(
  value: string | null | undefined,
  locale: PageProps['locale']
): string {
  const remaining = remainingUsagePercent(value)
  return value === null || value === undefined
    ? '-'
    : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(remaining)}%`
}

function QuotaProgress({ percent }: { percent: number }): ReactElement {
  const bounded = Math.max(0, Math.min(100, percent))
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={`h-full rounded-full transition-[width] duration-300 ${quotaProgressClass(
          bounded
        )}`}
        style={{ width: `${bounded}%` }}
      />
    </div>
  )
}

function quotaProgressClass(percent: number): string {
  if (percent >= 60) {
    return 'bg-success'
  }
  if (percent >= 20) {
    return 'bg-warning'
  }
  return 'bg-destructive'
}

function accountSortValue(account: ManagedAccount, key: AccountSortKey): string {
  if (key === 'account') {
    return accountDisplayName(account)
  }
  if (key === 'format') {
    return account.sourceFormat ?? ''
  }
  if (key === 'status') {
    return account.status
  }
  return ''
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
