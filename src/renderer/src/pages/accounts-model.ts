import { accountStatusKey, type ManagedAccount } from '@renderer/data/proxy-console'
import type { PageProps } from './types'

export type AccountStatusFilter = 'all' | 'available' | 'exhausted' | 'disabled' | 'invalid'
export type AccountFormatFilter = 'all' | 'codex' | 'cpa' | 'sub2api' | 'unknown'

export const statusFilters: AccountStatusFilter[] = [
  'all',
  'available',
  'exhausted',
  'disabled',
  'invalid'
]

export const formatFilters: AccountFormatFilter[] = ['all', 'codex', 'cpa', 'sub2api', 'unknown']

export function filterAccounts(
  accounts: ManagedAccount[],
  query: string,
  statusFilter: AccountStatusFilter,
  formatFilter: AccountFormatFilter
): ManagedAccount[] {
  const normalized = query.trim().toLowerCase()
  return accounts.filter((account) => {
    const accountStatus = account.lastUsageError ? 'invalid' : account.status
    const accountFormat = accountSourceFormat(account)
    const matchesQuery =
      normalized === '' ||
      [account.email, account.label, account.accountId, account.fingerprint, account.planType]
        .filter((value): value is string => typeof value === 'string')
        .some((value) => value.toLowerCase().includes(normalized))
    const matchesStatus = statusFilter === 'all' || accountStatus === statusFilter
    const matchesFormat = formatFilter === 'all' || accountFormat === formatFilter
    return matchesQuery && matchesStatus && matchesFormat
  })
}

export function accountFormatLabel(account: ManagedAccount, t: PageProps['t']): string {
  return formatLabel(accountSourceFormat(account), t)
}

export function accountSourceFormat(account: ManagedAccount): AccountFormatFilter {
  const explicit = normalizeFormat(account.sourceFormat)
  if (explicit !== 'unknown') {
    return explicit
  }
  if (account.label.startsWith('codex:')) {
    return 'codex'
  }
  if (account.label.startsWith('cpa:')) {
    return 'cpa'
  }
  if (account.label.startsWith('sub2api:')) {
    return 'sub2api'
  }
  return 'unknown'
}

export function normalizeFormat(value: string | null): AccountFormatFilter {
  return isFormatFilter(value) ? value : 'unknown'
}

export function isFormatFilter(value: unknown): value is AccountFormatFilter {
  return (
    value === 'all' ||
    value === 'codex' ||
    value === 'cpa' ||
    value === 'sub2api' ||
    value === 'unknown'
  )
}

export function formatFilterLabel(filter: AccountFormatFilter, t: PageProps['t']): string {
  return filter === 'all' ? t('accounts.allFormats') : formatLabel(filter, t)
}

export function formatLabel(format: string | null, t: PageProps['t']): string {
  const normalized = normalizeFormat(format)
  if (normalized === 'codex') {
    return t('format.codex')
  }
  if (normalized === 'cpa') {
    return t('format.cpa')
  }
  if (normalized === 'sub2api') {
    return t('format.sub2api')
  }
  return t('format.unknown')
}

export function statusFilterLabel(filter: AccountStatusFilter, t: PageProps['t']): string {
  if (filter === 'all') {
    return t('accounts.allStatuses')
  }
  if (filter === 'invalid') {
    return t('accounts.statusInvalid')
  }
  return t(accountStatusKey(filter))
}

export function statusTone(account: ManagedAccount): 'default' | 'success' | 'warning' | 'error' {
  if (account.lastUsageError) {
    return 'error'
  }
  if (account.status === 'exhausted') {
    return 'warning'
  }
  if (account.status === 'disabled') {
    return 'default'
  }
  return 'success'
}
