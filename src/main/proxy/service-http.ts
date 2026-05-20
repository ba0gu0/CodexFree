import type { IncomingMessage, ServerResponse } from 'node:http'
import { classifyProxyRequest } from './classification'
import { analyzeHttpTraffic } from './http-analysis'
import {
  shouldRewriteClientJsonResponse,
  transformHttpResponseForClient
} from './http-response-transform'
import { RequestBodyTooLargeError, readRequestBody, safeJson, summarizeBuffer } from './json-utils'
import {
  isCodexCompactPath,
  isCodexResponsesPath,
  isWhamRemotePath,
  isWhamUsagePath
} from './path-utils'
import { formatQuotaLedgerMessage, parseQuotaExhaustionEvent } from './quota'
import { createRawCapture } from './raw-capture'
import { createRequestId, fingerprint, firstHeaderValue, redactHeaders } from './redaction'
import type { ProxyHandlerContext } from './service-context'
import { summarizeServerSentEvents } from './sse-summary'
import { createTerminalQuotaPayload } from './terminal-quota'
import { forwardHttpRequest } from './transport-http'

export async function handleProxyHttpRequest(
  ctx: ProxyHandlerContext,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const startedAt = new Date()
  const requestId = createRequestId()
  let requestBody: Buffer
  try {
    requestBody = await readRequestBody(request, ctx.config.maxRequestBodyBytes)
  } catch (error) {
    if (!(error instanceof RequestBodyTooLargeError)) {
      throw error
    }
    const completedAt = new Date()
    const body = Buffer.from(JSON.stringify({ error: 'request_body_too_large' }))
    response.once('finish', () => request.socket.destroy())
    response.writeHead(413, { 'content-type': 'application/json' })
    response.end(body)
    ctx.log.warn('HTTP rejected oversized body', {
      id: requestId,
      method: request.method ?? 'GET',
      path: request.url ?? '/',
      maxBytes: error.maxBytes
    })
    ctx.ledger.insert({
      ...analyzeHttpTraffic({
        method: request.method,
        path: request.url,
        requestBody: Buffer.alloc(0),
        requestHeaders: request.headers,
        responseBody: body,
        responseHeaders: { 'content-type': 'application/json' }
      }),
      id: requestId,
      method: request.method ?? 'GET',
      path: request.url ?? '/',
      mode: 'unknown',
      outcome: 'rejected',
      statusCode: 413,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      requestBytes: error.maxBytes + 1,
      responseBytes: body.byteLength,
      streaming: false,
      upstreamHost: 'not-forwarded',
      outboundMode: ctx.config.outboundProxy.mode,
      authHeaderPresent: firstHeaderValue(request.headers.authorization) !== undefined,
      cookieHeaderPresent: firstHeaderValue(request.headers.cookie) !== undefined,
      authFingerprint: fingerprint(firstHeaderValue(request.headers.authorization)),
      cookieFingerprint: fingerprint(firstHeaderValue(request.headers.cookie)),
      requestHeadersJson: safeJson(redactHeaders(request.headers)),
      responseHeadersJson: safeJson({ 'content-type': 'application/json' }),
      responseBodySample: summarizeBuffer(body),
      errorMessage: 'request_body_too_large',
      startedAt,
      completedAt
    })
    return
  }
  const targetUrl = ctx.buildTargetUrl(request.url ?? '/')
  const rawCapture = createRawCapture(
    ctx.rawCaptureDir,
    requestId,
    ctx.config.rawCaptureEnabled,
    ctx.config.rawCaptureMaxBytes
  )
  rawCapture?.writeRequest(
    request.method ?? 'GET',
    request.url ?? '/',
    request.headers,
    requestBody
  )
  const authHeader = firstHeaderValue(request.headers.authorization)
  const cookieHeader = firstHeaderValue(request.headers.cookie)
  const accountId = firstHeaderValue(request.headers['chatgpt-account-id'])
  const conversationKey =
    firstHeaderValue(request.headers.thread_id) ??
    firstHeaderValue(request.headers.session_id) ??
    firstHeaderValue(request.headers['x-client-request-id'])
  const classification = classifyProxyRequest(request.url ?? '/', request.headers)
  const outboundMode = ctx.config.outboundProxy.mode
  if (!classification.allowed) {
    const completedAt = new Date()
    const body = Buffer.from(JSON.stringify({ error: classification.errorCode }))
    response.writeHead(classification.statusCode ?? 403, { 'content-type': 'application/json' })
    response.end(body)
    rawCapture?.writeResponse(
      classification.statusCode ?? 403,
      { 'content-type': 'application/json' },
      body
    )
    ctx.log.warn('HTTP result', {
      id: requestId,
      method: request.method ?? 'GET',
      path: request.url ?? '/',
      statusCode: classification.statusCode ?? 403,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      bytes: body.byteLength,
      accountId,
      conversationKey,
      body: summarizeBuffer(body)
    })
    ctx.ledger.insert({
      ...analyzeHttpTraffic({
        method: request.method,
        path: request.url,
        requestBody,
        requestHeaders: request.headers,
        responseBody: body,
        responseHeaders: { 'content-type': 'application/json' }
      }),
      id: requestId,
      accountId,
      conversationKey,
      method: request.method ?? 'GET',
      path: request.url ?? '/',
      mode: classification.mode,
      outcome: 'rejected',
      statusCode: classification.statusCode,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      requestBytes: requestBody.byteLength,
      responseBytes: body.byteLength,
      streaming: false,
      upstreamHost: 'not-forwarded',
      outboundMode,
      authHeaderPresent: authHeader !== undefined,
      cookieHeaderPresent: cookieHeader !== undefined,
      authFingerprint: fingerprint(authHeader),
      cookieFingerprint: fingerprint(cookieHeader),
      requestHeadersJson: safeJson(redactHeaders(request.headers)),
      responseHeadersJson: safeJson({ 'content-type': 'application/json' }),
      requestBodySample: summarizeBuffer(requestBody),
      responseBodySample: summarizeBuffer(body),
      rawCapturePath: rawCapture?.directory,
      errorMessage: classification.errorCode,
      startedAt,
      completedAt
    })
    return
  }

  const mode = classification.mode
  const preserveOriginalAuth = isWhamRemotePath(request.url)
  const useAccountRules = classification.mode === 'account' && !preserveOriginalAuth
  const routedAccount = preserveOriginalAuth
    ? undefined
    : await ctx.routeAccount(request, requestId, accountId, conversationKey)
  if (useAccountRules && ctx.config.authPool.enabled && !routedAccount) {
    const completedAt = new Date()
    const terminalQuota =
      isCodexResponsesPath(request.url) || isCodexCompactPath(request.url)
        ? createTerminalQuotaPayload(ctx.ledger, accountId)
        : undefined
    const statusCode = terminalQuota ? 429 : 503
    const body =
      terminalQuota?.body ?? Buffer.from(JSON.stringify({ error: 'no_available_account' }))
    response.writeHead(statusCode, { 'content-type': 'application/json' })
    response.end(body)
    rawCapture?.writeResponse(statusCode, { 'content-type': 'application/json' }, body)
    ctx.log.warn('HTTP result', {
      id: requestId,
      method: request.method ?? 'GET',
      path: request.url ?? '/',
      statusCode,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      bytes: body.byteLength,
      accountId: terminalQuota?.accountId ?? accountId,
      conversationKey,
      body: summarizeBuffer(body)
    })
    ctx.ledger.insert({
      ...analyzeHttpTraffic({
        method: request.method,
        path: request.url,
        requestBody,
        requestHeaders: request.headers,
        responseBody: body,
        responseHeaders: { 'content-type': 'application/json' }
      }),
      id: requestId,
      accountId: terminalQuota?.accountId ?? accountId,
      conversationKey,
      method: request.method ?? 'GET',
      path: request.url ?? '/',
      mode,
      outcome: terminalQuota ? 'quota_exhausted' : 'rejected',
      statusCode,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      requestBytes: requestBody.byteLength,
      responseBytes: body.byteLength,
      streaming: false,
      upstreamHost: 'not-forwarded',
      outboundMode,
      authHeaderPresent: authHeader !== undefined,
      cookieHeaderPresent: cookieHeader !== undefined,
      authFingerprint: fingerprint(authHeader),
      cookieFingerprint: fingerprint(cookieHeader),
      requestHeadersJson: safeJson(redactHeaders(request.headers)),
      responseHeadersJson: safeJson({ 'content-type': 'application/json' }),
      requestBodySample: summarizeBuffer(requestBody),
      responseBodySample: summarizeBuffer(body),
      rawCapturePath: rawCapture?.directory,
      errorMessage: terminalQuota ? 'usage_limit_reached status=429' : 'no_available_account',
      startedAt,
      completedAt
    })
    return
  }
  let routedAuthHeader = routedAccount?.authorization ?? authHeader
  let routedAccountId = routedAccount?.accountId ?? accountId
  rawCapture?.writeOutboundRequest(ctx.createRequestOptions(request, targetUrl), requestBody)

  const shouldTransformClientResponse =
    useAccountRules && shouldRewriteClientJsonResponse(request.url)
  const shouldDeferResponse =
    useAccountRules && (ctx.config.authPool.enabled || shouldTransformClientResponse)
  let terminalQuotaMessage: string | undefined
  let upstreamResult = await forwardHttpRequest(
    ctx.createRequestOptions(request, targetUrl),
    requestBody,
    response,
    rawCapture,
    ctx.config.rawCaptureMaxBytes,
    shouldDeferResponse
  )
  const maxQuotaRetries = ctx.config.authPool.enabled
    ? Math.min(ctx.availableAccountCount(), 10)
    : 0
  let quotaRetries = 0
  while (shouldDeferResponse) {
    const quotaBody =
      upstreamResult.deferredBody ?? upstreamResult.responseSample ?? Buffer.alloc(0)
    const quotaEvent = parseQuotaExhaustionEvent(quotaBody.toString('utf8'))
    if (!quotaEvent) {
      terminalQuotaMessage = undefined
      break
    }
    terminalQuotaMessage = formatQuotaLedgerMessage(quotaEvent)
    ctx.markHttpQuotaExhausted(requestId, routedAccountId, conversationKey, quotaEvent)
    if (!ctx.config.authPool.enabled || quotaRetries >= maxQuotaRetries) {
      break
    }
    quotaRetries += 1
    const nextAccount = await ctx.switchAccountAfterExhaustion(
      request,
      requestId,
      routedAccountId,
      conversationKey,
      'quota_retry_selected'
    )
    if (!nextAccount) {
      break
    }
    terminalQuotaMessage = undefined
    routedAuthHeader = nextAccount.authorization
    routedAccountId = nextAccount.accountId
    ctx.log.info('Switched active account after usage limit', {
      id: requestId,
      accountId: nextAccount.accountId,
      accountLabel: nextAccount.label,
      usage: ctx.accountUsageText(nextAccount.accountId)
    })
    upstreamResult = await forwardHttpRequest(
      ctx.createRequestOptions(request, targetUrl),
      requestBody,
      response,
      rawCapture,
      ctx.config.rawCaptureMaxBytes,
      true
    )
  }

  if (useAccountRules && ctx.config.authPool.enabled && upstreamResult.statusCode === 401) {
    const maxAuthRetries = Math.min(ctx.availableAccountCount(), 10)
    let authRetries = 0
    while (upstreamResult.statusCode === 401 && authRetries < maxAuthRetries) {
      authRetries += 1
      ctx.markHttpAuthFailed(requestId, routedAccountId, conversationKey, upstreamResult)
      const nextAccount = await ctx.switchAccountAfterAuthFailure(
        request,
        requestId,
        routedAccountId,
        conversationKey
      )
      if (!nextAccount) {
        break
      }
      routedAuthHeader = nextAccount.authorization
      routedAccountId = nextAccount.accountId
      ctx.log.info('Switched active account after auth failure', {
        id: requestId,
        accountId: nextAccount.accountId,
        accountLabel: nextAccount.label,
        usage: ctx.accountUsageText(nextAccount.accountId)
      })
      upstreamResult = await forwardHttpRequest(
        ctx.createRequestOptions(request, targetUrl),
        requestBody,
        response,
        rawCapture,
        ctx.config.rawCaptureMaxBytes,
        shouldDeferResponse
      )
    }
  }

  if (useAccountRules && ctx.config.authPool.enabled && isWhamUsagePath(request.url)) {
    const usage = ctx.updateUsageFromHttpResponse(request.url, routedAccountId, upstreamResult)
    if (usage?.exhausted === true) {
      const nextAccount = await ctx.switchAccountAfterExhaustion(
        request,
        requestId,
        routedAccountId,
        conversationKey,
        'quota_retry_selected'
      )
      if (nextAccount) {
        routedAuthHeader = nextAccount.authorization
        routedAccountId = nextAccount.accountId
        upstreamResult = await forwardHttpRequest(
          ctx.createRequestOptions(request, targetUrl),
          requestBody,
          response,
          rawCapture,
          ctx.config.rawCaptureMaxBytes,
          true
        )
        ctx.updateUsageFromHttpResponse(request.url, routedAccountId, upstreamResult)
      }
    }
  } else if (useAccountRules) {
    ctx.updateUsageFromHttpResponse(request.url, routedAccountId, upstreamResult)
  }

  const clientResult = useAccountRules
    ? transformHttpResponseForClient(request.url, accountId, upstreamResult)
    : upstreamResult
  const trafficAnalysis = analyzeHttpTraffic({
    method: request.method,
    path: request.url,
    requestBody,
    requestHeaders: request.headers,
    responseBody: clientResult.deferredBody ?? clientResult.responseSample,
    responseHeaders: clientResult.responseHeaders
  })
  if (trafficAnalysis.requestPurpose === 'codex_response_sse') {
    const sseSummary = summarizeServerSentEvents({
      accountId: routedAccountId,
      conversationKey,
      path: request.url ?? '/',
      requestBody,
      requestBodyEncoding: trafficAnalysis.requestBodyEncoding,
      requestId,
      responseBody: clientResult.deferredBody ?? clientResult.responseSample
    })
    for (const message of sseSummary.messages) {
      if (typeof ctx.ledger.recordProtocolMessage === 'function') {
        ctx.ledger.recordProtocolMessage(message)
      }
    }
    if (sseSummary.turnSummary && typeof ctx.ledger.recordTurnSummary === 'function') {
      ctx.ledger.recordTurnSummary(sseSummary.turnSummary)
    }
  }
  ctx.writeDeferredHttpResponse(response, clientResult)
  const completedAt = new Date()
  ctx.log.info('HTTP result', {
    id: requestId,
    method: request.method,
    path: request.url,
    requestPurpose: trafficAnalysis.requestPurpose,
    requestModel: trafficAnalysis.requestModel,
    requestBodyEncoding: trafficAnalysis.requestBodyEncoding,
    requestInputItemCount: trafficAnalysis.requestInputItemCount,
    rpcMethod: trafficAnalysis.rpcMethod,
    analyticsEventTypes: trafficAnalysis.analyticsEventTypes,
    responseModel: trafficAnalysis.responseModel,
    responsePlanType: trafficAnalysis.responsePlanType,
    responsePrimaryUsedPercent: trafficAnalysis.responsePrimaryUsedPercent,
    responseRateLimitResetAt: trafficAnalysis.responseRateLimitResetAt,
    responseItemCount: trafficAnalysis.responseItemCount,
    inputTokens: trafficAnalysis.inputTokens,
    cachedInputTokens: trafficAnalysis.cachedInputTokens,
    outputTokens: trafficAnalysis.outputTokens,
    reasoningTokens: trafficAnalysis.reasoningTokens,
    totalTokens: trafficAnalysis.totalTokens,
    tokenUsageSource: trafficAnalysis.tokenUsageSource,
    codexThreadId: trafficAnalysis.codexThreadId,
    codexTurnId: trafficAnalysis.codexTurnId,
    statusCode: clientResult.statusCode,
    durationMs: completedAt.getTime() - startedAt.getTime(),
    bytes: clientResult.responseBytes,
    targetHost: targetUrl.host,
    outboundMode,
    accountId: routedAccountId,
    accountLabel: routedAccount?.label,
    conversationKey,
    errorMessage: clientResult.errorMessage,
    requestBody: summarizeBuffer(requestBody),
    body: summarizeBuffer(
      clientResult.deferredBody ?? clientResult.responseSample ?? Buffer.alloc(0)
    ),
    usage: ctx.accountUsageText(routedAccountId)
  })
  ctx.ledger.insert({
    ...trafficAnalysis,
    id: requestId,
    accountId: routedAccountId,
    conversationKey,
    method: request.method ?? 'GET',
    path: request.url ?? '/',
    mode,
    outcome: terminalQuotaMessage
      ? 'quota_exhausted'
      : upstreamResult.errorMessage
        ? 'failed'
        : 'forwarded',
    statusCode: terminalQuotaMessage ? 429 : clientResult.statusCode,
    durationMs: completedAt.getTime() - startedAt.getTime(),
    requestBytes: requestBody.byteLength,
    responseBytes: clientResult.responseBytes,
    streaming: clientResult.streaming,
    upstreamHost: targetUrl.host,
    outboundMode,
    authHeaderPresent: authHeader !== undefined,
    cookieHeaderPresent: cookieHeader !== undefined,
    authFingerprint: fingerprint(routedAuthHeader),
    cookieFingerprint: fingerprint(cookieHeader),
    requestHeadersJson: safeJson(redactHeaders(request.headers)),
    responseHeadersJson: safeJson(upstreamResult.responseHeaders ?? {}),
    requestBodySample: summarizeBuffer(requestBody),
    responseBodySample: summarizeBuffer(clientResult.responseSample ?? Buffer.alloc(0)),
    rawCapturePath: rawCapture?.directory,
    errorMessage: terminalQuotaMessage ?? clientResult.errorMessage,
    startedAt,
    completedAt
  })
}
