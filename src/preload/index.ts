import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron'
import type {
  AccountUsageCheckBatchDto,
  AccountUsageCheckProgressDto,
  ActivityPageDto,
  AppUpdateStatusDto,
  AuthExportResultDto,
  AuthImportResultDto,
  CleanExpiredAccountsDto,
  ClearProxyRecordsResultDto,
  CodexAuthRestoreResultDto,
  CodexAuthWriteResultDto,
  CodexConfigBackupRestoreResultDto,
  CodexConfigWriteResultDto,
  CodexSessionProviderRepairResultDto,
  DaemonControlSaveInputDto,
  DaemonControlSaveResultDto,
  DaemonControlSettingsDto,
  ManagedAccountDto,
  PlaceholderAuthResultDto,
  ProtocolMessageDto,
  ProxyConfigDto,
  ProxyLogEventDto,
  ProxyPageSaveResultDto,
  ProxyStatusDto,
  RawCaptureDetailDto,
  RecentRequestDto,
  RequestSummaryDto,
  ResetExhaustedAccountsDto,
  SetAccountDisabledDto,
  SetupAssistantStateDto,
  SwitchAccountDto,
  TurnSummaryDto,
  UsageSummaryDto
} from './proxy-api'

const electronBridge = {
  ipcRenderer: {
    invoke: <T>(channel: string, ...args: unknown[]): Promise<T> =>
      ipcRenderer.invoke(channel, ...args)
  }
}

const api = {
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  getUpdateStatus: (): Promise<AppUpdateStatusDto> => ipcRenderer.invoke('app:update-status'),
  checkForUpdate: (): Promise<AppUpdateStatusDto> => ipcRenderer.invoke('app:check-update'),
  downloadUpdate: (): Promise<AppUpdateStatusDto> => ipcRenderer.invoke('app:download-update'),
  applyUpdate: (): Promise<AppUpdateStatusDto> => ipcRenderer.invoke('app:apply-update'),
  openReleasePage: (): Promise<void> => ipcRenderer.invoke('app:open-release-page'),
  onUpdateStatusChanged: (listener: (status: AppUpdateStatusDto) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, status: AppUpdateStatusDto) => {
      listener(status)
    }
    ipcRenderer.on('app:update-status-changed', handler)
    return () => ipcRenderer.off('app:update-status-changed', handler)
  },
  setLocale: async (locale: string): Promise<void> => {
    try {
      await ipcRenderer.invoke('app:set-locale', locale)
    } catch (error) {
      if (isMissingLocaleHandlerError(error)) {
        return
      }
      throw new Error(`Failed to synchronize locale with the main process: ${String(error)}`)
    }
  },
  getProxyConfig: (): Promise<ProxyConfigDto> => ipcRenderer.invoke('proxy:config'),
  getProxyStatus: (): Promise<ProxyStatusDto> => ipcRenderer.invoke('proxy:status'),
  getDaemonControlSettings: (): Promise<DaemonControlSettingsDto> =>
    ipcRenderer.invoke('proxy:daemon-control-settings'),
  getManagedAuthDirectory: (): Promise<string> =>
    ipcRenderer.invoke('proxy:managed-auth-directory'),
  openManagedAuthDirectory: (): Promise<void> =>
    ipcRenderer.invoke('app:open-managed-auth-directory'),
  openCodexDirectory: (): Promise<void> => ipcRenderer.invoke('app:open-codex-directory'),
  openRawCaptureDirectory: (): Promise<void> =>
    ipcRenderer.invoke('app:open-raw-capture-directory'),
  openWorkDirectory: (): Promise<void> => ipcRenderer.invoke('app:open-work-directory'),
  getRecentRequests: (limit?: number): Promise<ActivityPageDto<RecentRequestDto>> =>
    ipcRenderer.invoke('proxy:recent-requests', limit),
  getManagedAccounts: (): Promise<ManagedAccountDto[]> => ipcRenderer.invoke('proxy:accounts'),
  getRequestSummary: (): Promise<RequestSummaryDto> => ipcRenderer.invoke('proxy:request-summary'),
  getUsageSummary: (): Promise<UsageSummaryDto> => ipcRenderer.invoke('proxy:usage-summary'),
  getProxyLogEvents: (limit?: number): Promise<ActivityPageDto<ProxyLogEventDto>> =>
    ipcRenderer.invoke('proxy:log-events', limit),
  getProtocolMessages: (limit?: number): Promise<ActivityPageDto<ProtocolMessageDto>> =>
    ipcRenderer.invoke('proxy:protocol-messages', limit),
  getTurnSummaries: (limit?: number): Promise<ActivityPageDto<TurnSummaryDto>> =>
    ipcRenderer.invoke('proxy:turn-summaries', limit),
  getRawCapture: (requestId: string): Promise<RawCaptureDetailDto | undefined> =>
    ipcRenderer.invoke('proxy:raw-capture', requestId),
  clearProxyRecords: (): Promise<ClearProxyRecordsResultDto> =>
    ipcRenderer.invoke('proxy:clear-records'),
  saveProxyConfig: (
    config: ProxyConfigDto
  ): Promise<{ config: ProxyConfigDto; status: ProxyStatusDto }> =>
    ipcRenderer.invoke('proxy:save-config', config),
  saveDaemonControlSettings: (
    input: DaemonControlSaveInputDto
  ): Promise<DaemonControlSaveResultDto> =>
    ipcRenderer.invoke('proxy:save-daemon-control-settings', input),
  saveProxyPageConfig: (
    config: ProxyConfigDto,
    input: DaemonControlSaveInputDto
  ): Promise<ProxyPageSaveResultDto> =>
    ipcRenderer.invoke('proxy:save-proxy-page-config', config, input),
  importAuthFiles: (): Promise<AuthImportResultDto> =>
    ipcRenderer.invoke('proxy:import-auth-files'),
  checkAccountUsage: (): Promise<AccountUsageCheckBatchDto> =>
    ipcRenderer.invoke('proxy:check-account-usage'),
  checkSelectedAccountUsage: (accountIds: string[]): Promise<AccountUsageCheckBatchDto> =>
    ipcRenderer.invoke('proxy:check-selected-account-usage', accountIds),
  onAccountUsageProgress: (
    listener: (progress: AccountUsageCheckProgressDto) => void
  ): (() => void) => {
    const handler = (_event: IpcRendererEvent, progress: AccountUsageCheckProgressDto) => {
      listener(progress)
    }
    ipcRenderer.on('proxy:account-usage-progress', handler)
    return () => ipcRenderer.off('proxy:account-usage-progress', handler)
  },
  exportAuthFiles: (): Promise<AuthExportResultDto> =>
    ipcRenderer.invoke('proxy:export-auth-files'),
  writePlaceholderAuth: (): Promise<PlaceholderAuthResultDto> =>
    ipcRenderer.invoke('proxy:write-placeholder-auth'),
  writeCodexConfig: (): Promise<CodexConfigWriteResultDto> =>
    ipcRenderer.invoke('proxy:write-codex-config'),
  listCodexConfigBackups: (): Promise<string[]> =>
    ipcRenderer.invoke('proxy:list-codex-config-backups'),
  restoreCodexConfigBackup: (backupFileName: string): Promise<CodexConfigBackupRestoreResultDto> =>
    ipcRenderer.invoke('proxy:restore-codex-config-backup', backupFileName),
  repairCodexSessionProvider: (): Promise<CodexSessionProviderRepairResultDto> =>
    ipcRenderer.invoke('proxy:repair-codex-session-provider'),
  getSetupAssistantState: (): Promise<SetupAssistantStateDto> => ipcRenderer.invoke('setup:state'),
  renameCodexAuthForRelogin: (): Promise<SetupAssistantStateDto['auth']> =>
    ipcRenderer.invoke('setup:rename-codex-auth'),
  listCodexAuthBackups: (): Promise<string[]> =>
    ipcRenderer.invoke('setup:list-codex-auth-backups'),
  restoreCodexAuthBackup: (backupFileName: string): Promise<CodexAuthRestoreResultDto> =>
    ipcRenderer.invoke('setup:restore-codex-auth-backup', backupFileName),
  writeImportedAccountToCodexAuth: (accountId: string): Promise<CodexAuthWriteResultDto> =>
    ipcRenderer.invoke('setup:write-imported-auth', accountId),
  resetExhaustedAccounts: (): Promise<ResetExhaustedAccountsDto> =>
    ipcRenderer.invoke('proxy:reset-exhausted-accounts'),
  setAccountDisabled: (accountId: string, disabled: boolean): Promise<SetAccountDisabledDto> =>
    ipcRenderer.invoke('proxy:set-account-disabled', accountId, disabled),
  setAccountsDisabled: (accountIds: string[], disabled: boolean): Promise<SetAccountDisabledDto> =>
    ipcRenderer.invoke('proxy:set-accounts-disabled', accountIds, disabled),
  setCurrentAccount: (accountId: string): Promise<SwitchAccountDto> =>
    ipcRenderer.invoke('proxy:switch-account', accountId),
  deleteAccounts: (
    accountIds: string[]
  ): Promise<{ accounts: ManagedAccountDto[]; deletedAccounts: number; status: ProxyStatusDto }> =>
    ipcRenderer.invoke('proxy:delete-accounts', accountIds),
  cleanExpiredAccounts: (): Promise<CleanExpiredAccountsDto> =>
    ipcRenderer.invoke('proxy:clean-expired-accounts'),
  startProxy: (): Promise<ProxyStatusDto> => ipcRenderer.invoke('proxy:start'),
  stopProxy: (): Promise<ProxyStatusDto> => ipcRenderer.invoke('proxy:stop'),
  restartProxy: (): Promise<ProxyStatusDto> => ipcRenderer.invoke('proxy:restart')
}

function isMissingLocaleHandlerError(error: unknown): boolean {
  const message = errorMessage(error)
  return message.includes('app:set-locale') && message.includes('No handler registered')
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = error.message
    return typeof message === 'string' ? message : String(message)
  }
  return String(error)
}

type RendererWindow = Window &
  typeof globalThis & {
    electron: typeof electronBridge
    api: typeof api
  }

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronBridge)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    throw new Error(`Failed to expose preload API: ${String(error)}`)
  }
} else {
  const rendererWindow = window as RendererWindow
  rendererWindow.electron = electronBridge
  rendererWindow.api = api
}
