import { type ChildProcess, spawn } from 'node:child_process'
import { join } from 'node:path'
import { app } from 'electron'
import { DaemonAdminClient } from './daemon/client'
import { resolveDaemonPaths } from './daemon/paths'
import { readOrCreateAdminToken } from './daemon/token'
import { readManagedProxyConfig, writeProxyConfig } from './proxy/config'
import type { ProxyConfig, ProxyStatus } from './proxy/types'

export interface MainRuntime {
  configPath: string
  daemonClient: DaemonAdminClient
  ensureDaemon: () => Promise<void>
  importedAuthPoolPath: string
  proxyStatus: () => Promise<ProxyStatus>
  rawCaptureDir: () => Promise<string>
  readRuntimeConfig: () => ProxyConfig
  restartProxy: () => Promise<ProxyStatus>
  saveProxyConfig: (config: ProxyConfig) => Promise<{ config: ProxyConfig; status: ProxyStatus }>
  startDaemonProxy: () => Promise<ProxyStatus>
  stopProxy: () => Promise<ProxyStatus>
}

export function createMainRuntime(): MainRuntime {
  const paths = resolveDaemonPaths({ dataDir: app.getPath('userData') })
  const configPath = paths.configPath
  const importedAuthPoolPath = paths.authPoolDir
  const daemonClient = new DaemonAdminClient({
    endpoint: 'http://127.0.0.1:44445/admin',
    token: readOrCreateAdminToken(paths.adminTokenPath)
  })
  let daemonProcess: ChildProcess | undefined
  let ensureDaemonPromise: Promise<void> | undefined
  app.once('before-quit', () => {
    daemonProcess?.kill()
  })

  const readRuntimeConfig = (): ProxyConfig =>
    readManagedProxyConfig(configPath, importedAuthPoolPath)
  const ensureDaemon = async (): Promise<void> => {
    if (ensureDaemonPromise) {
      return ensureDaemonPromise
    }
    ensureDaemonPromise = ensureDaemonUnlocked().finally(() => {
      ensureDaemonPromise = undefined
    })
    return ensureDaemonPromise
  }
  const ensureDaemonUnlocked = async (): Promise<void> => {
    if (await daemonReachable()) {
      return
    }
    if (!daemonProcess || daemonProcess.killed || daemonProcess.exitCode !== null) {
      daemonProcess = spawnDaemon(paths.dataDir)
    }
    await waitForDaemon()
  }
  const proxyStatus = async (): Promise<ProxyStatus> => {
    await ensureDaemon()
    return (await daemonClient.status()).proxy
  }
  const restartProxy = async (): Promise<ProxyStatus> => {
    await ensureDaemon()
    return (await daemonClient.restart()).proxy
  }
  const startDaemonProxy = async (): Promise<ProxyStatus> => {
    await ensureDaemon()
    const current = (await daemonClient.status()).proxy
    if (current.running) {
      return current
    }
    return (await daemonClient.start()).proxy
  }
  const stopProxy = async (): Promise<ProxyStatus> => {
    await ensureDaemon()
    return (await daemonClient.stop()).proxy
  }
  const saveProxyConfig = async (
    config: ProxyConfig
  ): Promise<{ config: ProxyConfig; status: ProxyStatus }> => {
    const saved = writeManagedConfig(config)
    await ensureDaemon()
    const updated = await daemonClient.updateConfig(saved)
    return { config: updated.config, status: updated.proxy }
  }
  const rawCaptureDir = async (): Promise<string> => (await proxyStatus()).rawCaptureDir

  return {
    configPath,
    daemonClient,
    ensureDaemon,
    importedAuthPoolPath,
    proxyStatus,
    rawCaptureDir,
    readRuntimeConfig,
    restartProxy,
    saveProxyConfig,
    startDaemonProxy,
    stopProxy
  }

  function writeManagedConfig(config: ProxyConfig): ProxyConfig {
    return writeProxyConfig(configPath, config, importedAuthPoolPath)
  }

  async function daemonReachable(): Promise<boolean> {
    return daemonClient.status().then(
      () => true,
      () => false
    )
  }

  async function waitForDaemon(): Promise<void> {
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      if (await daemonReachable()) {
        return
      }
      await delay(250)
    }
    throw new Error('CodexFree daemon did not start within 10 seconds')
  }
}

function spawnDaemon(dataDir: string): ChildProcess {
  const command = process.execPath
  const args = [daemonScriptPath(), '--data-dir', dataDir]
  const child = spawn(command, args, {
    cwd: app.isPackaged ? app.getAppPath() : process.cwd(),
    detached: false,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_NO_WARNINGS: '1' },
    stdio: 'ignore'
  })
  return child
}

function daemonScriptPath(): string {
  return app.isPackaged
    ? join(app.getAppPath(), 'out', 'daemon', 'cli.cjs')
    : join(process.cwd(), 'out', 'daemon', 'cli.cjs')
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
