import { copyFileSync, existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { app, dialog, ipcMain } from 'electron'
import { importAuthFilesToDirectory } from './auth/import'
import { checkAuthDirectoryUsage } from './auth/usage-check'
import { readRawCaptureDetail } from './proxy/raw-capture'
import type { ProxyConfig } from './proxy/types'
import type { MainRuntime } from './runtime'

export function registerMainProcessHandlers(runtime: MainRuntime): void {
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('proxy:config', () => runtime.readRuntimeConfig())
  ipcMain.handle('proxy:status', () => runtime.proxyStatus())
  ipcMain.handle('proxy:managed-auth-directory', () => runtime.importedAuthPoolPath)
  ipcMain.handle('proxy:recent-requests', async () => {
    await runtime.ensureDaemon()
    return (await runtime.daemonClient.requests()).requests
  })
  ipcMain.handle('proxy:log-events', async () => {
    await runtime.ensureDaemon()
    return (await runtime.daemonClient.logEvents()).events
  })
  ipcMain.handle('proxy:protocol-messages', async () => {
    await runtime.ensureDaemon()
    return (await runtime.daemonClient.protocolMessages()).messages
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
    const selection = await dialog.showOpenDialog({
      title: 'Import Codex account auth files',
      properties: ['openFile', 'openDirectory', 'multiSelections'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
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
    return result
  })
  ipcMain.handle('proxy:check-account-usage', async () => {
    const results = await checkAuthDirectoryUsage(runtime.importedAuthPoolPath)
    await runtime.ensureDaemon()
    const { accounts } = await runtime.daemonClient.updateAccountUsage(results)
    return { results, accounts }
  })
  ipcMain.handle('proxy:export-auth-files', async () => {
    const selection = await dialog.showOpenDialog({
      title: 'Export imported Codex account auth files',
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
  ipcMain.handle('proxy:start', async () => runtime.startDaemonProxy())
  ipcMain.handle('proxy:stop', async () => runtime.stopProxy())
  ipcMain.handle('proxy:restart', async () => runtime.restartProxy())
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
