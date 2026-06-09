import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { BrowserWindow, shell } from 'electron'
import icon from '../../../resources/icon.png?asset'

export function createMainWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin'
  const mainWindow = new BrowserWindow({
    width: 1300,
    height: 800,
    minWidth: 1160,
    minHeight: 720,
    center: true,
    show: is.dev,
    ...(isMac
      ? {
          backgroundColor: '#00000000',
          titleBarStyle: 'hidden' as const,
          trafficLightPosition: { x: 18, y: 18 },
          transparent: true
        }
      : {
          backgroundColor: '#f7f8fb',
          transparent: false
        }),
    hasShadow: true,
    autoHideMenuBar: true,
    ...(isMac ? {} : { icon }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [contentSecurityPolicy()]
      }
    })
  })

  const showMainWindow = (): void => {
    if (!mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show()
    }
  }
  mainWindow.on('ready-to-show', showMainWindow)
  mainWindow.webContents.on('did-finish-load', showMainWindow)

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (isAllowedExternalUrl(details.url)) {
      shell.openExternal(details.url)
    }
    return { action: 'deny' }
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

function isAllowedExternalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:'
  } catch {
    return false
  }
}

function contentSecurityPolicy(): string {
  if (is.dev) {
    return [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*"
    ].join('; ')
  }

  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*"
  ].join('; ')
}
