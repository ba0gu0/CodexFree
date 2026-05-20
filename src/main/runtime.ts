import { type ChildProcess, spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
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
  restartDaemonLaunchAgent,
  setDaemonLaunchAgentEnabled,
  startDaemonLaunchAgent,
  stopDaemonLaunchAgent
} from './daemon/launch-agent'
import { resolveDaemonPaths } from './daemon/paths'
import { readManagedProxyConfig, writeProxyConfig } from './proxy/config'
import { readRequestSummary, readUsageSummary } from './proxy/ledger-summary'
import type { ProxyConfig, ProxyStatus, RequestSummary, UsageSummary } from './proxy/types'

export interface DaemonControlView {
  adminHost: string
  adminPort: number
  launchAgent: DaemonLaunchAgentSettings
}
export type DaemonControlSaveInput = DaemonControlUpdateInput

export interface MainRuntime {
  daemonClient: DaemonAdminClient
  ensureDaemon: () => Promise<void>
  importedAuthPoolPath: string
  readDaemonControlSettings: () => DaemonControlView
  proxyStatus: () => Promise<ProxyStatus>
  rawCaptureDir: () => Promise<string>
  readRuntimeConfig: () => ProxyConfig
  requestSummary: () => RequestSummary
  saveDaemonControlSettings: (
    input: DaemonControlSaveInput
  ) => Promise<{ proxy?: ProxyStatus; restarted: boolean; settings: DaemonControlView }>
  restartProxy: () => Promise<ProxyStatus>
  saveProxyConfig: (config: ProxyConfig) => Promise<{ config: ProxyConfig; status: ProxyStatus }>
  saveProxyPageConfig: (
    config: ProxyConfig,
    input: DaemonControlSaveInput
  ) => Promise<{ config: ProxyConfig; status: ProxyStatus }>
  startDaemonProxy: () => Promise<ProxyStatus>
  stopProxy: () => Promise<ProxyStatus>
  usageSummary: () => UsageSummary
}

export function createMainRuntime(): MainRuntime {
  const paths = resolveDaemonPaths({ dataDir: app.getPath('userData') })
  const importedAuthPoolPath = paths.authPoolDir
  let daemonControl = readDaemonControlConfig(paths.databasePath)
  let daemonClient = createDaemonClient(daemonControl)
  let daemonProcess: ChildProcess | undefined
  let ensureDaemonPromise: Promise<void> | undefined
  let appAutoStartEnabled = true
  app.once('before-quit', () => {
    daemonProcess?.kill()
  })

  const readRuntimeConfig = (): ProxyConfig =>
    readManagedProxyConfig(paths.databasePath, importedAuthPoolPath)
  const readDaemonControl = (): DaemonControlView => {
    const settings = readDaemonControlSettings(paths.databasePath)
    return {
      adminHost: settings.adminHost,
      adminPort: settings.adminPort,
      launchAgent: readLaunchAgentSettings(settings.launchAgentEnabled)
    }
  }
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
    const targetConfig = readRuntimeConfig()
    const launchAgent = readLaunchAgentSettings()
    if (await daemonMatchesConfig(targetConfig)) {
      return
    }
    if (!appAutoStartEnabled) {
      throw new Error('CodexFree daemon is stopped by the app control')
    }
    if (launchAgent.enabled) {
      setDaemonLaunchAgentEnabled(launchAgentOptions(), true)
      if (await daemonReachable()) {
        await restartDaemonLaunchAgent(launchAgentOptions())
      } else {
        await startDaemonLaunchAgent(launchAgentOptions())
      }
      await waitForDaemonConfig(targetConfig)
      return
    }
    if (await daemonReachable()) {
      if (daemonProcess && isChildProcessRunning(daemonProcess)) {
        await stopOwnedDaemon(daemonProcess)
        daemonProcess = undefined
      } else {
        throw new Error(nonAppStartedDaemonMessage(targetConfig, daemonControl))
      }
    }
    if (!daemonProcess || daemonProcess.killed || daemonProcess.exitCode !== null) {
      daemonProcess = spawnDaemon(paths.dataDir)
    }
    await waitForDaemonConfig(targetConfig)
  }
  const proxyStatus = async (): Promise<ProxyStatus> => {
    if (!appAutoStartEnabled && !(await daemonReachable())) {
      return stoppedProxyStatus(readRuntimeConfig(), paths.rawCaptureDir)
    }
    await ensureDaemon()
    return (await daemonClient.status()).proxy
  }
  const restartProxy = async (): Promise<ProxyStatus> => {
    appAutoStartEnabled = true
    const targetConfig = readRuntimeConfig()
    if (readLaunchAgentSettings().enabled) {
      setDaemonLaunchAgentEnabled(launchAgentOptions(), true)
      await restartDaemonLaunchAgent(launchAgentOptions())
      await waitForDaemonConfig(targetConfig)
      return (await daemonClient.status()).proxy
    }
    if (daemonProcess && isChildProcessRunning(daemonProcess)) {
      await stopOwnedDaemon(daemonProcess)
      daemonProcess = undefined
    } else if (await daemonReachable()) {
      throw new Error(nonAppStartedDaemonMessage(readRuntimeConfig(), daemonControl))
    }
    daemonProcess = spawnDaemon(paths.dataDir)
    await waitForDaemonConfig(targetConfig)
    return (await daemonClient.status()).proxy
  }
  const startDaemonProxy = async (): Promise<ProxyStatus> => {
    appAutoStartEnabled = true
    const targetConfig = readRuntimeConfig()
    if (await daemonMatchesConfig(targetConfig)) {
      return (await daemonClient.status()).proxy
    }
    if (readLaunchAgentSettings().enabled) {
      setDaemonLaunchAgentEnabled(launchAgentOptions(), true)
      await startDaemonLaunchAgent(launchAgentOptions())
    } else {
      daemonProcess = spawnDaemon(paths.dataDir)
    }
    await waitForDaemonConfig(targetConfig)
    return (await daemonClient.status()).proxy
  }
  const stopProxy = async (): Promise<ProxyStatus> => {
    appAutoStartEnabled = false
    const launchAgent = readLaunchAgentSettings()
    if (launchAgent.enabled) {
      await stopDaemonLaunchAgent(launchAgentOptions())
      daemonProcess = undefined
      await waitForDaemonStop('launchAgent')
      return stoppedProxyStatus(readRuntimeConfig(), paths.rawCaptureDir)
    }
    if (daemonProcess && isChildProcessRunning(daemonProcess)) {
      await stopOwnedDaemon(daemonProcess)
      daemonProcess = undefined
      await waitForDaemonStop('child')
      return stoppedProxyStatus(readRuntimeConfig(), paths.rawCaptureDir)
    }
    if (await daemonReachable()) {
      throw new Error(nonAppStartedDaemonMessage(readRuntimeConfig(), daemonControl))
    }
    return stoppedProxyStatus(readRuntimeConfig(), paths.rawCaptureDir)
  }
  const saveProxyConfig = async (
    config: ProxyConfig
  ): Promise<{ config: ProxyConfig; status: ProxyStatus }> => {
    const saved = writeManagedConfig(config)
    try {
      return { config: saved, status: await restartProxy() }
    } catch (error) {
      throw new Error(`配置已保存，但服务重启失败：${errorMessage(error)}`)
    }
  }
  const saveProxyPageConfig = async (
    config: ProxyConfig,
    input: DaemonControlSaveInput
  ): Promise<{ config: ProxyConfig; status: ProxyStatus }> => {
    const previousLaunchAgent = readLaunchAgentSettings()
    const previousDaemonProcess = daemonProcess
    const wasReachable = await daemonReachable()
    const saved = writeManagedConfig(config)
    const update = updateDaemonControlConfig(paths.databasePath, input)
    daemonControl = update.config
    daemonClient = createDaemonClient(daemonControl)
    ensureDaemonPromise = undefined

    const nextLaunchAgentEnabled = input.launchAgentEnabled ?? previousLaunchAgent.enabled
    try {
      const status = await restartWithOwnerMode({
        nextLaunchAgentEnabled,
        previousDaemonProcess,
        previousLaunchAgentEnabled: previousLaunchAgent.enabled,
        targetConfig: saved,
        wasReachable
      })
      return { config: saved, status }
    } catch (error) {
      throw new Error(`配置已保存，但服务重启失败：${errorMessage(error)}`)
    }
  }
  const rawCaptureDir = async (): Promise<string> => (await proxyStatus()).rawCaptureDir
  const requestSummary = (): RequestSummary => readRequestSummary(paths.databasePath)
  const usageSummary = (): UsageSummary => readUsageSummary(paths.databasePath)
  const saveDaemonControlSettings = async (
    input: DaemonControlSaveInput
  ): Promise<{ proxy?: ProxyStatus; restarted: boolean; settings: DaemonControlView }> => {
    const wasReachable = await daemonReachable()
    const previousDaemonProcess = daemonProcess
    const update = updateDaemonControlConfig(paths.databasePath, input)
    daemonControl = update.config
    daemonClient = createDaemonClient(daemonControl)
    ensureDaemonPromise = undefined

    if (typeof input.launchAgentEnabled === 'boolean') {
      setDaemonLaunchAgentEnabled(launchAgentOptions(), input.launchAgentEnabled)
    }
    const launchAgent = readLaunchAgentSettings(update.settings.launchAgentEnabled)

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
    requestSummary,
    saveDaemonControlSettings,
    restartProxy,
    saveProxyConfig,
    saveProxyPageConfig,
    startDaemonProxy,
    stopProxy,
    usageSummary
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

  async function waitForDaemonConfig(config: ProxyConfig): Promise<void> {
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      const status = await daemonClient.status().then(
        (result) => result.proxy,
        () => undefined
      )
      if (status && proxyStatusMatchesConfig(status, config)) {
        return
      }
      await delay(250)
    }
    throw new Error(`CodexFree daemon did not apply ${proxyEndpoint(config)} within 10 seconds`)
  }

  async function daemonMatchesConfig(config: ProxyConfig): Promise<boolean> {
    const status = await daemonClient.status().then(
      (result) => result.proxy,
      () => undefined
    )
    return status ? proxyStatusMatchesConfig(status, config) : false
  }

  async function waitForDaemonStop(mode: 'child' | 'launchAgent'): Promise<void> {
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      if (!(await daemonReachable())) {
        return
      }
      await delay(200)
    }
    throw new Error(nonAppStartedDaemonMessage(readRuntimeConfig(), daemonControl, mode))
  }

  function launchAgentOptions() {
    return {
      commandPath: process.execPath,
      dataDir: paths.dataDir,
      scriptPath: daemonScriptPath(),
      workingDirectory: paths.dataDir
    }
  }

  function readLaunchAgentSettings(preferredEnabled?: boolean): DaemonLaunchAgentSettings {
    const settings = readDaemonLaunchAgentSettings(launchAgentOptions())
    const enabled = preferredEnabled ?? daemonControl.launchAgentEnabled
    return { ...settings, enabled }
  }

  async function restartWithOwnerMode({
    nextLaunchAgentEnabled,
    previousDaemonProcess,
    previousLaunchAgentEnabled,
    targetConfig,
    wasReachable
  }: {
    nextLaunchAgentEnabled: boolean
    previousDaemonProcess: ChildProcess | undefined
    previousLaunchAgentEnabled: boolean
    targetConfig: ProxyConfig
    wasReachable: boolean
  }): Promise<ProxyStatus> {
    appAutoStartEnabled = true
    if (previousLaunchAgentEnabled) {
      daemonProcess = undefined
      if (nextLaunchAgentEnabled) {
        setDaemonLaunchAgentEnabled(launchAgentOptions(), true)
        await restartDaemonLaunchAgent(launchAgentOptions())
      } else {
        await stopDaemonLaunchAgent(launchAgentOptions())
        await waitForDaemonStop('launchAgent')
        setDaemonLaunchAgentEnabled(launchAgentOptions(), false)
        daemonProcess = spawnDaemon(paths.dataDir)
      }
      await waitForDaemonConfig(targetConfig)
      return (await daemonClient.status()).proxy
    }

    if (previousDaemonProcess && isChildProcessRunning(previousDaemonProcess)) {
      await stopOwnedDaemon(previousDaemonProcess)
      if (daemonProcess === previousDaemonProcess) {
        daemonProcess = undefined
      }
    } else if (wasReachable) {
      throw new Error(nonAppStartedDaemonMessage(readRuntimeConfig(), daemonControl))
    }

    if (nextLaunchAgentEnabled) {
      setDaemonLaunchAgentEnabled(launchAgentOptions(), true)
      daemonProcess = undefined
      await startDaemonLaunchAgent(launchAgentOptions())
    } else {
      setDaemonLaunchAgentEnabled(launchAgentOptions(), false)
      daemonProcess = spawnDaemon(paths.dataDir)
    }
    await waitForDaemonConfig(targetConfig)
    return (await daemonClient.status()).proxy
  }
}

function stoppedProxyStatus(config: ProxyConfig, rawCaptureDir: string): ProxyStatus {
  const endpoint = proxyEndpoint(config)
  const openaiBaseUrl = `${endpoint}/codex`
  return {
    authPoolAccounts: 0,
    authPoolAvailableAccounts: 0,
    authPoolDisabledAccounts: 0,
    authPoolEnabled: config.authPool.enabled,
    authPoolExhaustedAccounts: 0,
    endpoint,
    openaiBaseUrl,
    openaiCompatibleEndpoint: `${openaiBaseUrl}/v1`,
    outboundMode: config.outboundProxy.mode,
    rawCaptureDir,
    rawCaptureEnabled: config.rawCaptureEnabled,
    running: false,
    upstreamBaseUrl: config.upstreamBaseUrl
  }
}

function proxyEndpoint(config: ProxyConfig): string {
  return `http://${config.listenHost}:${config.listenPort}/backend-api`
}

function proxyStatusMatchesConfig(status: ProxyStatus, config: ProxyConfig): boolean {
  return (
    status.endpoint === proxyEndpoint(config) &&
    status.openaiBaseUrl === `${proxyEndpoint(config)}/codex` &&
    status.rawCaptureEnabled === config.rawCaptureEnabled &&
    status.upstreamBaseUrl === config.upstreamBaseUrl
  )
}

function nonAppStartedDaemonMessage(
  _config: ProxyConfig,
  _control: DaemonControlConfig,
  mode: 'child' | 'launchAgent' = 'child'
): string {
  const modeText =
    mode === 'launchAgent'
      ? '检测到开机自启动后台服务已启动。'
      : '检测到后台服务已启动，但不是当前 App 托管的子进程。'
  return [
    '后台服务已启动，App 不能安全停止或重启它。',
    modeText,
    '请自行检查并停止占用端口的代理进程，确认没有正在使用中的 Codex 会话后再操作。'
  ]
    .filter(Boolean)
    .join('\n\n')
}

function createDaemonClient(control: DaemonControlConfig): DaemonAdminClient {
  return new DaemonAdminClient({
    endpoint: daemonAdminEndpoint(control),
    token: control.adminToken
  })
}

function spawnDaemon(dataDir: string): ChildProcess {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  return spawn(process.execPath, [daemonScriptPath(), '--data-dir', dataDir], {
    cwd: dataDir,
    detached: false,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_NO_WARNINGS: '1' },
    stdio: 'ignore'
  })
}

function isChildProcessRunning(child: ChildProcess): boolean {
  return !child.killed && child.exitCode === null && child.signalCode === null
}

async function stopOwnedDaemon(child: ChildProcess): Promise<void> {
  child.kill()
  if (!(await waitForProcessExit(child, 5_000)) && isChildProcessRunning(child)) {
    child.kill('SIGKILL')
    await waitForProcessExit(child, 2_000)
  }
}

function waitForProcessExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (!isChildProcessRunning(child)) {
    return Promise.resolve(true)
  }

  return new Promise((resolve) => {
    const onExit = (): void => {
      clearTimeout(timer)
      resolve(true)
    }
    const timer = setTimeout(() => {
      child.off('exit', onExit)
      resolve(false)
    }, timeoutMs)
    child.once('exit', onExit)
  })
}

function daemonScriptPath(): string {
  return app.isPackaged
    ? join(app.getAppPath(), 'out', 'daemon', 'cli.cjs')
    : join(process.cwd(), 'out', 'daemon', 'cli.cjs')
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
