import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { classifyProxyRequest } from './classification'
import { safeJson, summarizeBuffer } from './json-utils'
import { formatQuotaLedgerMessage, type QuotaExhaustionEvent } from './quota'
import { createRawCapture } from './raw-capture'
import { createRequestId, fingerprint, firstHeaderValue, redactHeaders } from './redaction'
import type { ProxyHandlerContext } from './service-context'
import { forwardUpgradeRequest, type WebSocketLifecycleEvent } from './transport'
import { formatHttpResponse } from './transport-utils'
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

  const useAccountRules = classification.mode === 'account'
  if (useAccountRules && ctx.config.authPool.enabled && ctx.availableAccountCount() === 0) {
    ctx.ledger.recordRoutingEvent({
      requestId,
      conversationKey,
      accountId,
      eventType: 'all_accounts_exhausted',
      reason: 'no_available_account'
    })
    rejectUpgrade(ctx, {
      accountId,
      authHeader,
      classification: {
        ...classification,
        errorCode: 'no_available_account',
        statusCode: 503
      },
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
  const routedAccount = await ctx.routeAccount(request, requestId, accountId, conversationKey)
  if (useAccountRules && ctx.config.authPool.enabled && !routedAccount) {
    rejectUpgrade(ctx, {
      accountId,
      authHeader,
      classification: {
        ...classification,
        errorCode: 'no_available_account',
        statusCode: 503
      },
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
  rawCapture?.writeOutboundRequest(ctx.createRequestOptions(request, targetUrl), head)
  let terminalQuotaMessage: string | undefined
  let routedAuthHeader = routedAccount?.authorization ?? authHeader
  let routedAccountId = routedAccount?.accountId ?? accountId
  let suppressedRetryCloseLogs = 0
  ctx.log.info('WSS client connected', {
    id: requestId,
    path: request.url,
    accountId: routedAccountId,
    accountLabel: routedAccount?.label,
    conversationKey,
    usage: ctx.accountUsageText(routedAccountId)
  })

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
  const logLifecycle = (event: WebSocketLifecycleEvent) => {
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
    (frame) =>
      ctx.logWebSocketFrame(requestId, request.url ?? '/', routedAccountId, conversationKey, frame),
    logLifecycle
  )
  const completedAt = new Date()
  ctx.ledger.insert({
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
