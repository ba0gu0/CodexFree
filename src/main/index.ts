import { electronApp, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, Menu } from 'electron'
import { registerMainProcessHandlers } from './app-ipc'
import { checkForAppUpdates } from './bootstrap/updater'
import { createMainWindow } from './bootstrap/window'
import { logger } from './logger'
import { createMainRuntime } from './runtime'

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.baoguo.codexfree')
  Menu.setApplicationMenu(null)
  const runtime = createMainRuntime()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerMainProcessHandlers(runtime)
  logger.info('CodexFree main process ready')
  runtime.ensureDaemon().catch((error: unknown) => {
    logger.error('CodexFree daemon failed during startup', {
      error: error instanceof Error ? error.message : String(error)
    })
  })

  checkForAppUpdates()
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
