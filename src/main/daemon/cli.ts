import { mkdirSync } from 'node:fs'
import { exit, stderr, stdout } from 'node:process'
import { fileURLToPath } from 'node:url'
import { readManagedProxyConfig, writeProxyConfig } from '../proxy/config'
import { createProxyLogger } from '../proxy/event-log'
import { ProxyLedger } from '../proxy/ledger'
import { TransparentProxyService } from '../proxy/service'
import type { ProxyConfig, ProxyStatus } from '../proxy/types'
import { DaemonAdminServer, type DaemonAdminStatus } from './admin'
import { resolveDaemonPaths } from './paths'
import { readOrCreateAdminToken } from './token'

const defaultProxyPort = 33333
const defaultAdminHost = '127.0.0.1'
const defaultAdminPort = 44445

interface DaemonCliOptions {
  adminHost?: string
  adminPort?: number
  adminToken?: string
  adminTokenPath?: string
  authPoolDir?: string
  configPath?: string
  dataDir?: string
  debug?: boolean
  host?: string
  port?: number
  rawCaptureEnabled?: boolean
}

export async function runDaemonCli(args: string[]): Promise<void> {
  const options = parseDaemonCliArgs(args)
  const paths = resolveDaemonPaths(options)
  mkdirSync(paths.authPoolDir, { recursive: true, mode: 0o700 })

  const readConfig = (): ProxyConfig => buildDaemonCliConfig(options, paths)
  const writeConfig = (config: ProxyConfig): ProxyConfig =>
    writeProxyConfig(paths.configPath, config, paths.authPoolDir)
  const token = options.adminToken ?? readOrCreateAdminToken(paths.adminTokenPath)
  const ledger = new ProxyLedger(paths.databasePath)
  const service = new TransparentProxyService(
    readConfig(),
    ledger,
    createProxyLogger(ledger, { debug: options.debug ?? false, prefix: 'daemon' }),
    paths.rawCaptureDir
  )
  const proxyStatus = await service.start(readConfig())
  const admin = new DaemonAdminServer({
    host: options.adminHost ?? defaultAdminHost,
    ledger,
    port: options.adminPort ?? defaultAdminPort,
    readConfig,
    service,
    token,
    writeConfig
  })
  const adminStatus = await admin.start()
  printStarted(proxyStatus, adminStatus, paths.adminTokenPath)

  const stop = async (signal: string) => {
    stdout.write(`\nReceived ${signal}; stopping CodexFree daemon...\n`)
    await admin.stop()
    await service.stop()
    exit(0)
  }
  process.once('SIGINT', () => void stop('SIGINT'))
  process.once('SIGTERM', () => void stop('SIGTERM'))

  await new Promise(() => undefined)
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
  const saved = readManagedProxyConfig(paths.configPath, paths.authPoolDir)
  return {
    ...saved,
    listenHost: options.host ?? saved.listenHost,
    listenPort: options.port ?? saved.listenPort,
    rawCaptureEnabled: options.rawCaptureEnabled ?? saved.rawCaptureEnabled
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
  if (name === 'admin-token-path') {
    options.adminTokenPath = value
    return
  }
  if (name === 'config') {
    options.configPath = value
    return
  }
  if (name === 'data-dir') {
    options.dataDir = value
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

function printStarted(
  proxyStatus: ProxyStatus,
  adminStatus: DaemonAdminStatus,
  tokenPath: string
): void {
  stdout.write(
    [
      `CodexFree daemon proxy: ${proxyStatus.endpoint}`,
      `Codex config chatgpt_base_url = "${proxyStatus.endpoint}"`,
      `Codex config openai_base_url = "${proxyStatus.openaiBaseUrl}"`,
      `Admin API: ${adminStatus.endpoint}`,
      `Admin token file: ${tokenPath}`,
      ''
    ].join('\n')
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
    '  --admin-host <host>           Admin API host. Defaults to 127.0.0.1.',
    `  --admin-port <port>           Admin API port. Defaults to ${defaultAdminPort}.`,
    '  --admin-token <token>         Admin API bearer token.',
    '  --admin-token-path <path>     Admin token file path.',
    '  --config <path>               Proxy config path.',
    '  --data-dir <path>             Data directory for config, ledger, token, and auth pool.',
    '  --debug                       Print readable log events from the SQLite log ledger.',
    '  --auth-pool-dir <path>        Managed auth-pool directory.',
    '  --raw-capture                 Enable debug packet and WebSocket frame files.',
    '  --no-raw-capture              Disable debug packet files. This is the CLI default.',
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
