import { createHash } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { classifyProxyRequest } from './classification'
import { analyzeHttpTraffic } from './http-analysis'
import { safeJson, summarizeBuffer } from './json-utils'
import { isWhamRemotePath } from './path-utils'
import { formatQuotaLedgerMessage, type QuotaExhaustionEvent } from './quota'
import { createRawCapture } from './raw-capture'
import { createRequestId, fingerprint, firstHeaderValue, redactHeaders } from './redaction'
import type { ProxyHandlerContext } from './service-context'
import { createTerminalQuotaPayload } from './terminal-quota'
import { forwardUpgradeRequest, type WebSocketLifecycleEvent } from './transport'
import { createServerTextFrame, formatHttpResponse, formatUpgradeResponse } from './transport-utils'
import type { RequestLedgerEntry } from './types'

export async function handleProxyUpgrade(
  ctx: ProxyHandlerContext,
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer
): Promise<void> {
  const startedAt = new Date()
  const requestId = createRequestId()
  const targetUrl = ctx.buildTargetUrl(request.url ?? '/')
  const rawCapture = createRawCapture(
    ctx.rawCaptureDir,
    requestId,
    ctx.config.rawCaptureEnabled,
    ctx.config.rawCaptureMaxBytes
  )
  rawCapture?.writeRequest(request.method ?? 'GET', request.url ?? '/', request.headers, head)
  const requestAnalysis = analyzeHttpTraffic({
    method: request.method,
    path: request.url,
    requestBody: head,
    requestHeaders: request.headers
  })
  const authHeader = firstHeaderValue(request.headers.authorization)
  const cookieHeader = firstHeaderValue(request.headers.cookie)
  const accountId = firstHeaderValue(request.headers['chatgpt-account-id'])
  const conversationKey =
    firstHeaderValue(request.headers.thread_id) ??
    firstHeaderValue(request.headers.session_id) ??
    firstHeaderValue(request.headers['x-client-request-id'])
  const classification = classifyProxyRequest(request.url ?? '/', request.headers)
  if (!classification.allowed) {
    rejectUpgrade(ctx, {
      accountId,
      authHeader,
      classification,
      completedAt: new Date(),
      conversationKey,
      cookieHeader,
      head,
      rawCapture,
      request,
      requestId,
      socket,
      startedAt
    })
    return
  }

  const preserveOriginalAuth = isWhamRemotePath(request.url)
  const useAccountRules = classification.mode === 'account' && !preserveOriginalAuth
  if (useAccountRules && ctx.config.authPool.enabled && ctx.availableAccountCount() === 0) {
    const terminalQuota = createTerminalQuotaPayload(ctx.ledger, accountId)
    ctx.ledger.recordRoutingEvent({
      requestId,
      conversationKey,
      accountId: terminalQuota.accountId ?? accountId,
      eventType: 'all_accounts_exhausted',
      reason: 'no_available_account'
    })
    finishUpgradeWithTerminalQuota(ctx, {
      accountId,
      authHeader,
      completedAt: new Date(),
      conversationKey,
      cookieHeader,
      head,
      rawCapture,
      request,
      requestId,
      socket,
      startedAt,
      terminalAccountId: terminalQuota.accountId,
      terminalBody: terminalQuota.body
    })
    return
  }
  const routedAccount = preserveOriginalAuth
    ? undefined
    : await ctx.routeAccount(request, requestId, accountId, conversationKey)
  if (useAccountRules && ctx.config.authPool.enabled && !routedAccount) {
    const terminalQuota = createTerminalQuotaPayload(ctx.ledger, accountId)
    finishUpgradeWithTerminalQuota(ctx, {
      accountId,
      authHeader,
      completedAt: new Date(),
      conversationKey,
      cookieHeader,
      head,
      rawCapture,
      request,
      requestId,
      socket,
      startedAt,
      terminalAccountId: terminalQuota.accountId,
      terminalBody: terminalQuota.body
    })
    return
  }
  rawCapture?.writeOutboundRequest(ctx.createRequestOptions(request, targetUrl), head)
  let terminalQuotaMessage: string | undefined
  let routedAuthHeader = routedAccount?.authorization ?? authHeader
  let routedAccountId = routedAccount?.accountId ?? accountId
  let suppressedRetryCloseLogs = 0

  const markQuotaExhausted = (event: QuotaExhaustionEvent) => {
    ctx.markHttpQuotaExhausted(requestId, routedAccountId, conversationKey, event)
  }
  const retryWithNextAccount = (event: QuotaExhaustionEvent) => {
    markQuotaExhausted(event)
    const nextAccount = ctx.routeAccountNow(
      request,
      requestId,
      routedAccountId,
      conversationKey,
      'quota_retry_selected'
    )
    if (!nextAccount) {
      ctx.log.warn('No replacement account is available after usage limit', {
        id: requestId,
        accountId: routedAccountId
      })
      ctx.ledger.recordRoutingEvent({
        requestId,
        conversationKey,
        accountId: routedAccountId,
        eventType: 'all_accounts_exhausted',
        reason: event.errorType
      })
      terminalQuotaMessage = formatQuotaLedgerMessage(event)
      return undefined
    }
    terminalQuotaMessage = undefined
    routedAuthHeader = nextAccount.authorization
    routedAccountId = nextAccount.accountId
    suppressedRetryCloseLogs += 1
    ctx.log.info('Switched active account after usage limit', {
      id: requestId,
      accountId: routedAccountId,
      accountLabel: nextAccount.label,
      usage: ctx.accountUsageText(routedAccountId)
    })
    return ctx.createRequestOptions(request, targetUrl)
  }
  const hasReplacementAfterQuota = (event: QuotaExhaustionEvent) => {
    markQuotaExhausted(event)
    const hasReplacement = ctx.availableAccountCount() > 0
    if (!hasReplacement) {
      ctx.log.warn('No replacement account is available after usage limit', {
        id: requestId,
        accountId: routedAccountId
      })
      ctx.ledger.recordRoutingEvent({
        requestId,
        conversationKey,
        accountId: routedAccountId,
        eventType: 'all_accounts_exhausted',
        reason: event.errorType
      })
      terminalQuotaMessage = formatQuotaLedgerMessage(event)
    }
    return hasReplacement
  }
  const logLifecycle = (event: WebSocketLifecycleEvent) => {
    if (event.type === 'upstream_connecting') {
      return
    }
    if (event.type === 'upstream_closed' && suppressedRetryCloseLogs > 0) {
      suppressedRetryCloseLogs -= 1
      return
    }
    ctx.log.info('WSS lifecycle', {
      id: requestId,
      path: request.url,
      accountId: routedAccountId,
      conversationKey,
      phase: event.type,
      statusCode: event.statusCode
    })
  }
  const markTerminalQuotaExhausted = (event: QuotaExhaustionEvent) => {
    const message = formatQuotaLedgerMessage(event)
    if (terminalQuotaMessage === message) {
      return
    }
    terminalQuotaMessage = message
    markQuotaExhausted(event)
  }

  const upstreamResult = await forwardUpgradeRequest(
    ctx.createRequestOptions(request, targetUrl),
    socket,
    head,
    rawCapture,
    ctx.config.rawCaptureMaxBytes,
    useAccountRules ? markTerminalQuotaExhausted : undefined,
    useAccountRules && ctx.config.authPool.enabled ? retryWithNextAccount : undefined,
    useAccountRules && ctx.config.authPool.enabled ? hasReplacementAfterQuota : undefined,
    (frame) =>
      ctx.logWebSocketFrame(requestId, request.url ?? '/', routedAccountId, conversationKey, frame),
    logLifecycle,
    useAccountRules && ctx.config.authPool.enabled
      ? async () => {
          const result = await ctx.guardWebSocketResponseCreate(
            requestId,
            routedAccountId,
            conversationKey
          )
          if (result.action === 'terminal_quota') {
            terminalQuotaMessage = formatQuotaLedgerMessage(result.event)
          }
          return result
        }
      : undefined
  )
  const completedAt = new Date()
  ctx.ledger.insert({
    ...requestAnalysis,
    id: requestId,
    accountId: routedAccountId,
    conversationKey,
    method: request.method ?? 'GET',
    path: request.url ?? '/',
    mode: classification.mode,
    outcome: terminalQuotaMessage
      ? 'quota_exhausted'
      : upstreamResult.errorMessage
        ? 'failed'
        : 'forwarded',
    statusCode: terminalQuotaMessage ? 429 : upstreamResult.statusCode,
    durationMs: completedAt.getTime() - startedAt.getTime(),
    requestBytes: head.byteLength,
    responseBytes: 0,
    streaming: true,
    upstreamHost: targetUrl.host,
    outboundMode: ctx.config.outboundProxy.mode,
    authHeaderPresent: authHeader !== undefined,
    cookieHeaderPresent: cookieHeader !== undefined,
    authFingerprint: fingerprint(routedAuthHeader),
    cookieFingerprint: fingerprint(cookieHeader),
    requestHeadersJson: safeJson(redactHeaders(request.headers)),
    responseHeadersJson: safeJson({ statusCode: upstreamResult.statusCode }),
    requestBodySample: summarizeBuffer(head),
    rawCapturePath: rawCapture?.directory,
    errorMessage: terminalQuotaMessage ?? upstreamResult.errorMessage,
    startedAt,
    completedAt
  })
}

interface TerminalQuotaUpgradeInput {
  accountId: string | undefined
  authHeader: string | undefined
  completedAt: Date
  conversationKey: string | undefined
  cookieHeader: string | undefined
  head: Buffer
  rawCapture: ReturnType<typeof createRawCapture>
  request: IncomingMessage
  requestId: string
  socket: Duplex
  startedAt: Date
  terminalAccountId: string | undefined
  terminalBody: Buffer
}

function finishUpgradeWithTerminalQuota(
  ctx: ProxyHandlerContext,
  input: TerminalQuotaUpgradeInput
): void {
  const headers = {
    connection: 'Upgrade',
    upgrade: 'websocket',
    'sec-websocket-accept': websocketAcceptKey(
      firstHeaderValue(input.request.headers['sec-websocket-key']) ?? ''
    )
  }
  input.socket.write(formatUpgradeResponse(101, headers))
  input.socket.write(createServerTextFrame(input.terminalBody.toString('utf8')))
  input.socket.end()
  input.rawCapture?.writeUpgradeResponse(101, headers)
  ctx.log.warn('HTTP result', {
    id: input.requestId,
    method: input.request.method ?? 'GET',
    path: input.request.url ?? '/',
    statusCode: 429,
    durationMs: input.completedAt.getTime() - input.startedAt.getTime(),
    bytes: input.terminalBody.byteLength,
    accountId: input.terminalAccountId ?? input.accountId,
    conversationKey: input.conversationKey,
    body: summarizeBuffer(input.terminalBody)
  })
  ctx.ledger.insert({
    ...analyzeHttpTraffic({
      method: input.request.method,
      path: input.request.url,
      requestBody: input.head,
      requestHeaders: input.request.headers,
      responseBody: input.terminalBody,
      responseHeaders: headers
    }),
    id: input.requestId,
    accountId: input.terminalAccountId ?? input.accountId,
    conversationKey: input.conversationKey,
    method: input.request.method ?? 'GET',
    path: input.request.url ?? '/',
    mode: 'account',
    outcome: 'quota_exhausted',
    statusCode: 429,
    durationMs: input.completedAt.getTime() - input.startedAt.getTime(),
    requestBytes: input.head.byteLength,
    responseBytes: input.terminalBody.byteLength,
    streaming: true,
    upstreamHost: 'not-forwarded',
    outboundMode: ctx.config.outboundProxy.mode,
    authHeaderPresent: input.authHeader !== undefined,
    cookieHeaderPresent: input.cookieHeader !== undefined,
    authFingerprint: fingerprint(input.authHeader),
    cookieFingerprint: fingerprint(input.cookieHeader),
    requestHeadersJson: safeJson(redactHeaders(input.request.headers)),
    responseHeadersJson: safeJson(headers),
    requestBodySample: summarizeBuffer(input.head),
    responseBodySample: summarizeBuffer(input.terminalBody),
    rawCapturePath: input.rawCapture?.directory,
    errorMessage: 'usage_limit_reached status=429',
    startedAt: input.startedAt,
    completedAt: input.completedAt
  })
}

function websocketAcceptKey(key: string): string {
  return createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
}

interface RejectUpgradeInput {
  accountId: string | undefined
  authHeader: string | undefined
  classification: ReturnType<typeof classifyProxyRequest>
  completedAt: Date
  conversationKey: string | undefined
  cookieHeader: string | undefined
  head: Buffer
  rawCapture: ReturnType<typeof createRawCapture>
  request: IncomingMessage
  requestId: string
  socket: Duplex
  startedAt: Date
}

function rejectUpgrade(ctx: ProxyHandlerContext, input: RejectUpgradeInput): void {
  const statusCode = input.classification.statusCode ?? 403
  const body = Buffer.from(JSON.stringify({ error: input.classification.errorCode }))
  input.socket.write(formatHttpResponse(statusCode, { 'content-type': 'application/json' }, body))
  input.socket.end()
  input.rawCapture?.writeResponse(statusCode, { 'content-type': 'application/json' }, body)
  ctx.log.warn('HTTP result', {
    id: input.requestId,
    method: input.request.method ?? 'GET',
    path: input.request.url ?? '/',
    statusCode,
    durationMs: input.completedAt.getTime() - input.startedAt.getTime(),
    bytes: body.byteLength,
    accountId: input.accountId,
    conversationKey: input.conversationKey,
    body: summarizeBuffer(body)
  })
  const entry: RequestLedgerEntry = {
    ...analyzeHttpTraffic({
      method: input.request.method,
      path: input.request.url,
      requestBody: input.head,
      requestHeaders: input.request.headers,
      responseBody: body,
      responseHeaders: { 'content-type': 'application/json' }
    }),
    id: input.requestId,
    accountId: input.accountId,
    conversationKey: input.conversationKey,
    method: input.request.method ?? 'GET',
    path: input.request.url ?? '/',
    mode: input.classification.mode,
    outcome: 'rejected',
    statusCode,
    durationMs: input.completedAt.getTime() - input.startedAt.getTime(),
    requestBytes: input.head.byteLength,
    responseBytes: body.byteLength,
    streaming: true,
    upstreamHost: 'not-forwarded',
    outboundMode: ctx.config.outboundProxy.mode,
    authHeaderPresent: input.authHeader !== undefined,
    cookieHeaderPresent: input.cookieHeader !== undefined,
    authFingerprint: fingerprint(input.authHeader),
    cookieFingerprint: fingerprint(input.cookieHeader),
    requestHeadersJson: safeJson(redactHeaders(input.request.headers)),
    responseHeadersJson: safeJson({ 'content-type': 'application/json' }),
    requestBodySample: summarizeBuffer(input.head),
    responseBodySample: summarizeBuffer(body),
    rawCapturePath: input.rawCapture?.directory,
    errorMessage: input.classification.errorCode,
    startedAt: input.startedAt,
    completedAt: input.completedAt
  }
  ctx.ledger.insert(entry)
}
