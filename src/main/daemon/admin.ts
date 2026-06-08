import { createHash, timingSafeEqual } from 'node:crypto'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type {
  AccountPoolSnapshot,
  AccountUsageInput,
  LogEventInput,
  LogEventRow,
  ManagedAccountRow,
  ProtocolMessageRow,
  TurnSummaryRow
} from '../proxy/ledger-types'
import { clearRawCaptures } from '../proxy/raw-capture'
import type {
  ActivityPage,
  ProxyAccountSwitchResult,
  ProxyConfig,
  ProxyStatus,
  RecentRequest,
  RequestSummary,
  UsageSummary
} from '../proxy/types'

const maxJsonBodyBytes = 1_048_576

export interface AdminProxyService {
  readonly rawCaptureDir: string
  refreshAccountPool(): ProxyStatus
  refreshAccountState(): ProxyStatus
  removeAccountsFromPool(accountIds: string[]): ProxyStatus
  status(): ProxyStatus
  switchActiveAccountAndCloseWebSockets(accountId?: string): ProxyAccountSwitchResult
}

export interface AdminLedger {
  accounts(): ManagedAccountRow[]
  clear(): number
  deleteAccounts(accountIds: string[]): number
  recentLogEvents(limit?: number): LogEventRow[]
  recentProtocolMessages(limit?: number): ProtocolMessageRow[]
  recentTurnSummaries(limit?: number): TurnSummaryRow[]
  recent(limit?: number): RecentRequest[]
  requestSummary(): RequestSummary
  recordLogEvent(input: LogEventInput): void
  resetExhaustedAccounts(accountIds?: string[]): number
  setAccountDisabled(accountId: string, disabled: boolean): number
  syncAccountPool(accounts: AccountPoolSnapshot[]): void
  updateAccountUsage(input: AccountUsageInput): void
  usageSummary(): UsageSummary
}

export interface DaemonAdminServerOptions {
  host: string
  ledger: AdminLedger
  port: number
  readConfig: () => ProxyConfig
  service: AdminProxyService
  token: string
  writeConfig: (config: ProxyConfig) => ProxyConfig
}

export interface DaemonAdminStatus {
  endpoint: string
  host: string
  port: number
  running: boolean
}

export class DaemonAdminServer {
  private server?: http.Server

  constructor(private readonly options: DaemonAdminServerOptions) {}

  async start(): Promise<DaemonAdminStatus> {
    await this.stop()
    this.server = http.createServer((request, response) => {
      this.handle(request, response).catch((error: unknown) => {
        const statusCode = error instanceof AdminRequestError ? error.statusCode : 500
        writeJson(response, statusCode, {
          error: 'admin_request_failed',
          message: error instanceof Error ? error.message : String(error)
        })
      })
    })
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject)
      this.server?.listen(this.options.port, this.options.host, resolve)
    })
    return this.status()
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return
    }
    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
    this.server = undefined
  }

  status(): DaemonAdminStatus {
    const address = this.server?.address()
    const host =
      typeof address === 'object' && address !== null ? displayHost(address) : this.options.host
    const port = typeof address === 'object' && address !== null ? address.port : this.options.port
    return {
      endpoint: `http://${host}:${port}/admin`,
      host,
      port,
      running: this.server?.listening ?? false
    }
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://codexfree.local')
    if (!this.authorized(request)) {
      writeJson(response, 401, { error: 'admin_auth_required' })
      return
    }

    if (request.method === 'GET' && url.pathname === '/admin/status') {
      writeJson(response, 200, {
        admin: this.status(),
        proxy: this.options.service.status()
      })
      return
    }
    if (request.method === 'GET' && url.pathname === '/admin/config') {
      writeJson(response, 200, { config: this.options.readConfig() })
      return
    }
    if (request.method === 'PUT' && url.pathname === '/admin/config') {
      const config = (await readJsonBody(request)) as ProxyConfig
      const saved = this.options.writeConfig(config)
      this.auditMutation(request.method, url.pathname, configAuditDetail(saved))
      writeJson(response, 200, { config: saved })
      return
    }
    if (request.method === 'GET' && url.pathname === '/admin/accounts') {
      writeJson(response, 200, { accounts: this.options.ledger.accounts() })
      return
    }
    if (request.method === 'GET' && url.pathname === '/admin/request-summary') {
      writeJson(response, 200, { summary: this.options.ledger.requestSummary() })
      return
    }
    if (request.method === 'GET' && url.pathname === '/admin/usage-summary') {
      writeJson(response, 200, { summary: this.options.ledger.usageSummary() })
      return
    }
    if (request.method === 'POST' && url.pathname === '/admin/accounts/sync') {
      const body = (await readJsonBody(request)) as { accounts?: AccountPoolSnapshot[] }
      this.options.ledger.syncAccountPool(body.accounts ?? [])
      const status = this.options.service.refreshAccountPool()
      this.auditMutation(request.method, url.pathname, { accountCount: body.accounts?.length ?? 0 })
      writeJson(response, 200, { accounts: this.options.ledger.accounts(), status })
      return
    }
    if (request.method === 'POST' && url.pathname === '/admin/accounts/usage') {
      const body = (await readJsonBody(request)) as {
        results?: Array<AccountUsageInput & { error?: string }>
      }
      for (const result of body.results ?? []) {
        this.options.ledger.updateAccountUsage({
          accountId: result.accountId,
          email: result.email,
          label: result.label,
          lastUsageError: result.error ?? result.lastUsageError,
          planType: result.planType,
          primaryUsedPercent: result.primaryUsedPercent,
          rateLimitResetsAt: result.rateLimitResetsAt,
          secondaryRateLimitResetsAt: result.secondaryRateLimitResetsAt,
          secondaryUsedPercent: result.secondaryUsedPercent
        })
      }
      const status = this.options.service.refreshAccountState()
      this.auditMutation(request.method, url.pathname, { resultCount: body.results?.length ?? 0 })
      writeJson(response, 200, { accounts: this.options.ledger.accounts(), status })
      return
    }
    if (request.method === 'POST' && url.pathname === '/admin/accounts/reset-exhausted') {
      const resetAccounts = this.options.ledger.resetExhaustedAccounts()
      const status = this.options.service.refreshAccountState()
      this.auditMutation(request.method, url.pathname, { resetAccounts })
      writeJson(response, 200, { accounts: this.options.ledger.accounts(), resetAccounts, status })
      return
    }
    if (request.method === 'POST' && url.pathname === '/admin/accounts/switch') {
      const body = (await readJsonBody(request)) as { accountId?: string }
      const result = this.options.service.switchActiveAccountAndCloseWebSockets(body.accountId)
      this.auditMutation(request.method, url.pathname, result)
      writeJson(response, result.switched ? 200 : 404, {
        accounts: this.options.ledger.accounts(),
        result
      })
      return
    }
    if (request.method === 'POST' && url.pathname === '/admin/accounts/disable') {
      const body = (await readJsonBody(request)) as { accountId?: string; disabled?: boolean }
      if (!body.accountId) {
        writeJson(response, 400, { error: 'account_id_required' })
        return
      }
      const updatedAccounts = this.options.ledger.setAccountDisabled(
        body.accountId,
        body.disabled === true
      )
      this.auditMutation(request.method, url.pathname, {
        accountId: body.accountId,
        disabled: body.disabled === true,
        updatedAccounts
      })
      const status = this.options.service.refreshAccountState()
      writeJson(response, 200, {
        accounts: this.options.ledger.accounts(),
        status,
        updatedAccounts
      })
      return
    }
    if (request.method === 'POST' && url.pathname === '/admin/accounts/delete') {
      const body = (await readJsonBody(request)) as { accountIds?: string[] }
      const accountIds = body.accountIds ?? []
      const deletedAccounts = this.options.ledger.deleteAccounts(accountIds)
      const status = this.options.service.removeAccountsFromPool(accountIds)
      this.auditMutation(request.method, url.pathname, {
        requestedAccounts: accountIds.length,
        deletedAccounts
      })
      writeJson(response, 200, {
        accounts: this.options.ledger.accounts(),
        deletedAccounts,
        status
      })
      return
    }
    if (request.method === 'GET' && url.pathname === '/admin/requests') {
      const limit = normalizeListLimit(url.searchParams.get('limit'), 20)
      const page = pageFromRows(this.options.ledger.recent(limit + 1), limit)
      writeJson(response, 200, { hasMore: page.hasMore, requests: page.items })
      return
    }
    if (request.method === 'GET' && url.pathname === '/admin/log-events') {
      const limit = normalizeListLimit(url.searchParams.get('limit'), 50)
      const page = pageFromRows(this.options.ledger.recentLogEvents(limit + 1), limit)
      writeJson(response, 200, { events: page.items, hasMore: page.hasMore })
      return
    }
    if (request.method === 'GET' && url.pathname === '/admin/protocol-messages') {
      const limit = normalizeListLimit(url.searchParams.get('limit'), 50)
      const page = pageFromRows(this.options.ledger.recentProtocolMessages(limit + 1), limit)
      writeJson(response, 200, { hasMore: page.hasMore, messages: page.items })
      return
    }
    if (request.method === 'GET' && url.pathname === '/admin/turn-summaries') {
      const limit = normalizeListLimit(url.searchParams.get('limit'), 50)
      const page = pageFromRows(this.options.ledger.recentTurnSummaries(limit + 1), limit)
      writeJson(response, 200, { hasMore: page.hasMore, summaries: page.items })
      return
    }
    if (request.method === 'POST' && url.pathname === '/admin/clear-records') {
      const deletedRequests = this.options.ledger.clear()
      const { deletedEntries } = clearRawCaptures(this.options.service.rawCaptureDir)
      this.auditMutation(request.method, url.pathname, {
        deletedCaptureEntries: deletedEntries,
        deletedRequests
      })
      writeJson(response, 200, { deletedCaptureEntries: deletedEntries, deletedRequests })
      return
    }

    writeJson(response, 404, { error: 'admin_not_found' })
  }

  private auditMutation(method: string, path: string, detail?: unknown): void {
    this.options.ledger.recordLogEvent({
      detail,
      eventType: 'system',
      level: 'info',
      message: 'Admin API mutation',
      method,
      path
    })
  }

  private authorized(request: IncomingMessage): boolean {
    const auth = firstHeader(request.headers.authorization)
    const bearer = auth?.toLowerCase().startsWith('bearer ') ? auth.slice(7) : undefined
    const headerToken = firstHeader(request.headers['x-codexfree-admin-token'])
    return (
      secureTokenEqual(bearer, this.options.token) ||
      secureTokenEqual(headerToken, this.options.token)
    )
  }
}

class AdminRequestError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message)
    this.name = 'AdminRequestError'
  }
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function displayHost(address: AddressInfo): string {
  return address.address === '::' ? '[::]' : address.address
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, { 'content-type': 'application/json' })
  response.end(JSON.stringify(payload))
}

function normalizeListLimit(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return Math.max(1, Math.min(1_000, parsed))
}

function pageFromRows<T>(rows: T[], limit: number): ActivityPage<T> {
  return {
    hasMore: rows.length > limit,
    items: rows.slice(0, limit)
  }
}

function configAuditDetail(config: ProxyConfig): {
  authPoolEnabled: boolean
  listenHost: string
  listenPort: number
  maxRequestBodyBytes: number
  outboundMode: string
  rawCaptureEnabled: boolean
} {
  return {
    authPoolEnabled: config.authPool.enabled,
    listenHost: config.listenHost,
    listenPort: config.listenPort,
    maxRequestBodyBytes: config.maxRequestBodyBytes,
    outboundMode: config.outboundProxy.mode,
    rawCaptureEnabled: config.rawCaptureEnabled
  }
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytes = 0
    let rejected = false
    request.on('data', (chunk: Buffer) => {
      if (rejected) {
        return
      }
      bytes += chunk.byteLength
      if (bytes > maxJsonBodyBytes) {
        rejected = true
        reject(new AdminRequestError(413, 'admin request body too large'))
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (rejected) {
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error)
      }
    })
    request.on('error', reject)
  })
}

function secureTokenEqual(candidate: string | undefined, expected: string): boolean {
  if (!candidate) {
    return false
  }

  const candidateHash = createHash('sha256').update(candidate).digest()
  const expectedHash = createHash('sha256').update(expected).digest()
  return timingSafeEqual(candidateHash, expectedHash)
}
