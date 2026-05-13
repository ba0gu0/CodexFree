import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge } from 'electron'
import type {
  ProxyConfigDto,
  ProxyStatusDto,
  RawCaptureDetailDto,
  RecentRequestDto
} from './proxy-api'

const api = {
  getVersion: (): Promise<string> => electronAPI.ipcRenderer.invoke('app:version'),
  getProxyConfig: (): Promise<ProxyConfigDto> => electronAPI.ipcRenderer.invoke('proxy:config'),
  getProxyStatus: (): Promise<ProxyStatusDto> => electronAPI.ipcRenderer.invoke('proxy:status'),
  getRecentRequests: (): Promise<RecentRequestDto[]> =>
    electronAPI.ipcRenderer.invoke('proxy:recent-requests'),
  getRawCapture: (requestId: string): Promise<RawCaptureDetailDto | undefined> =>
    electronAPI.ipcRenderer.invoke('proxy:raw-capture', requestId),
  saveProxyConfig: (
    config: ProxyConfigDto
  ): Promise<{ config: ProxyConfigDto; status: ProxyStatusDto }> =>
    electronAPI.ipcRenderer.invoke('proxy:save-config', config),
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
