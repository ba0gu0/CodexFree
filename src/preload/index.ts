import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge } from 'electron'
import type {
  AccountUsageCheckBatchDto,
  AuthExportResultDto,
  AuthImportResultDto,
  CleanExpiredAccountsDto,
  ClearProxyRecordsResultDto,
  ManagedAccountDto,
  ProtocolMessageDto,
  ProxyConfigDto,
  ProxyLogEventDto,
  ProxyStatusDto,
  RawCaptureDetailDto,
  RecentRequestDto,
  ResetExhaustedAccountsDto,
  SetAccountDisabledDto
} from './proxy-api'

const api = {
  getVersion: (): Promise<string> => electronAPI.ipcRenderer.invoke('app:version'),
  getProxyConfig: (): Promise<ProxyConfigDto> => electronAPI.ipcRenderer.invoke('proxy:config'),
  getProxyStatus: (): Promise<ProxyStatusDto> => electronAPI.ipcRenderer.invoke('proxy:status'),
  getManagedAuthDirectory: (): Promise<string> =>
    electronAPI.ipcRenderer.invoke('proxy:managed-auth-directory'),
  getRecentRequests: (): Promise<RecentRequestDto[]> =>
    electronAPI.ipcRenderer.invoke('proxy:recent-requests'),
  getManagedAccounts: (): Promise<ManagedAccountDto[]> =>
    electronAPI.ipcRenderer.invoke('proxy:accounts'),
  getProxyLogEvents: (): Promise<ProxyLogEventDto[]> =>
    electronAPI.ipcRenderer.invoke('proxy:log-events'),
  getProtocolMessages: (): Promise<ProtocolMessageDto[]> =>
    electronAPI.ipcRenderer.invoke('proxy:protocol-messages'),
  getRawCapture: (requestId: string): Promise<RawCaptureDetailDto | undefined> =>
    electronAPI.ipcRenderer.invoke('proxy:raw-capture', requestId),
  clearProxyRecords: (): Promise<ClearProxyRecordsResultDto> =>
    electronAPI.ipcRenderer.invoke('proxy:clear-records'),
  saveProxyConfig: (
    config: ProxyConfigDto
  ): Promise<{ config: ProxyConfigDto; status: ProxyStatusDto }> =>
    electronAPI.ipcRenderer.invoke('proxy:save-config', config),
  importAuthFiles: (): Promise<AuthImportResultDto> =>
    electronAPI.ipcRenderer.invoke('proxy:import-auth-files'),
  checkAccountUsage: (): Promise<AccountUsageCheckBatchDto> =>
    electronAPI.ipcRenderer.invoke('proxy:check-account-usage'),
  exportAuthFiles: (): Promise<AuthExportResultDto> =>
    electronAPI.ipcRenderer.invoke('proxy:export-auth-files'),
  resetExhaustedAccounts: (): Promise<ResetExhaustedAccountsDto> =>
    electronAPI.ipcRenderer.invoke('proxy:reset-exhausted-accounts'),
  setAccountDisabled: (accountId: string, disabled: boolean): Promise<SetAccountDisabledDto> =>
    electronAPI.ipcRenderer.invoke('proxy:set-account-disabled', accountId, disabled),
  cleanExpiredAccounts: (): Promise<CleanExpiredAccountsDto> =>
    electronAPI.ipcRenderer.invoke('proxy:clean-expired-accounts'),
  startProxy: (): Promise<ProxyStatusDto> => electronAPI.ipcRenderer.invoke('proxy:start'),
  stopProxy: (): Promise<ProxyStatusDto> => electronAPI.ipcRenderer.invoke('proxy:stop'),
  restartProxy: (): Promise<ProxyStatusDto> => electronAPI.ipcRenderer.invoke('proxy:restart')
}

type RendererWindow = Window &
  typeof globalThis & {
    electron: typeof electronAPI
    api: typeof api
  }

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    throw new Error(`Failed to expose preload API: ${String(error)}`)
  }
} else {
  const rendererWindow = window as RendererWindow
  rendererWindow.electron = electronAPI
  rendererWindow.api = api
}
