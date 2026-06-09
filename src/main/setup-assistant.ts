import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { readImportedAuthAccounts } from './auth/import'
import {
  backupCodexFile,
  listCodexBackupFileNames,
  nextCodexBackupFileName,
  renameCodexFileToBackup,
  restoreCodexFileBackup,
  sourceCodexFilePath
} from './codex/backup-files'
import type { ManagedAccountRow } from './proxy/ledger-types'
import type { ProxyStatus, RecentRequest } from './proxy/types'
import type { MainRuntime } from './runtime'

export type CodexConfigHealth =
  | 'current'
  | 'missing'
  | 'missing_values'
  | 'port_mismatch'
  | 'wrong_table'
  | 'model_provider_present'
  | 'mismatch'

export type CodexAuthHealth =
  | 'missing'
  | 'codex_login_like'
  | 'placeholder'
  | 'api_key_mode'
  | 'unrecognized'
export type DaemonRunMode = 'app_child' | 'system_service' | 'stopped' | 'external_or_unknown'

export interface SetupAssistantState {
  accounts: SetupAccountState
  auth: CodexAuthInspection
  availableModelCount: number | null
  checkedAt: number
  codexConfig: CodexConfigInspection
  daemon: SetupDaemonState
  ready: boolean
  recentSuccess: SetupRecentSuccess
  target: SetupTargetConfig
}

export interface SetupAccountState {
  available: number
  disabled: number
  exhausted: number
  lastUsageCheckedAt: number | null
  total: number
  usageCheckedAvailable: number
}

export interface SetupDaemonState {
  endpoint: string
  error: string | null
  mode: DaemonRunMode
  outboundMode: string
  running: boolean
}

export interface SetupRecentSuccess {
  kind: 'models' | 'usage' | null
  requestId: string | null
  seenAt: number | null
}

export interface SetupTargetConfig {
  chatgptBaseUrl: string
  openaiBaseUrl: string
}

export interface CodexConfigInspection {
  chatgptBaseUrl: string | null
  hasModelProvider: boolean
  health: CodexConfigHealth
  openaiBaseUrl: string | null
  path: string
  target: SetupTargetConfig
}

export interface CodexAuthInspection {
  backupFileName: string
  backupFileNames: string[]
  exists: boolean
  health: CodexAuthHealth
  lastModifiedAt: number | null
  path: string
}

export interface CodexAuthWriteResult {
  accountId: string
  auth: CodexAuthInspection
  backupFileName: string
  label: string
  replaced: boolean
}

export interface CodexAuthRestoreResult {
  auth: CodexAuthInspection
  backupFileName: string | null
  replaced: boolean
  restoredFileName: string
}

interface Assignment {
  key: 'chatgpt_base_url' | 'openai_base_url' | 'model_provider'
  table: string | null
  value: string | null
}

export async function readSetupAssistantState(runtime: MainRuntime): Promise<SetupAssistantState> {
  const config = runtime.readRuntimeConfig()
  const target = setupTargetConfig(config.listenHost, config.listenPort)
  const [proxy, accounts, recentRequests] = await Promise.all([
    readProxyStatus(runtime),
    readManagedAccounts(runtime),
    readRecentRequests(runtime)
  ])
  const codexConfig = inspectCodexConfig(target)
  const auth = inspectCodexAuth()
  const recentSuccess = findRecentSuccess(accounts)
  return {
    accounts: summarizeAccounts(proxy.status, accounts),
    auth,
    availableModelCount: findAvailableModelCount(recentRequests),
    checkedAt: Date.now(),
    codexConfig,
    daemon: {
      endpoint: proxy.status.endpoint,
      error: proxy.status.lastError ?? null,
      mode: resolveDaemonRunMode(
        proxy.status,
        runtime.readDaemonControlSettings().launchAgent.enabled
      ),
      outboundMode: proxy.status.outboundMode,
      running: proxy.status.running
    },
    ready:
      proxy.status.running &&
      codexConfig.health === 'current' &&
      auth.health === 'codex_login_like' &&
      accounts.some((account) => account.status === 'available') &&
      recentSuccess.kind !== null,
    recentSuccess,
    target
  }
}

export function inspectCodexConfig(
  target: SetupTargetConfig,
  homeDirectory = homedir()
): CodexConfigInspection {
  const path = join(homeDirectory, '.codex', 'config.toml')
  if (!existsSync(path)) {
    return emptyCodexConfigInspection(path, target, 'missing')
  }

  const assignments = parseTomlAssignments(readFileSync(path, 'utf8'))
  const topChatgpt = findTopValue(assignments, 'chatgpt_base_url')
  const topOpenai = findTopValue(assignments, 'openai_base_url')
  const hasWrongTable = assignments.some(
    (item) =>
      item.table !== null && (item.key === 'chatgpt_base_url' || item.key === 'openai_base_url')
  )
  const hasModelProvider = assignments.some(
    (item) => item.table === null && item.key === 'model_provider'
  )
  const health = resolveConfigHealth({
    hasModelProvider,
    hasWrongTable,
    target,
    topChatgpt,
    topOpenai
  })
  return {
    chatgptBaseUrl: topChatgpt,
    hasModelProvider,
    health,
    openaiBaseUrl: topOpenai,
    path,
    target
  }
}

export function inspectCodexAuth(homeDirectory = homedir()): CodexAuthInspection {
  const codexDir = join(homeDirectory, '.codex')
  const path = sourceCodexFilePath(codexDir, 'auth')
  const backupFileName = nextCodexBackupFileName(codexDir, 'auth')
  const backupFileNames = listCodexBackupFileNames(codexDir, 'auth')
  if (!existsSync(path)) {
    return {
      backupFileName,
      backupFileNames,
      exists: false,
      health: 'missing',
      lastModifiedAt: null,
      path
    }
  }

  const lastModifiedAt = Math.floor(statSync(path).mtimeMs)
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return {
      backupFileName,
      backupFileNames,
      exists: true,
      health: classifyCodexAuth(value),
      lastModifiedAt,
      path
    }
  } catch {
    return {
      backupFileName,
      backupFileNames,
      exists: true,
      health: 'unrecognized',
      lastModifiedAt,
      path
    }
  }
}

export function renameCodexAuthForRelogin(homeDirectory = homedir()): CodexAuthInspection {
  const codexDir = join(homeDirectory, '.codex')
  const backupFileName = basename(renameCodexFileToBackup(codexDir, 'auth'))
  return { ...inspectCodexAuth(homeDirectory), backupFileName }
}

export function restoreCodexAuthBackup(
  backupFileName: string,
  homeDirectory = homedir()
): CodexAuthRestoreResult {
  const codexDir = join(homeDirectory, '.codex')
  const restored = restoreCodexFileBackup(codexDir, 'auth', backupFileName)

  return {
    auth: inspectCodexAuth(homeDirectory),
    backupFileName: restored.backupFileName,
    replaced: restored.replaced,
    restoredFileName: restored.restoredFileName
  }
}

export function writeImportedAccountToCodexAuth(
  accountId: string,
  importedAuthDirectory: string,
  homeDirectory = homedir()
): CodexAuthWriteResult {
  const account = readImportedAuthAccounts(importedAuthDirectory).find(
    (item) => item.accountId === accountId
  )
  if (!account) {
    throw new Error(`Cannot write Codex auth because imported account "${accountId}" was not found`)
  }

  const codexDir = join(homeDirectory, '.codex')
  const authPath = sourceCodexFilePath(codexDir, 'auth')
  const sourcePath = join(importedAuthDirectory, account.fileName)
  if (!existsSync(sourcePath)) {
    throw new Error(`Cannot write Codex auth because imported account file is missing`)
  }

  mkdirSync(codexDir, { recursive: true, mode: 0o700 })
  const replaced = existsSync(authPath)
  const backupPath = replaced ? backupCodexFile(codexDir, 'auth') : null
  const backupFileName = backupPath
    ? basename(backupPath)
    : nextCodexBackupFileName(codexDir, 'auth')
  copyFileSync(sourcePath, authPath)
  chmodSync(authPath, 0o600)

  return {
    accountId: account.accountId,
    auth: { ...inspectCodexAuth(homeDirectory), backupFileName },
    backupFileName,
    label: account.email ?? account.label,
    replaced
  }
}

function resolveConfigHealth(input: {
  hasModelProvider: boolean
  hasWrongTable: boolean
  target: SetupTargetConfig
  topChatgpt: string | null
  topOpenai: string | null
}): CodexConfigHealth {
  if (input.hasWrongTable && (input.topChatgpt === null || input.topOpenai === null)) {
    return 'wrong_table'
  }
  if (input.topChatgpt === null || input.topOpenai === null) {
    return 'missing_values'
  }
  if (
    input.topChatgpt === input.target.chatgptBaseUrl &&
    input.topOpenai === input.target.openaiBaseUrl
  ) {
    return input.hasModelProvider ? 'model_provider_present' : 'current'
  }
  return sameCodexPaths(input.topChatgpt, input.topOpenai, input.target)
    ? 'port_mismatch'
    : 'mismatch'
}

function parseTomlAssignments(content: string): Assignment[] {
  let table: string | null = null
  const assignments: Assignment[] = []
  for (const line of content.split(/\r?\n/)) {
    const tableMatch = /^\s*\[([^\]]+)\]\s*$/.exec(line)
    if (tableMatch) {
      table = tableMatch[1] ?? null
      continue
    }
    const assignmentMatch =
      /^\s*(chatgpt_base_url|openai_base_url|model_provider)\s*=\s*(.+?)\s*$/.exec(line)
    if (!assignmentMatch) {
      continue
    }
    assignments.push({
      key: assignmentMatch[1] as Assignment['key'],
      table,
      value: parseTomlString(assignmentMatch[2] ?? '')
    })
  }
  return assignments
}

function classifyCodexAuth(value: unknown): CodexAuthHealth {
  if (!isRecord(value)) {
    return 'unrecognized'
  }
  if (looksLikeApiKeyMode(value)) {
    return 'api_key_mode'
  }
  if (!isRecord(value.tokens)) {
    return 'unrecognized'
  }
  const tokens = value.tokens
  const accessToken = stringField(tokens, 'access_token')
  const refreshToken = stringField(tokens, 'refresh_token')
  const accountId = stringField(tokens, 'account_id')
  if (!accessToken || !refreshToken || !accountId) {
    return 'unrecognized'
  }
  if (accessToken.startsWith('placeholder.') || refreshToken.startsWith('placeholder.')) {
    return 'placeholder'
  }
  return 'codex_login_like'
}

function looksLikeApiKeyMode(value: Record<string, unknown>): boolean {
  const authMode = stringField(value, 'auth_mode')?.toLowerCase().replaceAll('-', '_')
  if (authMode === 'api_key' || authMode === 'apikey') {
    return true
  }
  const apiKey = stringField(value, 'OPENAI_API_KEY') ?? stringField(value, 'openai_api_key')
  return typeof apiKey === 'string' && apiKey.trim().length > 0
}

function findRecentSuccess(accounts: ManagedAccountRow[]): SetupRecentSuccess {
  const usageAccount = accounts.find(hasCompletedUsageCheck)
  return usageAccount
    ? { kind: 'usage', requestId: null, seenAt: usageAccount.lastUsageCheckedAt }
    : { kind: null, requestId: null, seenAt: null }
}

function findAvailableModelCount(requests: RecentRequest[]): number | null {
  return (
    requests.find(
      (request) =>
        request.requestPurpose === 'models' &&
        request.outcome === 'forwarded' &&
        typeof request.responseItemCount === 'number' &&
        request.responseItemCount > 0
    )?.responseItemCount ?? null
  )
}

function summarizeAccounts(status: ProxyStatus, accounts: ManagedAccountRow[]): SetupAccountState {
  const lastUsageCheckedAt = accounts.reduce<number | null>((latest, account) => {
    if (account.lastUsageCheckedAt === null) {
      return latest
    }
    return latest === null
      ? account.lastUsageCheckedAt
      : Math.max(latest, account.lastUsageCheckedAt)
  }, null)
  return {
    available: status.authPoolAvailableAccounts,
    disabled: status.authPoolDisabledAccounts,
    exhausted: status.authPoolExhaustedAccounts,
    lastUsageCheckedAt,
    total: status.authPoolAccounts || accounts.length,
    usageCheckedAvailable: accounts.filter(
      (account) => account.status === 'available' && hasCompletedUsageCheck(account)
    ).length
  }
}

function hasCompletedUsageCheck(account: ManagedAccountRow): boolean {
  return account.lastUsageCheckedAt !== null && !isUsageCheckReviewError(account.lastUsageError)
}

function isUsageCheckReviewError(error: string | null): boolean {
  return Boolean(error && !/^usage check failed: 402(?:\b|$)/.test(error))
}

function setupTargetConfig(listenHost: string, listenPort: number): SetupTargetConfig {
  const chatgptBaseUrl = `http://${listenHost}:${listenPort}/backend-api`
  return { chatgptBaseUrl, openaiBaseUrl: `${chatgptBaseUrl}/codex` }
}

function resolveDaemonRunMode(status: ProxyStatus, launchAgentEnabled: boolean): DaemonRunMode {
  if (!status.running) {
    return 'stopped'
  }
  return launchAgentEnabled ? 'system_service' : 'app_child'
}

function emptyCodexConfigInspection(
  path: string,
  target: SetupTargetConfig,
  health: CodexConfigHealth
): CodexConfigInspection {
  return {
    chatgptBaseUrl: null,
    hasModelProvider: false,
    health,
    openaiBaseUrl: null,
    path,
    target
  }
}

async function readProxyStatus(runtime: MainRuntime): Promise<{ status: ProxyStatus }> {
  try {
    return { status: await runtime.proxyStatus() }
  } catch (error) {
    const config = runtime.readRuntimeConfig()
    const target = setupTargetConfig(config.listenHost, config.listenPort)
    return {
      status: {
        authPoolAccounts: 0,
        authPoolAvailableAccounts: 0,
        authPoolDisabledAccounts: 0,
        authPoolEnabled: config.authPool.enabled,
        authPoolExhaustedAccounts: 0,
        endpoint: target.chatgptBaseUrl,
        lastError: error instanceof Error ? error.message : String(error),
        openaiBaseUrl: target.openaiBaseUrl,
        openaiCompatibleEndpoint: `${target.openaiBaseUrl}/v1`,
        outboundMode: config.outboundProxy.mode,
        rawCaptureDir: '',
        rawCaptureEnabled: config.rawCaptureEnabled,
        running: false,
        upstreamBaseUrl: config.upstreamBaseUrl
      }
    }
  }
}

async function readManagedAccounts(runtime: MainRuntime): Promise<ManagedAccountRow[]> {
  try {
    return runtime.managedAccounts()
  } catch {
    return []
  }
}

async function readRecentRequests(runtime: MainRuntime): Promise<RecentRequest[]> {
  try {
    return runtime.recentRequests(100).items
  } catch {
    return []
  }
}

function findTopValue(assignments: Assignment[], key: Assignment['key']): string | null {
  return assignments.find((item) => item.key === key && item.table === null)?.value ?? null
}

function parseTomlString(value: string): string | null {
  const match = /^"((?:[^"\\]|\\.)*)"/.exec(value)
  return match ? (match[1]?.replaceAll('\\"', '"').replaceAll('\\\\', '\\') ?? null) : null
}

function sameCodexPaths(
  chatgptBaseUrl: string,
  openaiBaseUrl: string,
  target: SetupTargetConfig
): boolean {
  try {
    const chatgpt = new URL(chatgptBaseUrl)
    const openai = new URL(openaiBaseUrl)
    const targetChatgpt = new URL(target.chatgptBaseUrl)
    const targetOpenai = new URL(target.openaiBaseUrl)
    return chatgpt.pathname === targetChatgpt.pathname && openai.pathname === targetOpenai.pathname
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' ? value : null
}
