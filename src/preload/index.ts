import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge } from 'electron'

const api = {
  getVersion: (): Promise<string> => electronAPI.ipcRenderer.invoke('app:version')
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
