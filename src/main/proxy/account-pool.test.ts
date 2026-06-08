import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CodexChatGptAuth } from '../auth/normalize'
import { AccountPool } from './account-pool'
import { writeAuthFile } from './service-test-utils'

describe('account pool', () => {
  it('uses one active account until it is exhausted', () => {
    const authDirectory = mkdtempSync(join(tmpdir(), 'codexfree-auth-pool-'))
    writeAuthFile(authDirectory, 'a.json', 'account-a', 'managed-a')
    writeAuthFile(authDirectory, 'b.json', 'account-b', 'managed-b')
    writeAuthFile(authDirectory, 'c.json', 'account-c', 'managed-c')
    const pool = AccountPool.fromConfig({ enabled: true, directory: authDirectory })

    const threadA = pool.select({ conversationKey: 'thread-a', incomingAccountId: 'placeholder' })
    const threadB = pool.select({ conversationKey: 'thread-b', incomingAccountId: 'placeholder' })
    expect(threadA?.accountId).toBe('account-a')
    expect(threadB?.accountId).toBe('account-a')

    pool.markExhausted(threadA?.accountId, 'thread-a')
    const threadARetry = pool.select({
      conversationKey: 'thread-a',
      incomingAccountId: threadA?.accountId
    })
    const threadBNext = pool.select({
      conversationKey: 'thread-b',
      incomingAccountId: threadB?.accountId
    })

    expect(threadARetry?.accountId).toBe('account-b')
    expect(threadBNext?.accountId).toBe('account-b')
  })

  it('applies persisted exhausted accounts before selection', () => {
    const authDirectory = mkdtempSync(join(tmpdir(), 'codexfree-auth-pool-'))
    writeAuthFile(authDirectory, 'a.json', 'account-a', 'managed-a')
    writeAuthFile(authDirectory, 'b.json', 'account-b', 'managed-b')
    const pool = AccountPool.fromConfig({ enabled: true, directory: authDirectory })
    pool.applyExhaustedAccountIds(['account-a'])

    expect(pool.status(true).availableAccounts).toBe(1)
    expect(pool.select({ incomingAccountId: 'placeholder' })?.accountId).toBe('account-b')
  })

  it('does not reuse disabled accounts from existing conversation bindings', () => {
    const authDirectory = mkdtempSync(join(tmpdir(), 'codexfree-auth-pool-'))
    writeAuthFile(authDirectory, 'a.json', 'account-a', 'managed-a')
    writeAuthFile(authDirectory, 'b.json', 'account-b', 'managed-b')
    const pool = AccountPool.fromConfig({ enabled: true, directory: authDirectory })

    const first = pool.select({ conversationKey: 'thread-a', incomingAccountId: 'placeholder' })
    expect(first?.accountId).toBe('account-a')

    pool.applyDisabledAccountIds(['account-a'])

    expect(pool.status(true).disabledAccounts).toBe(1)
    expect(
      pool.select({ conversationKey: 'thread-a', incomingAccountId: 'placeholder' })?.accountId
    ).toBe('account-b')
  })

  it('does not treat imported file disabled flags as runtime disable state', () => {
    const staleAuth: CodexChatGptAuth = {
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens: {
        id_token: 'id-token',
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        account_id: 'account-a'
      },
      last_refresh: '2026-05-14T00:00:00.000Z'
    }
    const pool = new AccountPool([
      {
        accountId: 'account-a',
        codexAuth: staleAuth,
        disabled: true,
        fingerprint: 'fingerprint-a',
        format: 'codex',
        label: 'Account A',
        lastRefresh: staleAuth.last_refresh,
        refreshable: true,
        upstreamAccountId: 'account-a',
        warnings: []
      }
    ])

    expect(pool.status(true)).toMatchObject({
      totalAccounts: 1,
      availableAccounts: 1,
      disabledAccounts: 0
    })
    expect(pool.select({ incomingAccountId: 'placeholder' })?.accountId).toBe('account-a')
  })

  it('restores the persisted active account when it is still available', () => {
    const authDirectory = mkdtempSync(join(tmpdir(), 'codexfree-auth-pool-'))
    writeAuthFile(authDirectory, 'a.json', 'account-a', 'managed-a')
    writeAuthFile(authDirectory, 'b.json', 'account-b', 'managed-b')
    const pool = AccountPool.fromConfig({ enabled: true, directory: authDirectory })

    pool.applyActiveAccountId('account-b')

    expect(pool.currentActiveAccountId()).toBe('account-b')
    expect(pool.select({ incomingAccountId: 'placeholder' })?.accountId).toBe('account-b')
  })

  it('skips malformed auth files without disabling the whole pool', () => {
    const authDirectory = mkdtempSync(join(tmpdir(), 'codexfree-auth-pool-'))
    writeFileSync(join(authDirectory, 'bad.json'), '{')
    writeAuthFile(authDirectory, 'good.json', 'account-a', 'managed-a')
    const warnings: unknown[] = []

    const pool = AccountPool.fromConfig(
      { enabled: true, directory: authDirectory },
      { onWarning: (warning) => warnings.push(warning) }
    )

    expect(pool.status(true).totalAccounts).toBe(1)
    expect(pool.select({ incomingAccountId: 'placeholder' })?.accountId).toBe('account-a')
    expect(warnings).toEqual([
      expect.objectContaining({
        fileName: 'bad.json',
        reason: 'invalid_auth_file'
      })
    ])
  })

  it('keeps local account identity separate from upstream account header identity', () => {
    const authDirectory = mkdtempSync(join(tmpdir(), 'codexfree-auth-pool-'))
    writeFileSync(
      join(authDirectory, 'team.json'),
      JSON.stringify({
        auth_mode: 'chatgpt',
        OPENAI_API_KEY: null,
        email: 'team-user@example.test',
        plan_type: 'team',
        tokens: {
          id_token: 'id-token',
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          account_id: 'shared-team-account'
        },
        last_refresh: '2026-05-14T00:00:00.000Z'
      })
    )
    const pool = AccountPool.fromConfig({ enabled: true, directory: authDirectory })

    const selected = pool.select({ incomingAccountId: 'placeholder' })

    expect(selected?.accountId).toMatch(/^shared-team-account:user:/)
    expect(selected?.upstreamAccountId).toBe('shared-team-account')
  })
})
