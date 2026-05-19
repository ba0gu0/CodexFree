import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { join } from 'node:path'
import { platform } from 'node:process'
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
  requestSummary: () => RequestSummary
  saveDaemonControlSettings: (
    input: DaemonControlSaveInput
  ) => Promise<{ proxy?: ProxyStatus; restarted: boolean; settings: DaemonControlView }>
  restartProxy: () => Promise<ProxyStatus>
  saveProxyConfig: (config: ProxyConfig) => Promise<{ config: ProxyConfig; status: ProxyStatus }>
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
    if (!appAutoStartEnabled) {
      throw new Error('CodexFree daemon is stopped by the app control')
    }
    if (!daemonProcess || daemonProcess.killed || daemonProcess.exitCode !== null) {
      daemonProcess = spawnDaemon(paths.dataDir)
    }
    await waitForDaemon()
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
    if (readDaemonLaunchAgentSettings(launchAgentOptions()).enabled) {
      restartDaemonLaunchAgent(launchAgentOptions())
      await waitForDaemon()
      return (await daemonClient.status()).proxy
    }
    if (daemonProcess && isChildProcessRunning(daemonProcess)) {
      await stopOwnedDaemon(daemonProcess)
      daemonProcess = undefined
    } else if (await daemonReachable()) {
      throw new Error(nonAppStartedDaemonMessage(readRuntimeConfig(), daemonControl))
    }
    daemonProcess = spawnDaemon(paths.dataDir)
    await waitForDaemon()
    return (await daemonClient.status()).proxy
  }
  const startDaemonProxy = async (): Promise<ProxyStatus> => {
    appAutoStartEnabled = true
    if (await daemonReachable()) {
      return (await daemonClient.status()).proxy
    }
    if (readDaemonLaunchAgentSettings(launchAgentOptions()).enabled) {
      startDaemonLaunchAgent(launchAgentOptions())
    } else {
      daemonProcess = spawnDaemon(paths.dataDir)
    }
    await waitForDaemon()
    return (await daemonClient.status()).proxy
  }
  const stopProxy = async (): Promise<ProxyStatus> => {
    appAutoStartEnabled = false
    const launchAgent = readDaemonLaunchAgentSettings(launchAgentOptions())
    if (launchAgent.enabled) {
      stopDaemonLaunchAgent(launchAgentOptions())
      daemonProcess = undefined
      await waitForDaemonStop()
      return stoppedProxyStatus(readRuntimeConfig(), paths.rawCaptureDir)
    }
    if (daemonProcess && isChildProcessRunning(daemonProcess)) {
      await stopOwnedDaemon(daemonProcess)
      daemonProcess = undefined
      await waitForDaemonStop()
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
    requestSummary,
    saveDaemonControlSettings,
    restartProxy,
    saveProxyConfig,
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

  async function waitForDaemonStop(): Promise<void> {
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      if (!(await daemonReachable())) {
        return
      }
      await delay(200)
    }
    throw new Error(nonAppStartedDaemonMessage(readRuntimeConfig(), daemonControl))
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

function stoppedProxyStatus(config: ProxyConfig, rawCaptureDir: string): ProxyStatus {
  const hostPort = `${config.listenHost}:${config.listenPort}`
  const endpoint = `http://${hostPort}/backend-api`
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

function nonAppStartedDaemonMessage(config: ProxyConfig, control: DaemonControlConfig): string {
  return [
    '当前 daemon 不是由 App 启动的子进程，App 不能安全停止它。',
    '请自行检查并停止占用端口的代理进程。',
    collectDaemonDiagnostics(config, control)
  ]
    .filter(Boolean)
    .join('\n\n')
}

function collectDaemonDiagnostics(config: ProxyConfig, control: DaemonControlConfig): string {
  const keywords = [
    String(config.listenPort),
    String(control.adminPort),
    'codexfree',
    'CodexFree',
    'daemon/cli'
  ]
  return [
    renderDiagnosticBlock('ps', collectPsDiagnostics(keywords)),
    renderDiagnosticBlock('lsof', collectPortDiagnostics(config.listenPort)),
    renderDiagnosticBlock('admin lsof', collectPortDiagnostics(control.adminPort)),
    renderDiagnosticBlock('netstat', collectNetstatDiagnostics(config.listenPort))
  ]
    .filter(Boolean)
    .join('\n')
}

function renderDiagnosticBlock(label: string, value: string): string {
  return value ? `[${label}]\n${value}` : ''
}

function collectPsDiagnostics(keywords: string[]): string {
  if (platform === 'win32') {
    return runCommand('tasklist.exe', ['/v'])
      .split('\n')
      .filter((line) => keywords.some((keyword) => line.includes(keyword)))
      .slice(0, 12)
      .join('\n')
  }
  return runCommand('ps', ['-axo', 'pid,ppid,command'])
    .split('\n')
    .filter((line) => keywords.some((keyword) => line.includes(keyword)))
    .slice(0, 12)
    .join('\n')
}

function collectPortDiagnostics(port: number): string {
  if (platform === 'win32') {
    return runCommand('netstat.exe', ['-ano'])
      .split('\n')
      .filter((line) => line.includes(`:${port}`))
      .slice(0, 12)
      .join('\n')
  }
  return runCommand('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'])
}

function collectNetstatDiagnostics(port: number): string {
  if (platform === 'win32') {
    return ''
  }
  return runCommand('netstat', ['-anv'])
    .split('\n')
    .filter((line) => line.includes(`.${port}`) || line.includes(`:${port}`))
    .slice(0, 12)
    .join('\n')
}

function runCommand(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
  } catch {
    return ''
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
