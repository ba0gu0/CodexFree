import { copyFileSync, existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { app, dialog, ipcMain, shell } from 'electron'
import { importAuthFilesToDirectory } from './auth/import'
import { writeCodexConfigFile, writePlaceholderAuthFile } from './auth/placeholder'
import { checkAuthDirectoryUsage } from './auth/usage-check'
import { readRawCaptureDetail } from './proxy/raw-capture'
import type { ProxyConfig } from './proxy/types'
import type { DaemonControlSaveInput, MainRuntime } from './runtime'

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
  ipcMain.handle('app:open-raw-capture-directory', async () =>
    openPathOrThrow(await runtime.rawCaptureDir())
  )
  ipcMain.handle('app:open-work-directory', () => openPathOrThrow(process.cwd()))
  ipcMain.handle('proxy:recent-requests', async (_, limit: unknown) => {
    await runtime.ensureDaemon()
    const page = await runtime.daemonClient.requests(normalizeActivityLimit(limit))
    return { hasMore: page.hasMore, items: page.requests }
  })
  ipcMain.handle('proxy:log-events', async (_, limit: unknown) => {
    await runtime.ensureDaemon()
    const page = await runtime.daemonClient.logEvents(normalizeActivityLimit(limit))
    return { hasMore: page.hasMore, items: page.events }
  })
  ipcMain.handle('proxy:protocol-messages', async (_, limit: unknown) => {
    await runtime.ensureDaemon()
    const page = await runtime.daemonClient.protocolMessages(normalizeActivityLimit(limit))
    return { hasMore: page.hasMore, items: page.messages }
  })
  ipcMain.handle('proxy:accounts', async () => {
    await runtime.ensureDaemon()
    return (await runtime.daemonClient.accounts()).accounts
  })
  ipcMain.handle('proxy:raw-capture', async (_, requestId: string) =>
    readRawCaptureDetail(await runtime.rawCaptureDir(), requestId)
  )
  ipcMain.handle('proxy:clear-records', async () => {
    await runtime.ensureDaemon()
    return runtime.daemonClient.clearRecords()
  })
  ipcMain.handle('proxy:import-auth-files', async () => {
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

    const result = importAuthFilesToDirectory(selection.filePaths, runtime.importedAuthPoolPath)
    await runtime.restartProxy()
    await runtime.daemonClient.syncAccounts(result.accounts)
    const usageResults = await checkAuthDirectoryUsage(runtime.importedAuthPoolPath)
    await runtime.daemonClient.updateAccountUsage(usageResults)
    await runtime.restartProxy()
    return result
  })
  ipcMain.handle('proxy:check-account-usage', async () => {
    const results = await checkAuthDirectoryUsage(runtime.importedAuthPoolPath)
    await runtime.ensureDaemon()
    const { accounts } = await runtime.daemonClient.updateAccountUsage(results)
    return { results, accounts }
  })
  ipcMain.handle('proxy:check-selected-account-usage', async (_, accountIds: string[]) => {
    const results = await checkAuthDirectoryUsage(runtime.importedAuthPoolPath, accountIds)
    await runtime.ensureDaemon()
    const { accounts } = await runtime.daemonClient.updateAccountUsage(results)
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
    const status = await runtime.proxyStatus()
    return writeCodexConfigFile({
      chatgptBaseUrl: status.endpoint,
      openaiBaseUrl: status.openaiBaseUrl
    })
  })
  ipcMain.handle('proxy:reset-exhausted-accounts', async () => {
    await runtime.ensureDaemon()
    const { accounts, resetAccounts } = await runtime.daemonClient.resetExhaustedAccounts()
    const status = await runtime.restartProxy()
    return { resetAccounts, accounts, status }
  })
  ipcMain.handle('proxy:set-account-disabled', async (_, accountId: string, disabled: boolean) => {
    await runtime.ensureDaemon()
    const { accounts, updatedAccounts } = await runtime.daemonClient.setAccountDisabled(
      accountId,
      disabled
    )
    const status = await runtime.restartProxy()
    return { updatedAccounts, accounts, status }
  })
  ipcMain.handle(
    'proxy:set-accounts-disabled',
    async (_, accountIds: string[], disabled: boolean) => {
      await runtime.ensureDaemon()
      let accounts = (await runtime.daemonClient.accounts()).accounts
      let updatedAccounts = 0
      for (const accountId of accountIds) {
        const result = await runtime.daemonClient.setAccountDisabled(accountId, disabled)
        accounts = result.accounts
        updatedAccounts += result.updatedAccounts
      }
      const status = await runtime.restartProxy()
      return { updatedAccounts, accounts, status }
    }
  )
  ipcMain.handle('proxy:delete-accounts', async (_, accountIds: string[]) => {
    await runtime.ensureDaemon()
    const deleted = await runtime.daemonClient.deleteAccounts(accountIds)
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
    const status = await runtime.restartProxy()
    return { ...deleted, status }
  })
  ipcMain.handle('proxy:clean-expired-accounts', async () => {
    await runtime.ensureDaemon()
    const currentAccounts = (await runtime.daemonClient.accounts()).accounts
    const expiredAccountIds = currentAccounts
      .filter((account) => account.lastUsageError?.includes('401'))
      .map((account) => account.accountId)
    const deleted = await runtime.daemonClient.deleteAccounts(expiredAccountIds)
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

    return { deletedAccounts: deleted.deletedAccounts, deletedFiles, accounts: deleted.accounts }
  })
  ipcMain.handle('proxy:save-config', async (_, config: ProxyConfig) => {
    return runtime.saveProxyConfig(config)
  })
  ipcMain.handle('proxy:save-daemon-control-settings', async (_, input: DaemonControlSaveInput) => {
    return runtime.saveDaemonControlSettings(input)
  })
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
