import { MetricCard } from '@renderer/components/app-shell/metric-card'
import { PageHeader } from '@renderer/components/app-shell/page-header'
import { StatusBadge } from '@renderer/components/app-shell/status-badge'
import { VirtualTableSpacerRow } from '@renderer/components/app-shell/virtual-table-spacer'
import { Button } from '@renderer/components/ui/button'
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle
} from '@renderer/components/ui/card'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@renderer/components/ui/input-group'
import { Progress } from '@renderer/components/ui/progress'
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@renderer/components/ui/table'
import { formatDateTime, normalizePercent, truncateMiddle } from '@renderer/data/format'
import {
  accountDisplayName,
  accountStatusKey,
  accountUsageSummary,
  type ManagedAccount
} from '@renderer/data/proxy-console'
import { useVirtualRows } from '@renderer/hooks/use-virtual-rows'
import {
  DownloadIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchIcon,
  Trash2Icon,
  UploadIcon,
  XCircleIcon
} from 'lucide-react'
import { type ReactElement, useMemo, useState } from 'react'
import {
  type AccountFormatFilter,
  type AccountStatusFilter,
  accountFormatLabel,
  filterAccounts,
  formatFilterLabel,
  formatFilters,
  isFormatFilter,
  statusFilterLabel,
  statusFilters,
  statusTone
} from './accounts-model'
import type { PageProps } from './types'

export function AccountsPage({
  actions,
  busyAction,
  locale,
  snapshot,
  t
}: PageProps): ReactElement {
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<AccountStatusFilter>('all')
  const [formatFilter, setFormatFilter] = useState<AccountFormatFilter>('all')
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [checkedAccountIds, setCheckedAccountIds] = useState<Set<string>>(() => new Set())
  const visibleAccounts = useMemo(
    () => filterAccounts(snapshot.accounts, query, statusFilter, formatFilter),
    [formatFilter, query, snapshot.accounts, statusFilter]
  )
  const selectedAccount =
    visibleAccounts.find((account) => account.accountId === selectedAccountId) ??
    visibleAccounts[0] ??
    snapshot.accounts[0]

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      <PageHeader
        actions={
          <>
            <Button loading={busyAction === 'import'} onClick={actions.importAuthFiles}>
              <UploadIcon data-icon="inline-start" />
              {t('action.import')}
            </Button>
            <Button
              loading={busyAction === 'usage'}
              onClick={() => actions.checkUsageForAccounts([...checkedAccountIds])}
              variant="outline"
            >
              <RefreshCwIcon data-icon="inline-start" />
              {t('action.checkUsage')}
            </Button>
            <Button
              loading={busyAction === 'export'}
              onClick={actions.exportAuthFiles}
              variant="outline"
            >
              <DownloadIcon data-icon="inline-start" />
              {t('action.export')}
            </Button>
            <Button
              loading={busyAction === 'reset'}
              onClick={actions.resetExhausted}
              variant="outline"
            >
              <RotateCcwIcon data-icon="inline-start" />
              {t('action.resetExhausted')}
            </Button>
            <Button
              disabled={checkedAccountIds.size === 0}
              loading={busyAction === 'account'}
              onClick={() => actions.setAccountsDisabled([...checkedAccountIds], true)}
              variant="destructive-outline"
            >
              <XCircleIcon data-icon="inline-start" />
              {t('action.disableSelected')}
            </Button>
            <Button
              disabled={checkedAccountIds.size === 0}
              loading={busyAction === 'account'}
              onClick={() => actions.deleteAccounts([...checkedAccountIds])}
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

      <section className="grid shrink-0 grid-cols-4 gap-3">
        <MetricCard
          label={t('accounts.directory')}
          title={snapshot.managedAuthDirectory}
          tone="info"
          value={snapshot.managedAuthDirectory}
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
      </section>

      <section className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_330px] min-[1400px]:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          <AccountFilters
            formatFilter={formatFilter}
            onFormatChange={setFormatFilter}
            onQueryChange={setQuery}
            query={query}
            t={t}
          />
          <Card className="min-h-0 flex-1 overflow-hidden rounded-xl shadow-none">
            <CardHeader className="p-4 pb-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle>{t('accounts.title')}</CardTitle>
                  <CardDescription>
                    {t('accounts.visibleCount', {
                      total: snapshot.accounts.length,
                      visible: visibleAccounts.length
                    })}
                  </CardDescription>
                </div>
                <AccountStatusTabs
                  onStatusChange={setStatusFilter}
                  statusFilter={statusFilter}
                  t={t}
                />
              </div>
            </CardHeader>
            <CardPanel className="flex min-h-0 flex-col p-3 pt-0">
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

        <AccountInspector account={selectedAccount} locale={locale} snapshot={snapshot} t={t} />
      </section>
    </div>
  )
}

function AccountFilters({
  formatFilter,
  onFormatChange,
  onQueryChange,
  query,
  t
}: {
  formatFilter: AccountFormatFilter
  onFormatChange: (filter: AccountFormatFilter) => void
  onQueryChange: (query: string) => void
  query: string
  t: PageProps['t']
}): ReactElement {
  return (
    <Card className="shrink-0 rounded-xl shadow-none">
      <CardPanel className="flex gap-2 p-3">
        <InputGroup className="min-w-0 flex-1">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t('accounts.search')}
            type="search"
            value={query}
          />
        </InputGroup>
        <Select
          items={formatFilters.map((filter) => ({
            label: formatFilterLabel(filter, t),
            value: filter
          }))}
          onValueChange={(value) => {
            if (isFormatFilter(value)) {
              onFormatChange(value)
            }
          }}
          value={formatFilter}
        >
          <SelectTrigger className="w-40 min-[1400px]:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            <SelectGroup>
              {formatFilters.map((filter) => (
                <SelectItem key={filter} value={filter}>
                  {formatFilterLabel(filter, t)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectPopup>
        </Select>
      </CardPanel>
    </Card>
  )
}

function AccountStatusTabs({
  onStatusChange,
  statusFilter,
  t
}: {
  onStatusChange: (filter: AccountStatusFilter) => void
  statusFilter: AccountStatusFilter
  t: PageProps['t']
}): ReactElement {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
      {statusFilters.map((filter) => (
        <Button
          className={
            statusFilter === filter ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''
          }
          key={filter}
          onClick={() => onStatusChange(filter)}
          size="sm"
          variant="ghost"
        >
          {statusFilterLabel(filter, t)}
        </Button>
      ))}
    </div>
  )
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
  const virtualAccounts = useVirtualRows({ rowHeight: 56, rows: accounts })
  const allVisibleChecked =
    accounts.length > 0 && accounts.every((account) => checkedAccountIds.has(account.accountId))
  const toggleAllVisible = (checked: boolean): void => {
    const next = new Set(checkedAccountIds)
    for (const account of accounts) {
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
      <Table aria-rowcount={accounts.length} className="table-fixed text-xs min-[1400px]:text-sm">
        <colgroup>
          <col className="w-[38px]" />
          <col className="w-[210px]" />
          <col className="w-[82px]" />
          <col className="w-[76px]" />
          <col />
          <col className="w-[130px]" />
          <col className="w-[96px]" />
        </colgroup>
        <TableHeader>
          <TableRow>
            <TableHead>
              <Checkbox
                checked={allVisibleChecked}
                onCheckedChange={(checked) => toggleAllVisible(checked === true)}
              />
            </TableHead>
            <TableHead>{t('table.account')}</TableHead>
            <TableHead>{t('table.status')}</TableHead>
            <TableHead>{t('accounts.format')}</TableHead>
            <TableHead>{t('table.primaryUsage')}</TableHead>
            <TableHead>{t('table.lastCheck')}</TableHead>
            <TableHead>{t('table.action')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <VirtualTableSpacerRow colSpan={7} height={virtualAccounts.topPadding} />
          {virtualAccounts.rows.map(({ item: account }) => (
            <TableRow
              className={selectedAccountId === account.accountId ? 'h-14 bg-muted/60' : 'h-14'}
              key={account.accountId}
              onClick={() => setSelectedAccountId(account.accountId)}
            >
              <TableCell>
                <Checkbox
                  checked={checkedAccountIds.has(account.accountId)}
                  onCheckedChange={(checked) => toggleAccount(account.accountId, checked === true)}
                  onClick={(event) => event.stopPropagation()}
                />
              </TableCell>
              <TableCell className="max-w-0 overflow-hidden">
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
              </TableCell>
              <TableCell>
                <AccountStatus account={account} t={t} />
              </TableCell>
              <TableCell className="overflow-hidden truncate">
                {accountFormatLabel(account, t)}
              </TableCell>
              <TableCell className="max-w-0 overflow-hidden">
                <div className="flex min-w-0 flex-col gap-1">
                  <span>{accountUsageSummary(account, locale)}</span>
                  <Progress value={normalizePercent(account.primaryUsedPercent) ?? 0} />
                </div>
              </TableCell>
              <TableCell className="max-w-0 overflow-hidden truncate">
                {account.lastUsageError ?? formatDateTime(account.lastUsageCheckedAt, locale)}
              </TableCell>
              <TableCell className="overflow-hidden truncate">
                <Button
                  onClick={(event) => {
                    event.stopPropagation()
                    actions.setAccountDisabled(account.accountId, account.status !== 'disabled')
                  }}
                  size="sm"
                  variant="outline"
                >
                  <XCircleIcon data-icon="inline-start" />
                  {account.status === 'disabled' ? t('action.enable') : t('action.disable')}
                </Button>
              </TableCell>
            </TableRow>
          ))}
          <VirtualTableSpacerRow colSpan={7} height={virtualAccounts.bottomPadding} />
        </TableBody>
      </Table>
    </div>
  )
}

function AccountInspector({
  account,
  locale,
  snapshot,
  t
}: Pick<PageProps, 'locale' | 'snapshot' | 't'> & {
  account?: ManagedAccount
}): ReactElement {
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
                label={t('table.resetAt')}
                value={formatDateTime(account.rateLimitResetsAt, locale)}
              />
            </div>
            <ContextList
              empty={t('status.empty')}
              items={requests.map((request) => ({
                id: request.id,
                meta: formatDateTime(request.startedAt, locale),
                title: `${request.method} ${request.path}`
              }))}
              title={t('accounts.requestHistory')}
            />
            <ContextList
              empty={t('status.empty')}
              items={events.map((event) => ({
                id: event.id,
                meta: formatDateTime(event.createdAt, locale),
                title: event.message
              }))}
              title={t('accounts.quotaHistory')}
            />
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

function AccountStatus({
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
