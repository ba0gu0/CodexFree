import { stderr, stdout } from 'node:process'
import type { ProxyLedger } from './ledger'
import type { LogEventLevel } from './ledger-types'

export interface ProxyLoggerOptions {
  debug: boolean
  prefix: 'proxy' | 'daemon'
}

export function createProxyLogger(
  ledger: ProxyLedger,
  options: ProxyLoggerOptions
): {
  error(message: string, data?: unknown): void
  info(message: string, data?: unknown): void
  warn(message: string, data?: unknown): void
} {
  return {
    info: (message, data) => emit('info', message, data),
    warn: (message, data) => emit('warn', message, data),
    error: (message, data) => emit('error', message, data)
  }

  function emit(level: LogEventLevel, message: string, data?: unknown): void {
    const meta = extractLogMeta(data)
    ledger.recordLogEvent(
      {
        level,
        message,
        detail: data,
        requestId: meta.requestId,
        accountId: meta.accountId,
        conversationKey: meta.conversationKey,
        path: meta.path,
        method: meta.method
      },
      new Date()
    )

    if (!options.debug) {
      return
    }

    const target = level === 'error' ? stderr : stdout
    target.write(`[${options.prefix}:${level}] ${formatProxyLog(message, data)}\n`)
  }
}

function extractLogMeta(data: unknown): {
  accountId?: string
  conversationKey?: string
  method?: string
  path?: string
  requestId?: string
} {
  if (typeof data !== 'object' || data === null) {
    return {}
  }

  const record = data as Record<string, unknown>
  return {
    requestId: stringValue(record.id) ?? stringValue(record.requestId),
    accountId: stringValue(record.accountId),
    conversationKey: stringValue(record.conversationKey),
    path: stringValue(record.path),
    method: stringValue(record.method)
  }
}

function formatProxyLog(message: string, data: unknown): string {
  const record = asRecord(data)
  if (message === 'Transparent proxy started') {
    return [
      `代理已启动: ${recordString(record, 'endpoint') ?? 'unknown'}`,
      `upstream=${recordString(record, 'upstreamBaseUrl') ?? 'unknown'}`,
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
  if (message === 'Switched active account after auth failure') {
    return `认证失效后已切换账户: ${accountText(record)} ${usageText(record)}`
  }
  if (message === 'Auth failed; disabling account') {
    return `发现账号认证失效: ${accountText(record)} status=${
      numberValue(record, 'statusCode') ?? 'unknown'
    }，已禁用并准备换号`
  }
  if (message === 'Usage limit reached; marking account exhausted') {
    return `发现 usage_limit_reached: ${accountText(record)} used=${
      recordString(record, 'used') ?? 'unknown'
    } reset=${recordString(record, 'resetsAt') ?? 'unknown'}，已标记耗尽`
  }
  if (message === 'No replacement account is available after usage limit') {
    return `额度耗尽但没有可切换账户: ${accountText(record)}`
  }
  if (message === 'Waiting for active account switch') {
    return `等待账号切换完成: ${accountText(record)}`
  }
  if (message === 'Active account switch lock expired') {
    return `账号切换锁已超时释放: ageMs=${recordString(record, 'ageMs') ?? 'unknown'}`
  }
  if (message === 'HTTP forward') {
    const method = recordString(record, 'method') ?? 'GET'
    const path = recordString(record, 'path') ?? '/'
    const body = recordString(record, 'body')
    return [
      `转发HTTP请求: ${method} ${path}`,
      `(${describeEndpoint(path)})`,
      `-> ${recordString(record, 'targetHost') ?? 'unknown'}`,
      accountText(record),
      body ? `body="${body}"` : undefined
    ]
      .filter(Boolean)
      .join(' ')
  }
  if (message === 'HTTP result') {
    const path = recordString(record, 'path') ?? '/'
    const body = recordString(record, 'body')
    const error = recordString(record, 'errorMessage')
    const statusCode = numberValue(record, 'statusCode') ?? recordString(record, 'statusCode')
    return [
      `HTTP响应: ${statusCode ?? 'unknown'} ${path}`,
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
    const path = recordString(record, 'path') ?? '/'
    return `WSS客户端已连接: ${path} ${accountText(record)} ${usageText(record)}`
  }
  if (message === 'WSS lifecycle') {
    return formatWebSocketLifecycle(record)
  }
  if (message === 'WSS message') {
    return formatWebSocketMessage(record)
  }
  if (message === 'Ledger updated from usage response') {
    const plan = recordString(record, 'planType') ?? 'unknown'
    return `额度查询结果: ${accountText(record)} plan=${plan} used=${
      recordString(record, 'primaryUsedPercent') ?? 'unknown'
    } reset=${recordString(record, 'rateLimitResetsAt') ?? 'unknown'}`
  }
  if (message === 'Daemon admin API started') {
    return `管理接口已启动: ${recordString(record, 'endpoint') ?? 'unknown'}`
  }

  return data === undefined ? message : `${message} ${truncateText(safeJson(data), 50)}`
}

function formatWebSocketLifecycle(record: Record<string, unknown> | undefined): string {
  const phase = recordString(record, 'phase') ?? 'unknown'
  const path = recordString(record, 'path') ?? '/'
  if (phase === 'client_connected') {
    return `WSS客户端已连接: ${path} ${accountText(record)} ${usageText(record)}`
  }
  if (phase === 'upstream_connecting') {
    return `WSS开始连接ChatGPT: ${path} ${accountText(record)}`
  }
  if (phase === 'upstream_connected') {
    const statusCode = numberValue(record, 'statusCode') ?? 'unknown'
    return `WSS已连接ChatGPT: ${path} status=${statusCode} ${accountText(record)}`
  }
  if (phase === 'upstream_closed') {
    return `WSS上游连接已关闭: ${path} ${accountText(record)}`
  }
  if (phase === 'quota_frame_suppressed') {
    return `已拦截 usage_limit_reached 响应并结束当前WSS: ${path} ${accountText(record)}`
  }
  if (phase === 'terminal_quota_forwarded') {
    return `已返回最终 usage_limit_reached 响应并结束当前WSS: ${path} ${accountText(record)}`
  }
  if (phase === 'ping') {
    return `连接保活: 上游发送 ping 保活 ChatGPT->Codex ${path} ${accountText(record)}`
  }
  if (phase === 'pong') {
    return `连接保活: 上游返回 pong 保活 Codex->ChatGPT ${path} ${accountText(record)}`
  }
  return `${phase} ${path} ${accountText(record)}`
}

function formatWebSocketMessage(record: Record<string, unknown> | undefined): string {
  const direction = recordString(record, 'direction') ?? 'unknown'
  const kind = recordString(record, 'kind') ?? 'unknown'
  const text = recordString(record, 'text') ?? ''
  const account = accountText(record)
  const path = recordString(record, 'path') ?? '/'
  if (direction === 'codex-to-upstream' && kind === 'user') {
    return `WSS用户请求: ${path} ${account} ${text}`
  }
  if (direction === 'upstream-to-codex' && kind === 'assistant') {
    return `WSS AI 回复: ${path} ${account} ${text}`
  }
  if (direction === 'upstream-to-codex' && kind === 'tool') {
    return `WSS工具事件: ${path} ${account} ${text}`
  }
  if (direction === 'upstream-to-codex' && kind === 'error') {
    return `WSS上游错误: ${path} ${account} ${text}`
  }
  if (direction === 'upstream-to-codex' && kind === 'heartbeat') {
    return `WSS心跳: ${path} ${account} ${text}`
  }
  return `WSS消息: ${path} ${account} ${kind} ${text}`
}

function accountText(record: Record<string, unknown> | undefined): string {
  const accountId = recordString(record, 'accountId') ?? 'unknown'
  const label = recordString(record, 'accountLabel')
  return label ? `account=${accountId} label=${label}` : `account=${accountId}`
}

function usageText(record: Record<string, unknown> | undefined): string {
  const summary = recordString(record, 'usage')
  if (summary) {
    return summary
  }
  const used =
    recordString(record, 'used') ?? recordString(record, 'primaryUsedPercent') ?? 'unknown'
  const reset =
    recordString(record, 'reset') ?? recordString(record, 'rateLimitResetsAt') ?? 'unknown'
  const plan = recordString(record, 'planType')
  return plan ? `plan=${plan} used=${used} reset=${reset}` : `used=${used} reset=${reset}`
}

function describeEndpoint(path: string): string {
  if (path.includes('/codex/responses/compact') || path.includes('/v1/responses/compact')) {
    return '上下文压缩'
  }
  if (path.includes('/analytics-events/')) return '统计事件'
  if (path.includes('/connectors/')) return '连接器列表'
  if (path.includes('/plugins/')) return '插件目录'
  if (path.includes('/wham/usage')) return '账户额度查询'
  if (path.includes('/wham/apps')) return '应用列表'
  if (path.includes('/responses')) return '主聊天WSS'
  if (path.includes('/models')) return '模型列表'
  return '上游接口'
}

function booleanText(value: unknown): string {
  return value === true ? 'on' : 'off'
}

function numberValue(record: Record<string, unknown> | undefined, key: string): number | undefined {
  if (!record) {
    return undefined
  }
  const value = record[key]
  return typeof value === 'number' ? value : undefined
}

function recordString(
  record: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  return stringValue(record?.[key])
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }
  return typeof value === 'number' ? String(value) : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
