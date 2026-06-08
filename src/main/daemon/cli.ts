import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { exit, stderr, stdout } from 'node:process'
import { fileURLToPath } from 'node:url'
import { codexConfigContentLooksCurrent } from '../codex/config'
import { readManagedProxyConfig, writeProxyConfig } from '../proxy/config'
import { createProxyLogger } from '../proxy/event-log'
import { ProxyLedger } from '../proxy/ledger'
import { TransparentProxyService } from '../proxy/service'
import type { ProxyConfig, ProxyStatus } from '../proxy/types'
import { DaemonAdminServer, type DaemonAdminStatus } from './admin'
import { readDaemonControlConfigWithStatus, updateDaemonControlConfig } from './control-config'
import { resolveDaemonPaths } from './paths'
import { QuotaResetRefresher } from './quota-refresh'
import { TokenRefreshMaintainer } from './token-refresh'

const defaultProxyPort = 33333
const defaultAdminPort = 44445

interface DaemonCliOptions {
  adminHost?: string
  adminPort?: number
  adminToken?: string
  authPoolDir?: string
  databasePath?: string
  dataDir?: string
  debug?: boolean
  host?: string
  maxRequestBodyBytes?: number
  port?: number
  rawCaptureMaxBytes?: number
  rawCaptureEnabled?: boolean
}

export async function runDaemonCli(args: string[]): Promise<void> {
  const options = parseDaemonCliArgs(args)
  const paths = resolveDaemonPaths(options)
  mkdirSync(paths.authPoolDir, { recursive: true, mode: 0o700 })

  const startupConfig = applyDaemonCliProxyOptions(options, paths)
  const readConfig = (): ProxyConfig =>
    readManagedProxyConfig(paths.databasePath, paths.authPoolDir)
  const writeConfig = (config: ProxyConfig): ProxyConfig =>
    writeProxyConfig(paths.databasePath, config, paths.authPoolDir)
  const control = applyDaemonCliControlOptions(options, paths.databasePath)
  const ledger = new ProxyLedger(paths.databasePath)
  const service = new TransparentProxyService(
    startupConfig,
    ledger,
    createProxyLogger(ledger, { debug: options.debug ?? false, prefix: 'daemon' }),
    paths.rawCaptureDir
  )
  const proxyStatus = await service.start(startupConfig)
  const adminService = {
    rawCaptureDir: service.rawCaptureDir,
    refreshAccountPool: (): ProxyStatus => service.refreshAccountPool(),
    refreshAccountState: (): ProxyStatus => service.refreshAccountState(),
    removeAccountsFromPool: (accountIds: string[]): ProxyStatus =>
      service.removeAccountsFromPool(accountIds),
    status: (): ProxyStatus => service.status(),
    switchActiveAccountAndCloseWebSockets: (accountId?: string) =>
      service.switchActiveAccountAndCloseWebSockets(accountId)
  }
  const admin = new DaemonAdminServer({
    host: control.config.adminHost,
    ledger,
    port: control.config.adminPort,
    readConfig,
    service: adminService,
    token: control.config.adminToken,
    writeConfig
  })
  const adminStatus = await admin.start()
  const configMonitor = startCodexConfigMonitor(readConfig, ledger)
  const quotaResetRefresher = new QuotaResetRefresher({
    authPoolDir: paths.authPoolDir,
    ledger,
    readUpstreamBaseUrl: () => readConfig().upstreamBaseUrl,
    refreshAccountState: () => service.refreshAccountState()
  })
  const tokenRefreshMaintainer = new TokenRefreshMaintainer({
    authPoolDir: paths.authPoolDir,
    ledger,
    refreshAccountPool: () => service.refreshAccountPool()
  })
  quotaResetRefresher.start()
  tokenRefreshMaintainer.start()
  printStarted(proxyStatus, adminStatus, paths.databasePath, control.generatedAdminToken)

  const stop = async (signal: string) => {
    stdout.write(`\nReceived ${signal}; stopping CodexFree daemon...\n`)
    quotaResetRefresher.stop()
    tokenRefreshMaintainer.stop()
    configMonitor.stop()
    await admin.stop()
    await service.stop()
    exit(0)
  }
  process.once('SIGINT', () => void stop('SIGINT'))
  process.once('SIGTERM', () => void stop('SIGTERM'))

  await new Promise(() => undefined)
}

function startCodexConfigMonitor(
  readConfig: () => ProxyConfig,
  ledger: ProxyLedger
): { stop: () => void } {
  let lastDriftKey: string | null = null
  const run = (): void => {
    const config = readConfig()
    if (!config.codexConfigMonitorEnabled) {
      lastDriftKey = null
      return
    }
    const input = codexConfigInput(config)
    if (codexConfigLooksCurrent(input)) {
      lastDriftKey = null
      return
    }
    const driftKey = `${input.chatgptBaseUrl}\n${input.openaiBaseUrl}`
    if (driftKey === lastDriftKey) {
      return
    }
    lastDriftKey = driftKey
    ledger.recordLogEvent(
      {
        detail: input,
        eventType: 'system',
        level: 'warn',
        message: 'Codex config drift detected'
      },
      new Date()
    )
  }
  run()
  const timer = setInterval(run, 60 * 60 * 1000)
  return {
    stop: () => clearInterval(timer)
  }
}

function codexConfigInput(config: ProxyConfig): {
  chatgptBaseUrl: string
  openaiBaseUrl: string
} {
  const baseUrl = `http://${config.listenHost}:${config.listenPort}/backend-api`
  return {
    chatgptBaseUrl: baseUrl,
    openaiBaseUrl: `${baseUrl}/codex`
  }
}

function codexConfigLooksCurrent(input: ReturnType<typeof codexConfigInput>): boolean {
  const configPath = join(homedir(), '.codex', 'config.toml')
  if (!existsSync(configPath)) {
    return false
  }
  const content = readFileSync(configPath, 'utf8')
  return codexConfigContentLooksCurrent(content, input)
}

export function resolveDaemonCliPaths(
  options: DaemonCliOptions
): ReturnType<typeof resolveDaemonPaths> {
  return resolveDaemonPaths(options)
}

export function buildDaemonCliConfig(
  options: DaemonCliOptions,
  paths: ReturnType<typeof resolveDaemonPaths>
): ProxyConfig {
  const saved = readManagedProxyConfig(paths.databasePath, paths.authPoolDir)
  return {
    ...saved,
    listenHost: options.host ?? saved.listenHost,
    listenPort: options.port ?? saved.listenPort,
    maxRequestBodyBytes: options.maxRequestBodyBytes ?? saved.maxRequestBodyBytes,
    rawCaptureEnabled: options.rawCaptureEnabled ?? saved.rawCaptureEnabled,
    rawCaptureMaxBytes: options.rawCaptureMaxBytes ?? saved.rawCaptureMaxBytes
  }
}

export function parseDaemonCliArgs(args: string[]): DaemonCliOptions {
  const options: DaemonCliOptions = {}
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--help' || arg === '-h') {
      throw new DaemonCliHelp()
    }
    if (arg === '--raw-capture') {
      options.rawCaptureEnabled = true
      continue
    }
    if (arg === '--no-raw-capture') {
      options.rawCaptureEnabled = false
      continue
    }
    if (arg === '--debug') {
      options.debug = true
      continue
    }
    if (arg === '--no-debug') {
      options.debug = false
      continue
    }
    const parsed = splitOption(arg, args[index + 1])
    if (!parsed) {
      throw new Error(`Unknown option: ${arg}`)
    }
    index += parsed.consumedNext ? 1 : 0
    applyOption(options, parsed.name, parsed.value)
  }
  return options
}

class DaemonCliHelp extends Error {}

interface ParsedOption {
  consumedNext: boolean
  name: string
  value: string
}

function splitOption(arg: string, next: string | undefined): ParsedOption | undefined {
  if (!arg.startsWith('--')) {
    return undefined
  }
  const equalIndex = arg.indexOf('=')
  if (equalIndex > 0) {
    return { consumedNext: false, name: arg.slice(2, equalIndex), value: arg.slice(equalIndex + 1) }
  }
  if (!next || next.startsWith('--')) {
    return undefined
  }
  return { consumedNext: true, name: arg.slice(2), value: next }
}

function applyOption(options: DaemonCliOptions, name: string, value: string): void {
  if (name === 'host') {
    options.host = value
    return
  }
  if (name === 'port') {
    options.port = parsePort(value)
    return
  }
  if (name === 'max-request-body-bytes') {
    options.maxRequestBodyBytes = parseByteLimit(value, name)
    return
  }
  if (name === 'raw-capture-max-bytes') {
    options.rawCaptureMaxBytes = parseByteLimit(value, name)
    return
  }
  if (name === 'admin-host') {
    options.adminHost = value
    return
  }
  if (name === 'admin-port') {
    options.adminPort = parsePort(value)
    return
  }
  if (name === 'admin-token') {
    options.adminToken = value
    return
  }
  if (name === 'data-dir') {
    options.dataDir = value
    return
  }
  if (name === 'database') {
    options.databasePath = value
    return
  }
  if (name === 'auth-pool-dir') {
    options.authPoolDir = value
    return
  }
  throw new Error(`Unknown option: --${name}`)
}

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`)
  }
  return port
}

function parseByteLimit(value: string, name: string): number {
  const bytes = Number.parseInt(value, 10)
  if (!Number.isInteger(bytes) || bytes < 0) {
    throw new Error(`Invalid ${name}: ${value}`)
  }
  return bytes
}

function printStarted(
  proxyStatus: ProxyStatus,
  adminStatus: DaemonAdminStatus,
  databasePath: string,
  generatedAdminToken: boolean
): void {
  stdout.write(
    [
      `CodexFree daemon proxy: ${proxyStatus.endpoint}`,
      `Codex config chatgpt_base_url = "${proxyStatus.endpoint}"`,
      `Codex config openai_base_url = "${proxyStatus.openaiBaseUrl}"`,
      `Admin API: ${adminStatus.endpoint}`,
      `Database: ${databasePath}`,
      ...(generatedAdminToken ? ['Admin token generated and saved in database.'] : []),
      ''
    ].join('\n')
  )
}

function applyDaemonCliControlOptions(
  options: DaemonCliOptions,
  databasePath: string
): ReturnType<typeof readDaemonControlConfigWithStatus> {
  const current = readDaemonControlConfigWithStatus(databasePath)
  if (
    options.adminHost === undefined &&
    options.adminPort === undefined &&
    options.adminToken === undefined
  ) {
    return current
  }

  const updated = updateDaemonControlConfig(databasePath, {
    adminHost: options.adminHost ?? current.config.adminHost,
    adminPort: options.adminPort ?? current.config.adminPort,
    adminToken: options.adminToken ?? current.config.adminToken
  })
  return {
    config: updated.config,
    generatedAdminToken: current.generatedAdminToken && options.adminToken === undefined
  }
}

function applyDaemonCliProxyOptions(
  options: DaemonCliOptions,
  paths: ReturnType<typeof resolveDaemonPaths>
): ProxyConfig {
  const config = buildDaemonCliConfig(options, paths)
  if (!hasExplicitProxyConfigOptions(options)) {
    return config
  }
  return writeProxyConfig(paths.databasePath, config, paths.authPoolDir)
}

function hasExplicitProxyConfigOptions(options: DaemonCliOptions): boolean {
  return (
    options.host !== undefined ||
    options.port !== undefined ||
    options.maxRequestBodyBytes !== undefined ||
    options.rawCaptureEnabled !== undefined ||
    options.rawCaptureMaxBytes !== undefined
  )
}

function formatDaemonCliHelp(): string {
  return [
    'Usage: codexfree-daemon [options]',
    '       bun run daemon -- [options]',
    '       bun run proxy -- [options]',
    '',
    'Options:',
    '  --host <host>                 Proxy listen host.',
    `  --port <port>                 Proxy listen port. Defaults to ${defaultProxyPort}.`,
    '  --max-request-body-bytes <n>  Request body cap. 0 means unlimited.',
    '  --admin-host <host>           Admin API host. Defaults to 127.0.0.1.',
    `  --admin-port <port>           Admin API port. Defaults to ${defaultAdminPort}.`,
    '  --admin-token <token>         Admin API bearer token. Saves to database.',
    '  --data-dir <path>             Data directory for ledger, settings, and auth pool.',
    '  --database <path>             SQLite database path. Overrides --data-dir database.',
    '  --debug                       Print readable log events from the SQLite log ledger.',
    '  --auth-pool-dir <path>        Managed auth-pool directory.',
    '  --raw-capture                 Enable debug packet and WebSocket frame files.',
    '  --no-raw-capture              Disable debug packet files. This is the CLI default.',
    '  --raw-capture-max-bytes <n>   Raw capture cap. 0 means unlimited.',
    '  --help                        Show this help.',
    ''
  ].join('\n')
}

function isMainModule(): boolean {
  const argvScript = process.argv[1] ?? ''
  return (
    fileURLToPath(import.meta.url) === argvScript ||
    argvScript.endsWith('/cli.cjs') ||
    argvScript.endsWith('\\cli.cjs')
  )
}

if (isMainModule()) {
  runDaemonCli(process.argv.slice(2)).catch((error: unknown) => {
    if (error instanceof DaemonCliHelp) {
      stdout.write(formatDaemonCliHelp())
      exit(0)
    }
    const message = error instanceof Error ? error.message : String(error)
    stderr.write(`CodexFree daemon failed: ${message}\n`)
    exit(1)
  })
}
