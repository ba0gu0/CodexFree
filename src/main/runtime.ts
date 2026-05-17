import { type ChildProcess, spawn } from 'node:child_process'
import { join } from 'node:path'
import { app } from 'electron'
import { DaemonAdminClient } from './daemon/client'
import {
  type DaemonControlConfig,
  type DaemonControlUpdateInput,
  daemonAdminEndpoint,
  readDaemonControlConfig,
  readDaemonControlSettings,
  updateDaemonControlConfig
} from './daemon/control-config'
import {
  type DaemonLaunchAgentSettings,
  readDaemonLaunchAgentSettings,
  setDaemonLaunchAgentEnabled
} from './daemon/launch-agent'
import { resolveDaemonPaths } from './daemon/paths'
import { readManagedProxyConfig, writeProxyConfig } from './proxy/config'
import type { ProxyConfig, ProxyStatus } from './proxy/types'

export interface DaemonControlView {
  adminHost: string
  adminPort: number
  launchAgent: DaemonLaunchAgentSettings
}

export interface DaemonControlSaveInput extends DaemonControlUpdateInput {
  launchAgentEnabled?: boolean
}

export interface MainRuntime {
  daemonClient: DaemonAdminClient
  ensureDaemon: () => Promise<void>
  importedAuthPoolPath: string
  readDaemonControlSettings: () => DaemonControlView
  proxyStatus: () => Promise<ProxyStatus>
  rawCaptureDir: () => Promise<string>
  readRuntimeConfig: () => ProxyConfig
  saveDaemonControlSettings: (
    input: DaemonControlSaveInput
  ) => Promise<{ proxy?: ProxyStatus; restarted: boolean; settings: DaemonControlView }>
  restartProxy: () => Promise<ProxyStatus>
  saveProxyConfig: (config: ProxyConfig) => Promise<{ config: ProxyConfig; status: ProxyStatus }>
  startDaemonProxy: () => Promise<ProxyStatus>
  stopProxy: () => Promise<ProxyStatus>
}

export function createMainRuntime(): MainRuntime {
  const paths = resolveDaemonPaths({ dataDir: app.getPath('userData') })
  const importedAuthPoolPath = paths.authPoolDir
  let daemonControl = readDaemonControlConfig(paths.databasePath)
  let daemonClient = createDaemonClient(daemonControl)
  let daemonProcess: ChildProcess | undefined
  let ensureDaemonPromise: Promise<void> | undefined
  app.once('before-quit', () => {
    daemonProcess?.kill()
  })

  const readRuntimeConfig = (): ProxyConfig =>
    readManagedProxyConfig(paths.databasePath, importedAuthPoolPath)
  const readDaemonControl = (): DaemonControlView => ({
    ...readDaemonControlSettings(paths.databasePath),
    launchAgent: readDaemonLaunchAgentSettings(launchAgentOptions())
  })
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
  const saveDaemonControlSettings = async (
    input: DaemonControlSaveInput
  ): Promise<{ proxy?: ProxyStatus; restarted: boolean; settings: DaemonControlView }> => {
    const wasReachable = await daemonReachable()
    const previousDaemonProcess = daemonProcess
    const update = updateDaemonControlConfig(paths.databasePath, input)
    daemonControl = update.config
    daemonClient = createDaemonClient(daemonControl)
    ensureDaemonPromise = undefined

    const launchAgent =
      typeof input.launchAgentEnabled === 'boolean'
        ? setDaemonLaunchAgentEnabled(launchAgentOptions(), input.launchAgentEnabled)
        : readDaemonLaunchAgentSettings(launchAgentOptions())

    if (update.changed && previousDaemonProcess && isChildProcessRunning(previousDaemonProcess)) {
      await stopOwnedDaemon(previousDaemonProcess)
      if (daemonProcess === previousDaemonProcess) {
        daemonProcess = undefined
      }
    }

    const shouldReconnect = update.changed && (wasReachable || Boolean(previousDaemonProcess))
    if (!shouldReconnect) {
      return {
        restarted: false,
        settings: { ...update.settings, launchAgent }
      }
    }

    await ensureDaemon()
    return {
      proxy: (await daemonClient.status()).proxy,
      restarted: true,
      settings: { ...update.settings, launchAgent }
    }
  }

  return {
    get daemonClient() {
      return daemonClient
    },
    ensureDaemon,
    importedAuthPoolPath,
    readDaemonControlSettings: readDaemonControl,
    proxyStatus,
    rawCaptureDir,
    readRuntimeConfig,
    saveDaemonControlSettings,
    restartProxy,
    saveProxyConfig,
    startDaemonProxy,
    stopProxy
  }

  function writeManagedConfig(config: ProxyConfig): ProxyConfig {
    return writeProxyConfig(paths.databasePath, config, importedAuthPoolPath)
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

  function launchAgentOptions() {
    return {
      commandPath: process.execPath,
      dataDir: paths.dataDir,
      scriptPath: daemonScriptPath(),
      workingDirectory: app.isPackaged ? app.getAppPath() : process.cwd()
    }
  }
}

function createDaemonClient(control: DaemonControlConfig): DaemonAdminClient {
  return new DaemonAdminClient({
    endpoint: daemonAdminEndpoint(control),
    token: control.adminToken
  })
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

function isChildProcessRunning(child: ChildProcess): boolean {
  return !child.killed && child.exitCode === null && child.signalCode === null
}

async function stopOwnedDaemon(child: ChildProcess): Promise<void> {
  child.kill()
  const exited = await waitForProcessExit(child, 5_000)
  if (!exited && isChildProcessRunning(child)) {
    child.kill('SIGKILL')
    await waitForProcessExit(child, 2_000)
  }
}

function waitForProcessExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (!isChildProcessRunning(child)) {
    return Promise.resolve(true)
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off('exit', onExit)
      resolve(false)
    }, timeoutMs)
    const onExit = (): void => {
      clearTimeout(timer)
      resolve(true)
    }
    child.once('exit', onExit)
  })
}
