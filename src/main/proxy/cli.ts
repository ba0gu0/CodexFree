import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { exit, stderr, stdout } from 'node:process'
import { fileURLToPath } from 'node:url'
import { readManagedProxyConfig, writeProxyConfig } from './config'
import { formatProxyLog } from './event-log'
import { ProxyLedger } from './ledger'
import { TransparentProxyService } from './service'
import type { ProxyConfig, ProxyStatus } from './types'

const defaultCliPort = 33333

interface ProxyCliOptions {
  host?: string
  port?: number
  dataDir?: string
  databasePath?: string
  authPoolDir?: string
  maxRequestBodyBytes?: number
  rawCaptureMaxBytes?: number
  rawCaptureEnabled?: boolean
}

interface ProxyCliPaths {
  dataDir: string
  databasePath: string
  authPoolDir: string
  rawCaptureDir: string
}

const logger = {
  info: (message: string, data?: unknown) => writeLog('info', message, data),
  warn: (message: string, data?: unknown) => writeLog('warn', message, data),
  error: (message: string, data?: unknown) => writeLog('error', message, data)
}

export function parseProxyCliArgs(args: string[]): ProxyCliOptions {
  const options: ProxyCliOptions = {}

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--help' || arg === '-h') {
      throw new ProxyCliHelp()
    }
    if (arg === '--host') {
      options.host = readRequiredValue(args, index, arg)
      index += 1
      continue
    }
    if (arg === '--port') {
      options.port = parsePort(readRequiredValue(args, index, arg))
      index += 1
      continue
    }
    if (arg === '--max-request-body-bytes') {
      options.maxRequestBodyBytes = parseByteLimit(readRequiredValue(args, index, arg), arg)
      index += 1
      continue
    }
    if (arg === '--data-dir') {
      options.dataDir = readRequiredValue(args, index, arg)
      index += 1
      continue
    }
    if (arg === '--database') {
      options.databasePath = readRequiredValue(args, index, arg)
      index += 1
      continue
    }
    if (arg === '--auth-pool-dir') {
      options.authPoolDir = readRequiredValue(args, index, arg)
      index += 1
      continue
    }
    if (arg === '--raw-capture') {
      options.rawCaptureEnabled = true
      continue
    }
    if (arg === '--no-raw-capture') {
      options.rawCaptureEnabled = false
      continue
    }
    if (arg === '--raw-capture-max-bytes') {
      options.rawCaptureMaxBytes = parseByteLimit(readRequiredValue(args, index, arg), arg)
      index += 1
      continue
    }
    if (arg.startsWith('--host=')) {
      options.host = arg.slice('--host='.length)
      continue
    }
    if (arg.startsWith('--port=')) {
      options.port = parsePort(arg.slice('--port='.length))
      continue
    }
    if (arg.startsWith('--max-request-body-bytes=')) {
      options.maxRequestBodyBytes = parseByteLimit(
        arg.slice('--max-request-body-bytes='.length),
        '--max-request-body-bytes'
      )
      continue
    }
    if (arg.startsWith('--data-dir=')) {
      options.dataDir = arg.slice('--data-dir='.length)
      continue
    }
    if (arg.startsWith('--database=')) {
      options.databasePath = arg.slice('--database='.length)
      continue
    }
    if (arg.startsWith('--auth-pool-dir=')) {
      options.authPoolDir = arg.slice('--auth-pool-dir='.length)
      continue
    }
    if (arg.startsWith('--raw-capture-max-bytes=')) {
      options.rawCaptureMaxBytes = parseByteLimit(
        arg.slice('--raw-capture-max-bytes='.length),
        '--raw-capture-max-bytes'
      )
      continue
    }

    throw new Error(`Unknown option: ${arg}`)
  }

  return options
}

export function resolveProxyCliPaths(options: ProxyCliOptions): ProxyCliPaths {
  const dataDir =
    options.dataDir ?? (options.databasePath ? dirname(options.databasePath) : defaultDataDir())
  return {
    dataDir,
    databasePath: options.databasePath ?? join(dataDir, 'codexfree.sqlite'),
    authPoolDir: options.authPoolDir ?? join(dataDir, 'auth-pool'),
    rawCaptureDir: join(dataDir, 'raw-captures')
  }
}

export function buildProxyCliConfig(options: ProxyCliOptions, paths: ProxyCliPaths): ProxyConfig {
  const savedConfig = readManagedProxyConfig(paths.databasePath, paths.authPoolDir)
  return {
    ...savedConfig,
    listenHost: options.host ?? savedConfig.listenHost,
    listenPort: options.port ?? savedConfig.listenPort,
    maxRequestBodyBytes: options.maxRequestBodyBytes ?? savedConfig.maxRequestBodyBytes,
    rawCaptureEnabled: options.rawCaptureEnabled ?? savedConfig.rawCaptureEnabled,
    rawCaptureMaxBytes: options.rawCaptureMaxBytes ?? savedConfig.rawCaptureMaxBytes
  }
}

export async function runProxyCli(args: string[]): Promise<void> {
  let options: ProxyCliOptions
  try {
    options = parseProxyCliArgs(args)
  } catch (error) {
    if (error instanceof ProxyCliHelp) {
      stdout.write(formatProxyCliHelp())
      return
    }
    throw error
  }

  const paths = resolveProxyCliPaths(options)
  mkdirSync(paths.authPoolDir, { recursive: true, mode: 0o700 })

  const config = applyProxyCliConfigOptions(options, paths)
  const ledger = new ProxyLedger(paths.databasePath)
  const service = new TransparentProxyService(config, ledger, logger, paths.rawCaptureDir)
  const status = await service.start()
  printStarted(status, paths)

  const stop = async (signal: string) => {
    stdout.write(`\nReceived ${signal}; stopping CodexFree proxy...\n`)
    await service.stop()
    exit(0)
  }

  process.once('SIGINT', () => {
    void stop('SIGINT')
  })
  process.once('SIGTERM', () => {
    void stop('SIGTERM')
  })

  await new Promise(() => undefined)
}

class ProxyCliHelp extends Error {}

function defaultDataDir(): string {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'codexfree')
  }
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'codexfree')
  }
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'codexfree')
}

function readRequiredValue(args: string[], index: number, option: string): string {
  const value = args[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${option} requires a value`)
  }
  return value
}

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`)
  }
  return port
}

function parseByteLimit(value: string, option: string): number {
  const bytes = Number.parseInt(value, 10)
  if (!Number.isInteger(bytes) || bytes < 0) {
    throw new Error(`${option} must be a non-negative integer`)
  }
  return bytes
}

function applyProxyCliConfigOptions(options: ProxyCliOptions, paths: ProxyCliPaths): ProxyConfig {
  const config = buildProxyCliConfig(options, paths)
  if (!hasExplicitProxyConfigOptions(options)) {
    return config
  }
  return writeProxyConfig(paths.databasePath, config, paths.authPoolDir)
}

function hasExplicitProxyConfigOptions(options: ProxyCliOptions): boolean {
  return (
    options.host !== undefined ||
    options.port !== undefined ||
    options.maxRequestBodyBytes !== undefined ||
    options.rawCaptureEnabled !== undefined ||
    options.rawCaptureMaxBytes !== undefined
  )
}

function printStarted(status: ProxyStatus, paths: ProxyCliPaths): void {
  stdout.write(
    [
      `CodexFree proxy listening at ${status.endpoint}`,
      `Codex config chatgpt_base_url = "${status.endpoint}"`,
      `Codex config openai_base_url = "${status.openaiBaseUrl}"`,
      `Future API-key /v1 endpoint: ${status.openaiCompatibleEndpoint}`,
      `Upstream: ${status.upstreamBaseUrl}`,
      `Auth pool: ${status.authPoolEnabled ? 'enabled' : 'disabled'} (${paths.authPoolDir})`,
      `Ledger: ${paths.databasePath}`,
      ''
    ].join('\n')
  )
}

function writeLog(level: 'info' | 'warn' | 'error', message: string, data?: unknown): void {
  const target = level === 'error' ? stderr : stdout
  target.write(`[proxy:${level}] ${formatProxyLog(message, data)}\n`)
}

function formatProxyCliHelp(): string {
  return [
    'Usage: bun run proxy -- [options]',
    '',
    'Options:',
    '  --host <host>              Listen host. Defaults to saved config host.',
    `  --port <port>              Listen port. Defaults to ${defaultCliPort}.`,
    '  --max-request-body-bytes <n> Request body cap. 0 means unlimited.',
    '  --data-dir <path>          Data directory for ledger, settings, and auth pool.',
    '  --database <path>          SQLite database path. Overrides --data-dir database.',
    '  --auth-pool-dir <path>     Managed auth-pool directory.',
    '  --raw-capture              Enable debug packet and WebSocket frame files.',
    '  --no-raw-capture           Disable debug packet files. This is the CLI default.',
    '  --raw-capture-max-bytes <n> Raw capture cap. 0 means unlimited.',
    '  --help                     Show this help.',
    ''
  ].join('\n')
}

function isMainModule(): boolean {
  return fileURLToPath(import.meta.url) === process.argv[1]
}

if (isMainModule()) {
  runProxyCli(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    stderr.write(`CodexFree proxy failed: ${message}\n`)
    exit(1)
  })
}
