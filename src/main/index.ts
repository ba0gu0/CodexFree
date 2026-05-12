import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import icon from '../../resources/icon.png?asset'
import { logger } from './logger'

interface UpdateCheckErrorSummary {
  name: string
  message: string
  statusCode?: number
}

function readStringProperty(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) {
    return undefined
  }

  const property = value[key as keyof typeof value]
  return typeof property === 'string' ? property : undefined
}

function readNumberProperty(value: unknown, key: string): number | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) {
    return undefined
  }

  const property = value[key as keyof typeof value]
  return typeof property === 'number' ? property : undefined
}

function summarizeUpdateCheckError(error: unknown): UpdateCheckErrorSummary {
  return {
    name:
      error instanceof Error ? error.name : (readStringProperty(error, 'name') ?? 'UnknownError'),
    message: error instanceof Error ? error.message.split('\n')[0] : 'Update check failed',
    statusCode: readNumberProperty(error, 'statusCode')
  }
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.baoguo.codexfree')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('app:version', () => app.getVersion())
  logger.info('CodexFree main process ready')
  autoUpdater.logger = null
  autoUpdater.autoDownload = false
  autoUpdater.checkForUpdates().catch((error: unknown) => {
    logger.warn('GitHub update check failed during startup', summarizeUpdateCheckError(error))
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
