import { mkdirSync } from 'node:fs'
import http, { type IncomingMessage, type RequestOptions, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Duplex } from 'node:stream'
import { ProxyAgent } from 'proxy-agent'
import { AccountPool, type RoutedAccount } from './account-pool'
import { formatAccountUsageText } from './account-usage-text'
import { parseJsonRecord, summarizeBuffer } from './json-utils'
import type { ProxyLedger } from './ledger'
import {
  normalizeDisplayHost,
  normalizeOutboundProxyUrl,
  resolveAccountUpstreamPath
} from './path-utils'
import { ProtocolMessageLogger } from './protocol-message-logger'
import { formatQuotaLedgerMessage, type QuotaExhaustionEvent } from './quota'
import { handleProxyHttpRequest } from './service-http'
import { handleProxyUpgrade } from './service-upgrade'
import type { ForwardResult } from './transport-http'
import { closeUpgradedSocket } from './transport-utils'
import type { ProxyAccountSwitchResult, ProxyConfig, ProxyStatus } from './types'
import { extractUsageResponse, isUsageExhausted, type UsageSnapshot } from './usage-response'
import type { CapturedWebSocketFrame } from './websocket-capture'

export class TransparentProxyService {
  private static readonly accountSwitchTimeoutMs = 10_000
  private server?: http.Server
  config: ProxyConfig
  private lastError?: string
  private accountPool: AccountPool
  private accountSwitchPromise?: Promise<RoutedAccount | undefined>
  private accountSwitchStartedAt = 0
  private readonly upgradedSockets = new Set<Duplex>()
  private readonly protocolLogger: ProtocolMessageLogger
  private outboundProxyAgent?: ProxyAgent
  private outboundProxyAgentKey?: string
  readonly rawCaptureDir: string
  constructor(
    initialConfig: ProxyConfig,
    readonly ledger: ProxyLedger,
    readonly log: {
      info: (message: string, data?: unknown) => void
      warn: (message: string, data?: unknown) => void
      error: (message: string, data?: unknown) => void
    },
    rawCaptureDir?: string
  ) {
    this.config = initialConfig
    this.accountPool = this.loadAccountPool(initialConfig)
    this.protocolLogger = new ProtocolMessageLogger(ledger, log)
    this.rawCaptureDir = rawCaptureDir ?? join(tmpdir(), 'CodexFree', 'raw-captures')
    mkdirSync(this.rawCaptureDir, { recursive: true, mode: 0o700 })
  }

  async start(config = this.config): Promise<ProxyStatus> {
    await this.stop()
    this.config = config
    this.accountPool = this.loadAccountPool(config)

    this.server = http.createServer((request, response) => {
      this.handleRequest(request, response).catch((error: unknown) => {
        this.lastError = error instanceof Error ? error.message : String(error)
        this.log.error('Transparent proxy request failed', { error: this.lastError })
        if (!response.headersSent) {
          response.writeHead(502, { 'content-type': 'application/json' })
        }
        response.end(JSON.stringify({ error: 'proxy_forward_failed' }))
      })
    })
    this.server.on('upgrade', (request, socket, head) => {
      this.upgradedSockets.add(socket)
      socket.once('close', () => this.upgradedSockets.delete(socket))
      this.handleUpgrade(request, socket, head).catch((error: unknown) => {
        this.lastError = error instanceof Error ? error.message : String(error)
        this.log.error('Transparent proxy upgrade failed', { error: this.lastError })
        socket.destroy()
      })
    })

    try {
      await new Promise<void>((resolve, reject) => {
        this.server?.once('error', reject)
        this.server?.listen(config.listenPort, config.listenHost, resolve)
      })
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      this.server = undefined
      throw error
    }

    this.lastError = undefined
    this.log.info('Transparent proxy started', this.status())
    return this.status()
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return
    }
    if (!this.server.listening) {
      this.server.removeAllListeners()
      this.server = undefined
      return
    }

    for (const socket of this.upgradedSockets) {
      closeUpgradedSocket(socket)
    }
    this.upgradedSockets.clear()

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

  switchActiveAccountAndCloseWebSockets(accountId?: string): ProxyAccountSwitchResult {
    const account = this.accountPool.selectActiveAccount(accountId)
    if (!account) {
      this.log.warn('Manual account switch requested but target account is unavailable', {
        accountId
      })
      return { accountId, closedWebSockets: 0, switched: false }
    }

    this.ledger.setActiveAccount(account.accountId)
    const closedWebSockets = this.upgradedSockets.size
    for (const socket of this.upgradedSockets) {
      closeUpgradedSocket(socket)
    }
    this.upgradedSockets.clear()
    this.log.info('Manual account switch requested; closed upgraded sockets', {
      accountId: account.accountId,
      accountLabel: account.label,
      closedWebSockets
    })
    return { accountId: account.accountId, closedWebSockets, switched: true }
  }

  status(): ProxyStatus {
    const address = this.server?.address()
    const host =
      typeof address === 'object' && address !== null
        ? normalizeDisplayHost(address)
        : this.config.listenHost
    const port =
      typeof address === 'object' && address !== null ? address.port : this.config.listenPort

    const accountPoolStatus = this.accountPool.status(this.config.authPool.enabled)
    const origin = `http://${host}:${port}`
    const cpuUsage = process.cpuUsage()
    const memoryUsage = process.memoryUsage()
    return {
      running: this.server?.listening ?? false,
      endpoint: `${origin}/backend-api`,
      openaiBaseUrl: `${origin}/backend-api/codex`,
      openaiCompatibleEndpoint: `${origin}/v1`,
      upstreamBaseUrl: this.config.upstreamBaseUrl,
      outboundMode: this.config.outboundProxy.mode,
      authPoolEnabled: accountPoolStatus.enabled,
      authPoolAccounts: accountPoolStatus.totalAccounts,
      authPoolAvailableAccounts: accountPoolStatus.availableAccounts,
      authPoolExhaustedAccounts: accountPoolStatus.exhaustedAccounts,
      authPoolDisabledAccounts: accountPoolStatus.disabledAccounts,
      rawCaptureEnabled: this.config.rawCaptureEnabled,
      rawCaptureDir: this.rawCaptureDir,
      runtime: {
        activeWebSocketSessions: this.upgradedSockets.size,
        cpuSystemMicros: cpuUsage.system,
        cpuUserMicros: cpuUsage.user,
        memoryRssBytes: memoryUsage.rss,
        uptimeSeconds: process.uptime()
      },
      lastError: this.lastError
    }
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    return handleProxyHttpRequest(this, request, response)
  }

  writeDeferredHttpResponse(response: ServerResponse, result: ForwardResult): void {
    if (!result.deferredBody) {
      return
    }

    response.writeHead(result.statusCode ?? 502, result.responseHeaders ?? {})
    response.end(result.deferredBody)
  }

  markHttpQuotaExhausted(
    requestId: string,
    accountId: string | undefined,
    conversationKey: string | undefined,
    event: QuotaExhaustionEvent
  ): void {
    this.accountPool.markExhausted(accountId, conversationKey)
    const completedAt = new Date()
    const message = formatQuotaLedgerMessage(event)
    this.log.warn('Usage limit reached; marking account exhausted', {
      id: requestId,
      accountId,
      used: event.primaryUsedPercent,
      resetsAt: event.resetsAt
    })
    this.ledger.markQuotaExhausted(requestId, message, completedAt)
    this.ledger.markAccountQuotaExhausted(
      accountId,
      requestId,
      conversationKey,
      event,
      message,
      completedAt
    )
  }

  markHttpAuthFailed(
    requestId: string,
    accountId: string | undefined,
    conversationKey: string | undefined,
    result: ForwardResult
  ): void {
    this.accountPool.markDisabled(accountId, conversationKey)
    if (accountId) {
      this.ledger.setAccountDisabled(accountId, true)
    }
    const message = summarizeBuffer(result.deferredBody ?? result.responseSample ?? Buffer.alloc(0))
    this.log.warn('Auth failed; disabling account', {
      id: requestId,
      accountId,
      statusCode: result.statusCode,
      body: message
    })
    this.ledger.recordRoutingEvent({
      requestId,
      conversationKey,
      accountId,
      eventType: 'auth_failed',
      reason: 'http_401'
    })
  }

  updateUsageFromHttpResponse(
    requestUrl: string | undefined,
    accountId: string | undefined,
    result: ForwardResult
  ): UsageSnapshot | undefined {
    if (!accountId || !requestUrl?.includes('/backend-api/wham/usage')) {
      return undefined
    }

    const body = parseJsonRecord(
      (result.deferredBody ?? result.responseSample ?? Buffer.alloc(0)).toString('utf8')
    )
    const usage = extractUsageResponse(body)
    this.ledger.updateAccountUsage({
      accountId,
      ...usage
    })
    this.log.info('Ledger updated from usage response', {
      accountId,
      planType: usage.planType,
      primaryUsedPercent: usage.primaryUsedPercent,
      secondaryUsedPercent: usage.secondaryUsedPercent,
      rateLimitResetsAt: usage.rateLimitResetsAt
    })
    if (isUsageExhausted(usage.primaryUsedPercent)) {
      this.accountPool.markExhausted(accountId, undefined)
      this.log.warn('Usage limit reached; marking account exhausted', {
        accountId,
        used: usage.primaryUsedPercent,
        resetsAt: usage.rateLimitResetsAt
      })
    }
    return {
      ...usage,
      exhausted: isUsageExhausted(usage.primaryUsedPercent)
    }
  }

  private async handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer
  ): Promise<void> {
    return handleProxyUpgrade(this, request, socket, head)
  }

  logWebSocketFrame(
    requestId: string,
    path: string,
    accountId: string | undefined,
    conversationKey: string | undefined,
    frame: CapturedWebSocketFrame
  ): void {
    this.protocolLogger.logFrame(requestId, path, accountId, conversationKey, frame)
  }

  buildTargetUrl(requestUrl: string): URL {
    const upstream = new URL(this.config.upstreamBaseUrl)
    const parsedRequest = new URL(requestUrl, 'http://codexfree.local')
    upstream.pathname = resolveAccountUpstreamPath(upstream.pathname, parsedRequest.pathname)
    upstream.search = parsedRequest.search
    return upstream
  }

  createRequestOptions(request: IncomingMessage, targetUrl: URL): RequestOptions {
    const headers = { ...request.headers, host: targetUrl.host }
    return {
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      path: `${targetUrl.pathname}${targetUrl.search}`,
      method: request.method,
      headers,
      agent: this.proxyAgent()
    }
  }

  private proxyAgent(): ProxyAgent | undefined {
    if (this.config.outboundProxy.mode === 'direct') {
      return undefined
    }

    const proxyUrl = normalizeOutboundProxyUrl(
      this.config.outboundProxy.mode,
      this.config.outboundProxy.url
    )
    const key = `${this.config.outboundProxy.mode}:${proxyUrl}`
    if (!this.outboundProxyAgent || this.outboundProxyAgentKey !== key) {
      this.outboundProxyAgent = new ProxyAgent({ getProxyForUrl: () => proxyUrl })
      this.outboundProxyAgentKey = key
    }
    return this.outboundProxyAgent
  }

  async routeAccount(
    request: IncomingMessage,
    requestId: string,
    incomingAccountId: string | undefined,
    conversationKey: string | undefined,
    eventType: 'selected' | 'quota_retry_selected' | 'auth_retry_selected' = 'selected'
  ): Promise<RoutedAccount | undefined> {
    await this.waitForAccountSwitch(requestId)
    return this.routeAccountNow(request, requestId, incomingAccountId, conversationKey, eventType)
  }

  routeAccountNow(
    request: IncomingMessage,
    requestId: string,
    incomingAccountId: string | undefined,
    conversationKey: string | undefined,
    eventType: 'selected' | 'quota_retry_selected' | 'auth_retry_selected' = 'selected'
  ): RoutedAccount | undefined {
    if (!this.config.authPool.enabled) {
      return undefined
    }

    const account = this.accountPool.select({ conversationKey, incomingAccountId })
    if (!account) {
      this.log.warn('Auth pool is enabled but no available account was selected', {
        conversationKey,
        incomingAccountId
      })
      this.ledger.recordRoutingEvent({
        requestId,
        conversationKey,
        accountId: incomingAccountId,
        eventType: 'all_accounts_exhausted',
        reason: 'no_available_account'
      })
      return undefined
    }

    request.headers.authorization = account.authorization
    request.headers['chatgpt-account-id'] = account.accountId
    if (account.activeChanged) {
      this.ledger.setActiveAccount(account.accountId)
      if (eventType === 'selected') {
        this.log.info('Active account selected', {
          id: requestId,
          accountId: account.accountId,
          accountLabel: account.label,
          usage: this.accountUsageText(account.accountId)
        })
      }
    }
    this.ledger.recordRoutingEvent({
      requestId,
      conversationKey,
      accountId: account.accountId,
      eventType,
      reason: 'auth_pool'
    })
    return account
  }

  async switchAccountAfterExhaustion(
    request: IncomingMessage,
    requestId: string,
    exhaustedAccountId: string | undefined,
    conversationKey: string | undefined,
    eventType: 'quota_retry_selected'
  ): Promise<RoutedAccount | undefined> {
    const existing = this.freshAccountSwitchPromise()
    if (existing) {
      this.log.info('Waiting for active account switch', {
        id: requestId,
        accountId: exhaustedAccountId
      })
      return existing
    }

    const startedAt = Date.now()
    const promise = Promise.resolve()
      .then(() => {
        this.accountPool.markExhausted(exhaustedAccountId, conversationKey)
        return this.routeAccountNow(
          request,
          requestId,
          exhaustedAccountId,
          conversationKey,
          eventType
        )
      })
      .finally(() => {
        if (this.accountSwitchPromise === promise) {
          this.accountSwitchPromise = undefined
          this.accountSwitchStartedAt = 0
        }
      })
    this.accountSwitchStartedAt = startedAt
    this.accountSwitchPromise = promise
    return promise
  }

  async switchAccountAfterAuthFailure(
    request: IncomingMessage,
    requestId: string,
    failedAccountId: string | undefined,
    conversationKey: string | undefined
  ): Promise<RoutedAccount | undefined> {
    const existing = this.freshAccountSwitchPromise()
    if (existing) {
      this.log.info('Waiting for active account switch', {
        id: requestId,
        accountId: failedAccountId
      })
      return existing
    }

    const startedAt = Date.now()
    const promise = Promise.resolve()
      .then(() => {
        this.accountPool.markDisabled(failedAccountId, conversationKey)
        return this.routeAccountNow(
          request,
          requestId,
          failedAccountId,
          conversationKey,
          'auth_retry_selected'
        )
      })
      .finally(() => {
        if (this.accountSwitchPromise === promise) {
          this.accountSwitchPromise = undefined
          this.accountSwitchStartedAt = 0
        }
      })
    this.accountSwitchStartedAt = startedAt
    this.accountSwitchPromise = promise
    return promise
  }

  private async waitForAccountSwitch(requestId: string): Promise<void> {
    const existing = this.freshAccountSwitchPromise()
    if (!existing) {
      return
    }
    this.log.info('Waiting for active account switch', { id: requestId })
    await existing
  }

  private freshAccountSwitchPromise(): Promise<RoutedAccount | undefined> | undefined {
    if (!this.accountSwitchPromise) {
      return undefined
    }
    const ageMs = Date.now() - this.accountSwitchStartedAt
    if (ageMs <= TransparentProxyService.accountSwitchTimeoutMs) {
      return this.accountSwitchPromise
    }
    this.log.warn('Active account switch lock expired', { ageMs })
    this.accountSwitchPromise = undefined
    this.accountSwitchStartedAt = 0
    return undefined
  }

  accountUsageText(accountId: string | undefined): string | undefined {
    return formatAccountUsageText(this.ledger, accountId)
  }

  availableAccountCount(): number {
    return this.accountPool.status(true).availableAccounts
  }

  private loadAccountPool(config: ProxyConfig): AccountPool {
    try {
      const pool = AccountPool.fromConfig(config.authPool, {
        onWarning: (warning) =>
          this.log.warn('Auth file skipped while loading account pool', warning)
      })
      if (config.authPool.enabled) {
        pool.applyExhaustedAccountIds(this.ledger.exhaustedAccountIds())
        pool.applyDisabledAccountIds(this.ledger.disabledAccountIds())
        this.ledger.syncAccountPool(pool.snapshot())
        pool.applyActiveAccountId(this.ledger.activeAccountId())
      }
      return pool
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.log.warn('Failed to load auth pool; account routing is disabled', { error: message })
      return AccountPool.disabled()
    }
  }
}
