import { copyFileSync, existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, dialog, ipcMain, shell } from 'electron'
import { importAuthFilesToDirectory, readImportedAuthAccounts } from './auth/import'
import { writeCodexConfigFile, writePlaceholderAuthFile } from './auth/placeholder'
import { checkAuthDirectoryUsage } from './auth/usage-check'
import { clearRawCaptures, readRawCaptureDetail } from './proxy/raw-capture'
import type { ProxyConfig } from './proxy/types'
import type { DaemonControlSaveInput, MainRuntime } from './runtime'
import { readSetupAssistantState, renameCodexAuthForRelogin } from './setup-assistant'

const CONSOLE_ACTIVITY_DEFAULT_LIMIT = 160
const CONSOLE_ACTIVITY_MAX_LIMIT = 1_000

type AppLocale = 'zh-CN' | 'en'

interface DialogCopy {
  exportTitle: string
  importTitle: string
  jsonFilterName: string
}

const dialogCopyByLocale: Record<AppLocale, DialogCopy> = {
  'zh-CN': {
    exportTitle: '导出已导入的 Codex 账户授权文件',
    importTitle: '导入 Codex 账户授权文件',
    jsonFilterName: 'JSON 文件'
  },
  en: {
    exportTitle: 'Export imported Codex account auth files',
    importTitle: 'Import Codex account auth files',
    jsonFilterName: 'JSON files'
  }
}

export function registerMainProcessHandlers(runtime: MainRuntime): void {
  let appLocale: AppLocale = 'zh-CN'
  const currentDialogCopy = (): DialogCopy => dialogCopyByLocale[appLocale]

  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:set-locale', (_, locale: unknown) => {
    appLocale = resolveAppLocale(locale)
  })
  ipcMain.handle('proxy:config', () => runtime.readRuntimeConfig())
  ipcMain.handle('proxy:status', () => runtime.proxyStatus())
  ipcMain.handle('proxy:daemon-control-settings', () => runtime.readDaemonControlSettings())
  ipcMain.handle('proxy:managed-auth-directory', () => runtime.importedAuthPoolPath)
  ipcMain.handle('app:open-managed-auth-directory', () =>
    openPathOrThrow(runtime.importedAuthPoolPath)
  )
  ipcMain.handle('app:open-codex-directory', () => openPathOrThrow(join(homedir(), '.codex')))
  ipcMain.handle('app:open-raw-capture-directory', async () =>
    openPathOrThrow(await runtime.rawCaptureDir())
  )
  ipcMain.handle('app:open-work-directory', () => openPathOrThrow(process.cwd()))
  ipcMain.handle('proxy:recent-requests', async (_, limit: unknown) => {
    const page = runtime.recentRequests(normalizeActivityLimit(limit))
    return { hasMore: page.hasMore, items: page.items }
  })
  ipcMain.handle('proxy:log-events', async (_, limit: unknown) => {
    const page = runtime.logEvents(normalizeActivityLimit(limit))
    return { hasMore: page.hasMore, items: page.items }
  })
  ipcMain.handle('proxy:protocol-messages', async (_, limit: unknown) => {
    const page = runtime.protocolMessages(normalizeActivityLimit(limit))
    return { hasMore: page.hasMore, items: page.items }
  })
  ipcMain.handle('proxy:turn-summaries', async (_, limit: unknown) => {
    const page = runtime.turnSummaries(normalizeActivityLimit(limit))
    return { hasMore: page.hasMore, items: page.items }
  })
  ipcMain.handle('proxy:accounts', () => runtime.managedAccounts())
  ipcMain.handle('proxy:request-summary', async () => {
    return runtime.requestSummary()
  })
  ipcMain.handle('proxy:usage-summary', async () => {
    return runtime.usageSummary()
  })
  ipcMain.handle('proxy:raw-capture', async (_, requestId: string) =>
    readRawCaptureDetail(await runtime.rawCaptureDir(), requestId)
  )
  ipcMain.handle('proxy:clear-records', async () => {
    const result = runtime.clearRecords()
    const { deletedEntries } = clearRawCaptures(await runtime.rawCaptureDir())
    return { deletedCaptureEntries: deletedEntries, deletedRequests: result.deletedRequests }
  })
  ipcMain.handle('proxy:import-auth-files', async (event) => {
    const dialogCopy = currentDialogCopy()
    const selection = await dialog.showOpenDialog({
      title: dialogCopy.importTitle,
      properties: ['openFile', 'openDirectory', 'multiSelections'],
      filters: [{ name: dialogCopy.jsonFilterName, extensions: ['json'] }]
    })
    if (selection.canceled) {
      return {
        imported: 0,
        skipped: 0,
        directory: runtime.importedAuthPoolPath,
        accounts: [],
        errors: []
      }
    }

    const result = await importAuthFilesToDirectory(
      selection.filePaths,
      runtime.importedAuthPoolPath
    )
    runtime.syncAccounts(readImportedAuthAccounts(runtime.importedAuthPoolPath))
    const importedAccountIds = uniqueAccountIds(result.accounts.map((account) => account.accountId))
    if (importedAccountIds.length > 0) {
      const usageResults = await checkAuthDirectoryUsage(runtime.importedAuthPoolPath, {
        accountIds: importedAccountIds,
        onProgress: (progress) => {
          event.sender.send('proxy:account-usage-progress', progress)
        }
      })
      runtime.updateAccountUsage(usageResults)
    }
    return result
  })
  ipcMain.handle('proxy:check-account-usage', async (event) => {
    const results = await checkAuthDirectoryUsage(runtime.importedAuthPoolPath, {
      onProgress: (progress) => {
        event.sender.send('proxy:account-usage-progress', progress)
      }
    })
    const accounts = runtime.updateAccountUsage(results)
    return { results, accounts }
  })
  ipcMain.handle('proxy:check-selected-account-usage', async (event, accountIds: string[]) => {
    const results = await checkAuthDirectoryUsage(runtime.importedAuthPoolPath, {
      accountIds,
      onProgress: (progress) => event.sender.send('proxy:account-usage-progress', progress)
    })
    const accounts = runtime.updateAccountUsage(results)
    return { results, accounts }
  })
  ipcMain.handle('proxy:export-auth-files', async () => {
    const dialogCopy = currentDialogCopy()
    const selection = await dialog.showOpenDialog({
      title: dialogCopy.exportTitle,
      properties: ['openDirectory', 'createDirectory']
    })
    if (selection.canceled || selection.filePaths[0] === undefined) {
      return { exported: 0 }
    }

    let exported = 0
    if (existsSync(runtime.importedAuthPoolPath)) {
      for (const entry of readdirSync(runtime.importedAuthPoolPath, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) {
          continue
        }
        copyFileSync(
          join(runtime.importedAuthPoolPath, entry.name),
          join(selection.filePaths[0], entry.name)
        )
        exported += 1
      }
    }

    return { exported }
  })
  ipcMain.handle('proxy:write-placeholder-auth', () => writePlaceholderAuthFile())
  ipcMain.handle('proxy:write-codex-config', async () => {
    const config = runtime.readRuntimeConfig()
    const endpoint = `http://${config.listenHost}:${config.listenPort}/backend-api`
    return writeCodexConfigFile({
      chatgptBaseUrl: endpoint,
      openaiBaseUrl: `${endpoint}/codex`
    })
  })
  ipcMain.handle('setup:state', () => readSetupAssistantState(runtime))
  ipcMain.handle('setup:rename-codex-auth', () => renameCodexAuthForRelogin())
  ipcMain.handle('proxy:reset-exhausted-accounts', async () => {
    const { accounts, resetAccounts } = runtime.resetExhaustedAccounts()
    return { resetAccounts, accounts, status: await runtime.proxyStatus() }
  })
  ipcMain.handle('proxy:set-account-disabled', async (_, accountId: string, disabled: boolean) => {
    const { accounts, updatedAccounts } = runtime.setAccountDisabled(accountId, disabled)
    return { updatedAccounts, accounts, status: await runtime.proxyStatus() }
  })
  ipcMain.handle('proxy:switch-account', async (_, accountId: string) => {
    if (!accountId) {
      throw new Error('accountId is required to switch the current account')
    }
    await runtime.daemonClient.status().catch((error: unknown) => {
      throw new Error(daemonAdminUnavailableMessage(appLocale, error))
    })
    const { accounts, result } = await runtime.daemonClient.switchAccount(accountId)
    return { accounts, result, status: (await runtime.daemonClient.status()).proxy }
  })
  ipcMain.handle(
    'proxy:set-accounts-disabled',
    async (_, accountIds: string[], disabled: boolean) => {
      let accounts = runtime.managedAccounts()
      let status = await runtime.proxyStatus()
      let updatedAccounts = 0
      for (const accountId of accountIds) {
        const result = runtime.setAccountDisabled(accountId, disabled)
        accounts = result.accounts
        updatedAccounts += result.updatedAccounts
      }
      status = await runtime.proxyStatus()
      return { updatedAccounts, accounts, status }
    }
  )
  ipcMain.handle('proxy:delete-accounts', async (_, accountIds: string[]) => {
    if (existsSync(runtime.importedAuthPoolPath)) {
      for (const entry of readdirSync(runtime.importedAuthPoolPath, { withFileTypes: true })) {
        if (!entry.isFile()) {
          continue
        }
        const filePath = join(runtime.importedAuthPoolPath, entry.name)
        const fileAccountId = readAuthAccountId(filePath)
        if (fileAccountId && accountIds.includes(fileAccountId)) {
          unlinkSync(filePath)
        }
      }
    }
    const deleted = runtime.deleteAccounts(accountIds)
    return { ...deleted, status: await runtime.proxyStatus() }
  })
  ipcMain.handle('proxy:clean-expired-accounts', async () => {
    const currentAccounts = runtime.managedAccounts()
    const expiredAccountIds = currentAccounts
      .filter((account) => account.lastUsageError?.includes('401'))
      .map((account) => account.accountId)
    let deletedFiles = 0

    if (existsSync(runtime.importedAuthPoolPath)) {
      for (const entry of readdirSync(runtime.importedAuthPoolPath, { withFileTypes: true })) {
        if (!entry.isFile()) {
          continue
        }
        const fileAccountId = readAuthAccountId(join(runtime.importedAuthPoolPath, entry.name))
        if (fileAccountId && expiredAccountIds.includes(fileAccountId)) {
          unlinkSync(join(runtime.importedAuthPoolPath, entry.name))
          deletedFiles += 1
        }
      }
    }

    const deleted = runtime.deleteAccounts(expiredAccountIds)
    return { deletedAccounts: deleted.deletedAccounts, deletedFiles, accounts: deleted.accounts }
  })
  ipcMain.handle('proxy:save-config', async (_, config: ProxyConfig) => {
    return runtime.saveProxyConfig(config)
  })
  ipcMain.handle('proxy:save-daemon-control-settings', async (_, input: DaemonControlSaveInput) => {
    return runtime.saveDaemonControlSettings(input)
  })
  ipcMain.handle(
    'proxy:save-proxy-page-config',
    async (_, config: ProxyConfig, input: DaemonControlSaveInput) => {
      return runtime.saveProxyPageConfig(config, input)
    }
  )
  ipcMain.handle('proxy:start', async () => runtime.startDaemonProxy())
  ipcMain.handle('proxy:stop', async () => runtime.stopProxy())
  ipcMain.handle('proxy:restart', async () => runtime.restartProxy())
}

function normalizeActivityLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return CONSOLE_ACTIVITY_DEFAULT_LIMIT
  }
  return Math.max(1, Math.min(CONSOLE_ACTIVITY_MAX_LIMIT, Math.floor(value)))
}

function resolveAppLocale(value: unknown): AppLocale {
  return typeof value === 'string' && value.toLowerCase().startsWith('en') ? 'en' : 'zh-CN'
}

function uniqueAccountIds(accountIds: string[]): string[] {
  return [...new Set(accountIds)]
}

function daemonAdminUnavailableMessage(locale: AppLocale, error: unknown): string {
  const detail = errorMessage(error)
  if (locale === 'en') {
    return `Daemon admin interface is unavailable. Start the proxy service and retry. ${detail}`
  }
  return `Daemon admin 接口未启动，请先启动代理服务后重试。${detail}`
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String(error.message)
  }
  return String(error)
}

async function openPathOrThrow(path: string): Promise<void> {
  const error = await shell.openPath(path)
  if (error) {
    throw new Error(`Failed to open local path "${path}": ${error}`)
  }
}

function readAuthAccountId(path: string): string | undefined {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return undefined
    }
    const tokens = (value as { tokens?: unknown }).tokens
    if (typeof tokens !== 'object' || tokens === null || Array.isArray(tokens)) {
      return undefined
    }
    const accountId = (tokens as { account_id?: unknown }).account_id
    return typeof accountId === 'string' ? accountId : undefined
  } catch {
    return undefined
  }
}
