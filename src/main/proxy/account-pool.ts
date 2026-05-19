import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { type NormalizedAuthFile, normalizeAuthFile } from '../auth/normalize'
import type { AuthPoolConfig } from './types'

export interface RoutedAccount {
  accountId: string
  activeChanged: boolean
  authorization: string
  fingerprint: string
  label: string
}

export interface AccountPoolStatus {
  enabled: boolean
  totalAccounts: number
  availableAccounts: number
  exhaustedAccounts: number
  disabledAccounts: number
}

export interface AccountPoolSnapshot {
  accountId: string
  email?: string
  fingerprint: string
  label: string
  sourceFormat: NormalizedAuthFile['format']
}

export interface AccountRouteRequest {
  conversationKey?: string
  incomingAccountId?: string
}

export interface AccountPoolLoadOptions {
  onWarning?: (warning: AccountPoolLoadWarning) => void
}

export interface AccountPoolLoadWarning {
  error: string
  fileName: string
  reason: 'invalid_auth_file'
}

export interface AccountPoolRuntimeState {
  activeAccountId?: string
  disabledAccountIds: Iterable<string>
  exhaustedAccountIds: Iterable<string>
}

export class AccountPool {
  private static readonly bindingRetentionMs = 24 * 60 * 60 * 1000
  private accounts: NormalizedAuthFile[]
  private readonly accountsById = new Map<string, NormalizedAuthFile>()
  private readonly exhaustedAccountIds = new Set<string>()
  private readonly disabledAccountIds = new Set<string>()
  private readonly conversationBindings = new Map<
    string,
    { accountId: string; lastUsedAt: number }
  >()
  private activeAccountId?: string
  private nextAccountIndex = 0

  constructor(accounts: NormalizedAuthFile[]) {
    this.accounts = accounts
    for (const account of accounts) {
      this.accountsById.set(account.accountId, account)
    }
  }

  static disabled(): AccountPool {
    return new AccountPool([])
  }

  static fromConfig(config: AuthPoolConfig, options: AccountPoolLoadOptions = {}): AccountPool {
    if (!config.enabled || config.directory.trim() === '') {
      return AccountPool.disabled()
    }

    const accounts = readAuthDirectory(config.directory, options.onWarning)
    return new AccountPool(accounts)
  }

  status(enabled: boolean): AccountPoolStatus {
    return {
      enabled,
      totalAccounts: this.accounts.length,
      availableAccounts: this.availableAccounts().length,
      exhaustedAccounts: this.accounts.filter((account) =>
        this.exhaustedAccountIds.has(account.accountId)
      ).length,
      disabledAccounts: this.accounts.filter((account) =>
        this.disabledAccountIds.has(account.accountId)
      ).length
    }
  }

  snapshot(): AccountPoolSnapshot[] {
    return this.accounts.map((account) => ({
      accountId: account.accountId,
      email: account.email,
      fingerprint: account.fingerprint,
      label: account.label,
      sourceFormat: account.format
    }))
  }

  applyExhaustedAccountIds(accountIds: Iterable<string>): void {
    this.applyKnownAccountIds(accountIds, (accountId) => {
      this.exhaustedAccountIds.add(accountId)
    })
  }

  applyDisabledAccountIds(accountIds: Iterable<string>): void {
    this.applyKnownAccountIds(accountIds, (accountId) => {
      this.disabledAccountIds.add(accountId)
    })
  }

  applyActiveAccountId(accountId: string | undefined): void {
    if (accountId && this.isAvailable(accountId)) {
      this.activeAccountId = accountId
    }
  }

  currentActiveAccountId(): string | undefined {
    return this.activeAccountId
  }

  applyRuntimeState(state: AccountPoolRuntimeState): void {
    this.exhaustedAccountIds.clear()
    this.disabledAccountIds.clear()
    this.applyExhaustedAccountIds(state.exhaustedAccountIds)
    this.applyDisabledAccountIds(state.disabledAccountIds)
    this.activeAccountId = undefined
    this.applyActiveAccountId(state.activeAccountId)
    this.pruneUnavailableConversationBindings()
  }

  removeAccountIds(accountIds: Iterable<string>): void {
    const removedIds = new Set(accountIds)
    if (removedIds.size === 0) {
      return
    }

    this.accounts = this.accounts.filter((account) => !removedIds.has(account.accountId))
    for (const accountId of removedIds) {
      this.accountsById.delete(accountId)
      this.exhaustedAccountIds.delete(accountId)
      this.disabledAccountIds.delete(accountId)
      if (this.activeAccountId === accountId) {
        this.activeAccountId = undefined
      }
    }
    this.pruneUnavailableConversationBindings()
    this.nextAccountIndex = Math.min(this.nextAccountIndex, Math.max(this.accounts.length - 1, 0))
  }

  selectActiveAccount(accountId?: string): RoutedAccount | undefined {
    const available = this.availableAccounts()
    if (available.length === 0) {
      return undefined
    }

    const selected = accountId
      ? available.find((account) => account.accountId === accountId)
      : this.nextAvailableAfterActive(available)
    if (!selected) {
      return undefined
    }

    const activeChanged = this.activeAccountId !== selected.accountId
    this.activeAccountId = selected.accountId
    this.nextAccountIndex = this.indexAfter(selected.accountId)
    return toRoutedAccount(selected, activeChanged)
  }

  private applyKnownAccountIds(
    accountIds: Iterable<string>,
    apply: (accountId: string) => void
  ): void {
    const knownAccountIds = new Set(this.accounts.map((account) => account.accountId))
    for (const accountId of accountIds) {
      if (knownAccountIds.has(accountId)) {
        apply(accountId)
      }
    }
  }

  private pruneConversationBindings(now = Date.now()): void {
    for (const [conversationKey, binding] of this.conversationBindings.entries()) {
      if (now - binding.lastUsedAt > AccountPool.bindingRetentionMs) {
        this.conversationBindings.delete(conversationKey)
      }
    }
  }

  private pruneUnavailableConversationBindings(): void {
    for (const [conversationKey, binding] of this.conversationBindings.entries()) {
      if (!this.accountsById.has(binding.accountId)) {
        this.conversationBindings.delete(conversationKey)
      }
    }
  }

  select(request: AccountRouteRequest): RoutedAccount | undefined {
    if (this.accounts.length === 0) {
      return undefined
    }

    this.pruneConversationBindings()
    const activeAccount = this.findActiveAvailableAccount()
    const account = activeAccount ?? this.selectNextAvailableAccount(request.incomingAccountId)
    if (!account) {
      return undefined
    }

    const activeChanged = this.activeAccountId !== account.accountId
    this.activeAccountId = account.accountId
    if (request.conversationKey) {
      this.conversationBindings.set(request.conversationKey, {
        accountId: account.accountId,
        lastUsedAt: Date.now()
      })
    }

    return toRoutedAccount(account, activeChanged)
  }

  markExhausted(accountId: string | undefined, conversationKey: string | undefined): void {
    if (!accountId) {
      return
    }

    this.exhaustedAccountIds.add(accountId)
    if (this.activeAccountId === accountId) {
      this.activeAccountId = undefined
    }
    this.nextAccountIndex = this.indexAfter(accountId)
    if (
      conversationKey &&
      this.conversationBindings.get(conversationKey)?.accountId === accountId
    ) {
      this.conversationBindings.delete(conversationKey)
    }
  }

  markDisabled(accountId: string | undefined, conversationKey: string | undefined): void {
    if (!accountId) {
      return
    }

    this.disabledAccountIds.add(accountId)
    if (this.activeAccountId === accountId) {
      this.activeAccountId = undefined
    }
    this.nextAccountIndex = this.indexAfter(accountId)
    if (
      conversationKey &&
      this.conversationBindings.get(conversationKey)?.accountId === accountId
    ) {
      this.conversationBindings.delete(conversationKey)
    }
  }

  private findActiveAvailableAccount(): NormalizedAuthFile | undefined {
    if (!this.activeAccountId || !this.isAvailable(this.activeAccountId)) {
      return undefined
    }

    return this.accountsById.get(this.activeAccountId)
  }

  private selectNextAvailableAccount(incomingAccountId?: string): NormalizedAuthFile | undefined {
    const available = this.availableAccounts()
    if (available.length === 0) {
      return undefined
    }

    const incoming = available.find((account) => account.accountId === incomingAccountId)
    if (incoming) {
      return incoming
    }

    const selected =
      available.find((account) => this.accounts.indexOf(account) >= this.nextAccountIndex) ??
      available[0]
    this.nextAccountIndex = this.indexAfter(selected.accountId)
    return selected
  }

  private nextAvailableAfterActive(available: NormalizedAuthFile[]): NormalizedAuthFile {
    const currentIndex = this.activeAccountId
      ? available.findIndex((account) => account.accountId === this.activeAccountId)
      : -1
    return available[(currentIndex + 1) % available.length]
  }

  private indexAfter(accountId: string): number {
    const index = this.accounts.findIndex((account) => account.accountId === accountId)
    return index < 0 ? 0 : (index + 1) % Math.max(this.accounts.length, 1)
  }

  private availableAccounts(): NormalizedAuthFile[] {
    return this.accounts.filter(
      (account) =>
        !this.exhaustedAccountIds.has(account.accountId) &&
        !this.disabledAccountIds.has(account.accountId)
    )
  }

  private isAvailable(accountId: string): boolean {
    return (
      this.accountsById.has(accountId) &&
      !this.exhaustedAccountIds.has(accountId) &&
      !this.disabledAccountIds.has(accountId)
    )
  }
}

function readAuthDirectory(
  directory: string,
  onWarning: AccountPoolLoadOptions['onWarning']
): NormalizedAuthFile[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .flatMap((name) => readAuthFile(join(directory, name), name, onWarning))
}

function readAuthFile(
  filePath: string,
  fileName: string,
  onWarning: AccountPoolLoadOptions['onWarning']
): NormalizedAuthFile[] {
  try {
    if (!statSync(filePath).isFile()) {
      return []
    }

    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
    return [normalizeAuthFile(parsed, { fileName })]
  } catch (error) {
    onWarning?.({
      error: error instanceof Error ? error.message : String(error),
      fileName,
      reason: 'invalid_auth_file'
    })
    return []
  }
}

function toRoutedAccount(account: NormalizedAuthFile, activeChanged: boolean): RoutedAccount {
  return {
    accountId: account.accountId,
    activeChanged,
    authorization: `Bearer ${account.codexAuth.tokens.access_token}`,
    fingerprint: account.fingerprint,
    label: account.label
  }
}
