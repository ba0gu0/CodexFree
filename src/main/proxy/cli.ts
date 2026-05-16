import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { exit, stderr, stdout } from 'node:process'
import { fileURLToPath } from 'node:url'
import { readManagedProxyConfig } from './config'
import { ProxyLedger } from './ledger'
import { TransparentProxyService } from './service'
import type { ProxyConfig, ProxyStatus } from './types'

const defaultCliPort = 33333

interface ProxyCliOptions {
  host?: string
  port?: number
  configPath?: string
  dataDir?: string
  authPoolDir?: string
  rawCaptureEnabled?: boolean
}

interface ProxyCliPaths {
  dataDir: string
  databasePath: string
  configPath: string
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
    if (arg === '--config') {
      options.configPath = readRequiredValue(args, index, arg)
      index += 1
      continue
    }
    if (arg === '--data-dir') {
      options.dataDir = readRequiredValue(args, index, arg)
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
    if (arg.startsWith('--host=')) {
      options.host = arg.slice('--host='.length)
      continue
    }
    if (arg.startsWith('--port=')) {
      options.port = parsePort(arg.slice('--port='.length))
      continue
    }
    if (arg.startsWith('--config=')) {
      options.configPath = arg.slice('--config='.length)
      continue
    }
    if (arg.startsWith('--data-dir=')) {
      options.dataDir = arg.slice('--data-dir='.length)
      continue
    }
    if (arg.startsWith('--auth-pool-dir=')) {
      options.authPoolDir = arg.slice('--auth-pool-dir='.length)
      continue
    }

    throw new Error(`Unknown option: ${arg}`)
  }

  return options
}

export function resolveProxyCliPaths(options: ProxyCliOptions): ProxyCliPaths {
  const dataDir = options.dataDir ?? defaultDataDir()
  return {
    dataDir,
    databasePath: join(dataDir, 'codexfree.sqlite'),
    configPath: options.configPath ?? join(dataDir, 'proxy-config.json'),
    authPoolDir: options.authPoolDir ?? join(dataDir, 'auth-pool'),
    rawCaptureDir: join(dataDir, 'raw-captures')
  }
}

export function buildProxyCliConfig(options: ProxyCliOptions, paths: ProxyCliPaths): ProxyConfig {
  const savedConfig = readManagedProxyConfig(paths.configPath, paths.authPoolDir)
  return {
    ...savedConfig,
    listenHost: options.host ?? savedConfig.listenHost,
    listenPort: options.port ?? savedConfig.listenPort,
    rawCaptureEnabled: options.rawCaptureEnabled ?? savedConfig.rawCaptureEnabled
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

  const config = buildProxyCliConfig(options, paths)
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
  target.write(`[proxy:${level}] ${formatProxyEvent(message, data)}\n`)
}

function formatProxyEvent(message: string, data: unknown): string {
  const record = asRecord(data)
  if (message === 'Transparent proxy started') {
    return [
      `代理已启动: ${stringValue(record, 'endpoint') ?? 'unknown'}`,
      `upstream=${stringValue(record, 'upstreamBaseUrl') ?? 'unknown'}`,
      `rawCapture=${booleanText(record?.rawCaptureEnabled)}`,
      `authPool=${booleanText(record?.authPoolEnabled)}`,
      `accounts=${numberValue(record, 'authPoolAvailableAccounts') ?? 0}/${
        numberValue(record, 'authPoolAccounts') ?? 0
      }`,
      `exhausted=${numberValue(record, 'authPoolExhaustedAccounts') ?? 0}`
    ].join(' ')
  }
  if (message === 'Active account selected') {
    return `当前锁定账户: ${accountText(record)} ${usageText(record)}`
  }
  if (message === 'Switched active account after usage limit') {
    return `额度耗尽后已切换账户: ${accountText(record)} ${usageText(record)}`
  }
  if (message === 'Usage limit reached; marking account exhausted') {
    const reset = stringValue(record, 'resetsAt') ?? 'unknown'
    return `发现 usage_limit_reached: ${accountText(record)} used=${
      stringValue(record, 'used') ?? 'unknown'
    } reset=${reset}，已标记耗尽`
  }
  if (message === 'No replacement account is available after usage limit') {
    return `额度耗尽但没有可切换账户: ${accountText(record)}`
  }
  if (message === 'HTTP forward') {
    const method = stringValue(record, 'method') ?? 'GET'
    const path = stringValue(record, 'path') ?? '/'
    const body = stringValue(record, 'body')
    return [
      `转发HTTP请求: ${method} ${path}`,
      `(${describeEndpoint(path)})`,
      `-> ${stringValue(record, 'targetHost') ?? 'unknown'}`,
      accountText(record),
      body ? `body="${body}"` : undefined
    ]
      .filter(Boolean)
      .join(' ')
  }
  if (message === 'HTTP result') {
    const path = stringValue(record, 'path') ?? '/'
    const body = stringValue(record, 'body')
    const error = stringValue(record, 'errorMessage')
    return [
      `HTTP响应: ${stringValue(record, 'statusCode') ?? 'unknown'} ${path}`,
      `(${describeEndpoint(path)})`,
      `${numberValue(record, 'durationMs') ?? 0}ms`,
      `${numberValue(record, 'bytes') ?? 0}B`,
      error ? `error="${error}"` : undefined,
      body ? `body="${body}"` : undefined
    ]
      .filter(Boolean)
      .join(' ')
  }
  if (message === 'WSS client connected') {
    const path = stringValue(record, 'path') ?? '/'
    return `WSS客户端已连接: ${path} ${accountText(record)} ${usageText(record)}`
  }
  if (message === 'WSS lifecycle') {
    return formatWebSocketLifecycle(record)
  }
  if (message === 'WSS message') {
    return formatWebSocketMessage(record)
  }

  const suffix = data === undefined ? '' : ` ${JSON.stringify(data)}`
  return `${message}${suffix}`
}

function formatWebSocketLifecycle(record: Record<string, unknown> | undefined): string {
  const event = stringValue(record, 'event')
  const path = stringValue(record, 'path') ?? '/'
  const account = accountText(record)
  if (event === 'upstream_connecting') {
    return `WSS开始连接ChatGPT: ${path} ${account}`
  }
  if (event === 'upstream_connected') {
    const statusCode = stringValue(record, 'statusCode') ?? '101'
    return `WSS已连接ChatGPT: ${path} status=${statusCode} ${account}`
  }
  if (event === 'quota_frame_suppressed') {
    return `已拦截 usage_limit_reached 响应并结束当前WSS: ${path} ${account}`
  }
  if (event === 'upstream_closed') {
    return `WSS上游连接已关闭: ${path} ${account}`
  }
  return `WSS状态变化: ${event ?? 'unknown'} ${path} ${account}`
}

function formatWebSocketMessage(record: Record<string, unknown> | undefined): string {
  const direction = stringValue(record, 'direction')
  const path = stringValue(record, 'path') ?? '/'
  const kind = stringValue(record, 'kind') ?? 'message'
  const text = stringValue(record, 'text') ?? ''
  const side = direction === 'codex-to-upstream' ? 'Codex->ChatGPT' : 'ChatGPT->Codex'
  const label =
    kind === 'user'
      ? '用户指令'
      : kind === 'assistant'
        ? 'AI回复'
        : kind === 'tool'
          ? '工具事件'
          : kind === 'heartbeat'
            ? '连接保活'
            : kind === 'error'
              ? '错误事件'
              : 'WSS消息'
  return `${label}: ${text} ${side} ${path} ${accountText(record)}`
}

function accountText(record: Record<string, unknown> | undefined): string {
  const label = stringValue(record, 'accountLabel')
  const accountId = stringValue(record, 'accountId') ?? 'none'
  return label ? `account=${label}(${accountId})` : `account=${accountId}`
}

function usageText(record: Record<string, unknown> | undefined): string {
  const usage = stringValue(record, 'usage')
  return usage ? `usage="${usage}"` : ''
}

function describeEndpoint(path: string): string {
  if (path.includes('/codex/responses/compact') || path.includes('/v1/responses/compact')) {
    return '上下文压缩'
  }
  if (path.includes('/codex/responses')) {
    return '主聊天WSS'
  }
  if (path.includes('/codex/models') || path.includes('/v1/models')) {
    return '模型列表'
  }
  if (path.includes('/analytics-events/events')) {
    return 'Codex统计事件'
  }
  if (path.includes('/wham/usage')) {
    return '账户额度查询'
  }
  if (path.includes('/plugins/featured')) {
    return '插件列表'
  }
  if (path.includes('/connectors/directory/list')) {
    return '连接器目录'
  }
  if (path.includes('/wham/apps')) {
    return 'ChatGPT应用列表'
  }
  return '账号后端接口'
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function stringValue(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key]
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number') {
    return String(value)
  }
  return undefined
}

function numberValue(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key]
  return typeof value === 'number' ? value : undefined
}

function booleanText(value: unknown): string {
  return value === true ? 'on' : 'off'
}

function formatProxyCliHelp(): string {
  return [
    'Usage: bun run proxy -- [options]',
    '',
    'Options:',
    '  --host <host>              Listen host. Defaults to saved config host.',
    `  --port <port>              Listen port. Defaults to ${defaultCliPort}.`,
    '  --config <path>            Proxy config path.',
    '  --data-dir <path>          Data directory for config, ledger, and auth pool.',
    '  --auth-pool-dir <path>     Managed auth-pool directory.',
    '  --raw-capture              Enable debug packet and WebSocket frame files.',
    '  --no-raw-capture           Disable debug packet files. This is the CLI default.',
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
