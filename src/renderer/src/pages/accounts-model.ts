import { normalizePercent } from '@renderer/data/format'
import { accountStatusKey, type ManagedAccount } from '@renderer/data/proxy-console'
import type { PageProps } from './types'

export type AccountStatusFilter = 'all' | 'available' | 'exhausted' | 'disabled' | 'invalid'
export type AccountFormatFilter = 'all' | 'codex' | 'cpa' | 'sub2api' | 'unknown'
export type AccountPlanFilter = 'all' | 'free' | 'plus' | 'pro' | 'team' | 'unknown'

export const statusFilters: AccountStatusFilter[] = [
  'all',
  'available',
  'exhausted',
  'disabled',
  'invalid'
]

export const formatFilters: AccountFormatFilter[] = ['all', 'codex', 'cpa', 'sub2api', 'unknown']
export const planFilters: AccountPlanFilter[] = ['all', 'free', 'plus', 'pro', 'team', 'unknown']

export function filterAccounts(
  accounts: ManagedAccount[],
  query: string,
  statusFilter: AccountStatusFilter,
  formatFilter: AccountFormatFilter,
  planFilter: AccountPlanFilter
): ManagedAccount[] {
  const normalized = query.trim().toLowerCase()
  return accounts.filter((account) => {
    const accountStatus = accountNeedsReview(account) ? 'invalid' : account.status
    const accountFormat = accountSourceFormat(account)
    const accountPlan = accountPlanKind(account)
    const matchesQuery =
      normalized === '' ||
      [account.email, account.label, account.accountId, account.fingerprint, account.planType]
        .filter((value): value is string => typeof value === 'string')
        .some((value) => value.toLowerCase().includes(normalized))
    const matchesStatus = statusFilter === 'all' || accountStatus === statusFilter
    const matchesFormat = formatFilter === 'all' || accountFormat === formatFilter
    const matchesPlan = planFilter === 'all' || accountPlan === planFilter
    return matchesQuery && matchesStatus && matchesFormat && matchesPlan
  })
}

export function accountNeedsReview(account: ManagedAccount): boolean {
  return Boolean(account.lastUsageError)
}

export function accountPlanKind(account: ManagedAccount): AccountPlanFilter {
  const plan = account.planType?.trim().toLowerCase()
  if (plan === 'free' || plan === 'plus' || plan === 'pro' || plan === 'team') {
    return plan
  }
  return 'unknown'
}

export function hasShortQuotaWindow(account: ManagedAccount): boolean {
  const plan = accountPlanKind(account)
  return plan === 'plus' || plan === 'pro' || plan === 'team' || hasSecondaryQuotaWindow(account)
}

export function remainingUsagePercent(value: string | null | undefined): number {
  const used = normalizePercent(value)
  return used === undefined ? 0 : Math.max(0, Math.min(100, 100 - used))
}

export function accountRemainingQuotaPercent(account: ManagedAccount): number {
  const primary = remainingUsagePercent(account.primaryUsedPercent)
  if (!hasShortQuotaWindow(account) || !hasSecondaryQuotaWindow(account)) {
    return primary
  }

  return Math.min(primary, remainingUsagePercent(account.secondaryUsedPercent))
}

export function accountQuotaResetAt(account: ManagedAccount): number | null {
  const primary = account.rateLimitResetsAt
  if (!hasShortQuotaWindow(account) || !hasSecondaryQuotaWindow(account)) {
    return primary
  }

  const primaryRemaining = remainingUsagePercent(account.primaryUsedPercent)
  const secondaryRemaining = remainingUsagePercent(account.secondaryUsedPercent)
  return primaryRemaining <= secondaryRemaining
    ? primary
    : (account.secondaryRateLimitResetsAt ?? primary)
}

export function weeklyQuotaResetAt(account: ManagedAccount): number | null {
  if (!hasShortQuotaWindow(account)) {
    return account.rateLimitResetsAt
  }
  return account.secondaryRateLimitResetsAt ?? account.rateLimitResetsAt
}

export function fiveHourQuotaResetAt(account: ManagedAccount): number | null {
  return hasShortQuotaWindow(account) ? account.rateLimitResetsAt : null
}

function hasSecondaryQuotaWindow(account: ManagedAccount): boolean {
  return (
    hasQuotaValue(account.secondaryUsedPercent) || hasQuotaValue(account.secondaryRateLimitResetsAt)
  )
}

function hasQuotaValue(value: number | string | null | undefined): boolean {
  return value !== null && value !== undefined
}

export function planFilterLabel(filter: AccountPlanFilter, t: PageProps['t']): string {
  if (filter === 'all') {
    return t('accounts.allPlans')
  }
  if (filter === 'unknown') {
    return t('accounts.planUnknown')
  }
  return filter
}

export function isPlanFilter(value: unknown): value is AccountPlanFilter {
  return (
    value === 'all' ||
    value === 'free' ||
    value === 'plus' ||
    value === 'pro' ||
    value === 'team' ||
    value === 'unknown'
  )
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
