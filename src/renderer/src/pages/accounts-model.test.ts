import type { ManagedAccount } from '@renderer/data/proxy-console'
import { createTranslator } from '@renderer/i18n/copy'
import { describe, expect, it } from 'vitest'
import {
  accountLastCheckSummary,
  accountNeedsReview,
  accountPlanKind,
  accountQuotaResetAt,
  accountRemainingQuotaPercent,
  accountReviewError,
  filterAccounts,
  fiveHourQuotaResetAt,
  hasShortQuotaWindow,
  weeklyQuotaResetAt
} from './accounts-model'

const t = createTranslator('zh-CN')

describe('accounts model quota windows', () => {
  it('treats team accounts as 5-hour plus weekly quota accounts', () => {
    const account = managedAccount({
      planType: 'team',
      primaryUsedPercent: '10',
      secondaryUsedPercent: '7',
      rateLimitResetsAt: 1780927748000,
      secondaryRateLimitResetsAt: 1781496691000
    })

    expect(accountPlanKind(account)).toBe('team')
    expect(hasShortQuotaWindow(account)).toBe(true)
    expect(fiveHourQuotaResetAt(account)).toBe(1780927748000)
    expect(weeklyQuotaResetAt(account)).toBe(1781496691000)
    expect(accountRemainingQuotaPercent(account)).toBe(90)
    expect(accountQuotaResetAt(account)).toBe(1780927748000)
  })

  it('keeps free accounts on a single primary quota window', () => {
    const account = managedAccount({
      planType: 'free',
      primaryUsedPercent: '100',
      rateLimitResetsAt: 1783413003000
    })

    expect(hasShortQuotaWindow(account)).toBe(false)
    expect(accountRemainingQuotaPercent(account)).toBe(0)
    expect(accountQuotaResetAt(account)).toBe(1783413003000)
    expect(weeklyQuotaResetAt(account)).toBe(1783413003000)
    expect(fiveHourQuotaResetAt(account)).toBeNull()
  })

  it('recognizes unknown future plans with a secondary quota window as dual-window accounts', () => {
    const account = managedAccount({
      planType: 'business',
      primaryUsedPercent: '12',
      secondaryUsedPercent: '60',
      rateLimitResetsAt: 1780927748000,
      secondaryRateLimitResetsAt: 1781496691000
    })

    expect(hasShortQuotaWindow(account)).toBe(true)
    expect(accountRemainingQuotaPercent(account)).toBe(40)
    expect(accountQuotaResetAt(account)).toBe(1781496691000)
  })

  it('allows filtering team accounts by plan', () => {
    const accounts = [
      managedAccount({ accountId: 'team-account', planType: 'team' }),
      managedAccount({ accountId: 'free-account', planType: 'free' })
    ]

    expect(
      filterAccounts(accounts, '', 'all', 'all', 'team').map((account) => account.accountId)
    ).toEqual(['team-account'])
  })

  it('counts only usage errors as accounts needing review', () => {
    const uncheckedAccount = managedAccount({
      accountId: 'unchecked-account',
      lastUsageCheckedAt: null,
      lastUsageError: null
    })
    const errorAccount = managedAccount({
      accountId: 'error-account',
      lastUsageCheckedAt: 1780927748000,
      lastUsageError: 'usage check failed'
    })
    const quotaUnavailableAccount = managedAccount({
      accountId: 'quota-unavailable-account',
      lastUsageCheckedAt: 1780927748000,
      lastUsageError: 'usage check failed: 402',
      status: 'exhausted'
    })
    const accounts = [uncheckedAccount, errorAccount, quotaUnavailableAccount]

    expect(accountNeedsReview(uncheckedAccount)).toBe(false)
    expect(accountNeedsReview(errorAccount)).toBe(true)
    expect(accountNeedsReview(quotaUnavailableAccount)).toBe(false)
    expect(accountReviewError(quotaUnavailableAccount)).toBeNull()
    expect(
      filterAccounts(accounts, '', 'invalid', 'all', 'all').map((account) => account.accountId)
    ).toEqual(['error-account'])
  })

  it('summarizes last usage check errors for compact account tables', () => {
    const checkedAt = 1780927748000

    expect(
      accountLastCheckSummary(
        managedAccount({
          lastUsageCheckedAt: checkedAt,
          lastUsageError: 'usage check failed: 401'
        }),
        'zh-CN',
        t
      )
    ).toMatchObject({
      checkedAt: expect.any(String),
      label: '401 认证失效',
      severity: 'error'
    })
    expect(
      accountLastCheckSummary(
        managedAccount({
          lastUsageCheckedAt: checkedAt,
          lastUsageError: 'usage check failed: 402'
        }),
        'zh-CN',
        t
      )
    ).toMatchObject({
      label: '402 额度不可用',
      severity: 'warning'
    })
    expect(
      accountLastCheckSummary(
        managedAccount({
          lastUsageCheckedAt: checkedAt,
          lastUsageError: 'usage check failed: socket timeout'
        }),
        'zh-CN',
        t
      )
    ).toMatchObject({
      label: '检查失败',
      severity: 'error'
    })
    expect(
      accountLastCheckSummary(managedAccount({ lastUsageCheckedAt: checkedAt }), 'zh-CN', t)
    ).toMatchObject({
      label: '检查正常',
      severity: 'success'
    })
  })
})

function managedAccount(overrides: Partial<ManagedAccount> = {}): ManagedAccount {
  return {
    accountId: 'account-id',
    active: 0,
    email: null,
    exhaustedAt: null,
    fingerprint: 'fingerprint',
    label: 'account@example.test',
    lastUsageCheckedAt: null,
    lastUsageError: null,
    planType: null,
    primaryUsedPercent: null,
    quotaResetAt: null,
    rateLimitResetsAt: null,
    secondaryRateLimitResetsAt: null,
    secondaryUsedPercent: null,
    sourceFormat: 'codex',
    status: 'available',
    updatedAt: 0,
    ...overrides
  }
}
