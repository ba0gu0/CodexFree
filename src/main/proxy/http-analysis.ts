import type { IncomingHttpHeaders } from 'node:http'
import {
  arrayField,
  decodeBodyBuffer,
  isRecord,
  numberField,
  parseJsonRecord,
  recordField,
  stringField
} from './json-utils'
import { isCodexModelsPath, isWhamUsagePath } from './path-utils'
import { firstHeaderValue } from './redaction'

export interface HttpTrafficAnalysis {
  analyticsEventTypes?: string
  cachedInputTokens?: number
  codexRuntimeArch?: string
  codexRuntimeOs?: string
  codexSessionId?: string
  codexThreadId?: string
  codexTurnId?: string
  codexTurnStartedAt?: number
  codexVersion?: string
  inputTokens?: number
  originator?: string
  outputTokens?: number
  reasoningTokens?: number
  requestBodyEncoding?: string
  requestContentType?: string
  requestInputItemCount?: number
  requestModel?: string
  requestPurpose?: string
  responseActiveLimit?: string
  responseContentType?: string
  responseItemCount?: number
  responseModel?: string
  responsePlanType?: string
  responseRateLimitResetAt?: number
  responsePrimaryUsedPercent?: string
  rpcId?: string
  rpcMethod?: string
  summaryJson?: string
  totalTokens?: number
  tokenUsageSource?: string
  userAgent?: string
}

export function analyzeHttpTraffic(input: {
  method: string | undefined
  path: string | undefined
  requestBody: Buffer
  requestHeaders: IncomingHttpHeaders
  responseBody?: Buffer
  responseHeaders?: IncomingHttpHeaders
}): HttpTrafficAnalysis {
  const path = input.path ?? '/'
  const requestBodyEncoding = firstHeaderValue(input.requestHeaders['content-encoding'])
  const requestBody = parseJsonRecord(
    decodeBodyBuffer(input.requestBody, requestBodyEncoding).toString('utf8')
  )
  const responseBody = input.responseBody
    ? parseJsonRecord(input.responseBody.toString('utf8'))
    : undefined
  const responseTokenUsage = extractTokenUsage(input.responseBody)
  const tokenUsage = hasTokenUsage(responseTokenUsage)
    ? responseTokenUsage
    : analyticsTokenUsage(requestBody)
  const turnMetadata = parseJsonRecord(
    firstHeaderValue(input.requestHeaders['x-codex-turn-metadata']) ?? ''
  )
  const runtime = firstAnalyticsRuntime(requestBody)
  const appClient = firstAnalyticsAppClient(requestBody)
  const requestPurpose = describeHttpPurpose(path, input.method)
  const responsePrimaryUsedPercent =
    firstHeaderValue(input.responseHeaders?.['x-codex-primary-used-percent']) ??
    usageLimitPercent(responseBody)
  const responseRateLimitResetAt =
    unixSecondsHeader(input.responseHeaders?.['x-codex-primary-reset-at']) ??
    usageLimitResetAt(responseBody)
  return compactAnalysis({
    analyticsEventTypes: analyticsEventTypes(requestBody),
    cachedInputTokens: tokenUsage.cachedInputTokens,
    codexRuntimeArch: stringField(runtime, 'runtime_arch'),
    codexRuntimeOs: stringField(runtime, 'runtime_os'),
    codexSessionId: stringField(turnMetadata, 'session_id') ?? firstAnalyticsThreadId(requestBody),
    codexThreadId: stringField(turnMetadata, 'thread_id') ?? firstAnalyticsThreadId(requestBody),
    codexTurnId: stringField(turnMetadata, 'turn_id'),
    codexTurnStartedAt: numberField(turnMetadata, 'turn_started_at_unix_ms'),
    codexVersion:
      stringField(appClient, 'client_version') ??
      stringField(runtime, 'codex_rs_version') ??
      codexVersionFromUserAgent(firstHeaderValue(input.requestHeaders['user-agent'])),
    inputTokens: tokenUsage.inputTokens,
    originator: firstHeaderValue(input.requestHeaders.originator),
    outputTokens: tokenUsage.outputTokens,
    reasoningTokens: tokenUsage.reasoningTokens,
    requestBodyEncoding,
    requestContentType: firstHeaderValue(input.requestHeaders['content-type']),
    requestInputItemCount: arrayField(requestBody, 'input')?.length,
    requestModel: stringField(requestBody, 'model') ?? firstAnalyticsModel(requestBody),
    requestPurpose,
    responseActiveLimit:
      firstHeaderValue(input.responseHeaders?.['x-codex-active-limit']) ??
      stringField(responseBody, 'active_limit'),
    responseContentType: firstHeaderValue(input.responseHeaders?.['content-type']),
    responseItemCount: responseItemCount(responseBody),
    responseModel: responseModel(responseBody, path),
    responsePlanType:
      firstHeaderValue(input.responseHeaders?.['x-codex-plan-type']) ??
      usagePlanType(responseBody) ??
      stringField(recordField(responseBody, 'error'), 'plan_type'),
    responsePrimaryUsedPercent,
    responseRateLimitResetAt,
    rpcId: stringField(requestBody, 'id'),
    rpcMethod: stringField(requestBody, 'method'),
    summaryJson: httpSummaryJson({
      path,
      purpose: requestPurpose,
      requestBody,
      requestBytes: input.requestBody.byteLength,
      responseBody,
      responseBytes: input.responseBody?.byteLength,
      responsePrimaryUsedPercent,
      responseRateLimitResetAt,
      tokenUsage
    }),
    tokenUsageSource: tokenUsage.source,
    totalTokens: tokenUsage.totalTokens,
    userAgent: firstHeaderValue(input.requestHeaders['user-agent'])
  })
}

interface HttpSummaryInput {
  path: string
  purpose: string
  requestBody: Record<string, unknown> | undefined
  requestBytes: number
  responseBody: Record<string, unknown> | undefined
  responseBytes: number | undefined
  responsePrimaryUsedPercent: string | undefined
  responseRateLimitResetAt: number | undefined
  tokenUsage: TokenUsageFields
}

function httpSummaryJson(input: HttpSummaryInput): string | undefined {
  const summary = routeSummary(input)
  if (!summary) {
    return undefined
  }
  return safeSummaryJson(summary)
}

function usagePlanType(body: Record<string, unknown> | undefined): string | undefined {
  const account = recordField(body, 'account')
  const user = recordField(body, 'user')
  const subscription = recordField(body, 'subscription')
  const rateLimit = recordField(body, 'rate_limit')
  return (
    stringField(body, 'plan_type') ??
    stringField(body, 'chatgpt_plan_type') ??
    stringField(body, 'account_type') ??
    stringField(body, 'planType') ??
    stringField(body, 'plan') ??
    stringField(account, 'plan_type') ??
    stringField(account, 'chatgpt_plan_type') ??
    stringField(account, 'account_type') ??
    stringField(account, 'plan') ??
    stringField(user, 'plan_type') ??
    stringField(user, 'account_type') ??
    stringField(subscription, 'plan_type') ??
    stringField(subscription, 'plan') ??
    stringField(rateLimit, 'plan_type')
  )
}

function routeSummary(input: HttpSummaryInput): Record<string, unknown> | undefined {
  const base = {
    path: input.path,
    purpose: input.purpose
  }
  if (input.purpose === 'analytics_events') {
    return {
      ...base,
      eventTypes: analyticsEventTypes(input.requestBody)?.split(',') ?? [],
      model: firstAnalyticsModel(input.requestBody),
      threadId: firstAnalyticsThreadId(input.requestBody),
      tokenUsage: compactObject(input.tokenUsage)
    }
  }
  if (input.purpose === 'account_usage') {
    return {
      ...base,
      activeLimit: stringField(input.responseBody, 'active_limit'),
      planType: usagePlanType(input.responseBody),
      primaryRemainingPercent: remainingPercent(input.responsePrimaryUsedPercent),
      primaryUsedPercent: input.responsePrimaryUsedPercent,
      resetAt: input.responseRateLimitResetAt
    }
  }
  if (input.purpose === 'codex_compact') {
    return {
      ...base,
      compressionRatio:
        input.responseBytes && input.requestBytes > 0
          ? Number((input.responseBytes / input.requestBytes).toFixed(4))
          : undefined,
      inputBytes: input.requestBytes,
      outputBytes: input.responseBytes,
      outputItems: responseItemCount(input.responseBody)
    }
  }
  if (
    input.purpose === 'models' ||
    input.purpose === 'wham_apps' ||
    input.purpose === 'connector_directory' ||
    input.purpose === 'plugin_featured' ||
    input.purpose === 'plugin_installed'
  ) {
    return {
      ...base,
      itemCount: responseItemCount(input.responseBody),
      modelSummary: responseModel(input.responseBody, input.path),
      rpcMethod: stringField(input.requestBody, 'method')
    }
  }
  if (input.purpose === 'codex_response_sse') {
    return {
      ...base,
      model: stringField(input.requestBody, 'model'),
      tokenUsage: compactObject(input.tokenUsage),
      userText: extractBodyUserText(input.requestBody)
    }
  }
  return undefined
}

function describeHttpPurpose(path: string, method: string | undefined): string {
  if (path.includes('/codex/responses/compact')) return 'codex_compact'
  if (path.includes('/codex/responses')) {
    return method === 'GET' ? 'codex_wss' : 'codex_response_sse'
  }
  if (path.includes('/analytics-events/')) return 'analytics_events'
  if (path.includes('/connectors/directory/list')) return 'connector_directory'
  if (path.includes('/plugins/featured')) return 'plugin_featured'
  if (path.includes('/ps/plugins/installed')) return 'plugin_installed'
  if (path.includes('/wham/usage')) return 'account_usage'
  if (path.includes('/wham/apps')) return 'wham_apps'
  if (path === '/responses') return 'api_key_compat'
  if (path.includes('/models')) return 'models'
  if (path.startsWith('/v1/')) return 'api_key_compat'
  return 'upstream'
}

function responseModel(
  body: Record<string, unknown> | undefined,
  path: string
): string | undefined {
  if (!body) return undefined
  if (isCodexModelsPath(path)) {
    return arrayField(body, 'models')
      ?.filter(isRecord)
      .map((model) => stringField(model, 'slug') ?? stringField(model, 'id'))
      .filter((value): value is string => value !== undefined)
      .slice(0, 5)
      .join(',')
  }
  if (isWhamUsagePath(path)) {
    return stringField(body, 'model')
  }
  return stringField(body, 'model') ?? stringField(recordField(body, 'response'), 'model')
}

interface TokenUsageFields {
  cachedInputTokens?: number
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  source?: string
  totalTokens?: number
}

function extractTokenUsage(body: Buffer | undefined): TokenUsageFields {
  if (!body || body.byteLength === 0) {
    return {}
  }
  const text = body.toString('utf8')
  const jsonUsage = usageFromEnvelope(parseJsonRecord(text))
  if (jsonUsage) {
    return { ...jsonUsage, source: 'json' }
  }
  let lastUsage: TokenUsageFields | undefined
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) {
      continue
    }
    const data = line.slice('data:'.length).trim()
    if (data === '' || data === '[DONE]') {
      continue
    }
    const sseUsage = usageFromEnvelope(parseJsonRecord(data))
    if (sseUsage) {
      lastUsage = sseUsage
    }
  }
  return lastUsage ? { ...lastUsage, source: 'sse' } : {}
}

function analyticsTokenUsage(body: Record<string, unknown> | undefined): TokenUsageFields {
  const params = firstAnalyticsParams(body)
  const usage = compactUsage({
    cachedInputTokens: numberField(params, 'cached_input_tokens'),
    inputTokens: numberField(params, 'input_tokens'),
    outputTokens: numberField(params, 'output_tokens'),
    reasoningTokens: numberField(params, 'reasoning_output_tokens'),
    totalTokens: numberField(params, 'total_tokens')
  })
  return usage ? { ...usage, source: 'analytics_event' } : {}
}

function hasTokenUsage(usage: TokenUsageFields): boolean {
  return (
    usage.cachedInputTokens !== undefined ||
    usage.inputTokens !== undefined ||
    usage.outputTokens !== undefined ||
    usage.reasoningTokens !== undefined ||
    usage.totalTokens !== undefined
  )
}

function usageFromEnvelope(
  body: Record<string, unknown> | undefined
): TokenUsageFields | undefined {
  const usage = recordField(body, 'usage') ?? recordField(recordField(body, 'response'), 'usage')
  if (!usage) {
    return undefined
  }
  return compactUsage({
    cachedInputTokens: numberField(recordField(usage, 'input_tokens_details'), 'cached_tokens'),
    inputTokens: numberField(usage, 'input_tokens'),
    outputTokens: numberField(usage, 'output_tokens'),
    reasoningTokens: numberField(recordField(usage, 'output_tokens_details'), 'reasoning_tokens'),
    totalTokens: numberField(usage, 'total_tokens')
  })
}

function compactUsage(input: TokenUsageFields): TokenUsageFields | undefined {
  const compacted = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  ) as TokenUsageFields
  return Object.keys(compacted).length > 0 ? compacted : undefined
}

function analyticsEventTypes(body: Record<string, unknown> | undefined): string | undefined {
  const types = arrayField(body, 'events')
    ?.filter(isRecord)
    .map((event) => stringField(event, 'event_type') ?? stringField(event, 'event_name'))
    .filter((value): value is string => value !== undefined)
  return compactStringList(types)
}

function responseItemCount(body: Record<string, unknown> | undefined): number | undefined {
  if (!body) {
    return undefined
  }
  for (const key of ['models', 'apps', 'connectors', 'items', 'data', 'results', 'output']) {
    const items = arrayField(body, key)
    if (items) {
      return items.length
    }
  }
  const result = recordField(body, 'result')
  if (!result) {
    return undefined
  }
  return responseItemCount(result)
}

function usageLimitPercent(body: Record<string, unknown> | undefined): string | undefined {
  const rateLimit = recordField(body, 'rate_limit')
  const primaryWindow = recordField(rateLimit, 'primary_window')
  const secondaryWindow = recordField(rateLimit, 'secondary_window')
  const limits = arrayField(body, 'limits')?.filter(isRecord)
  const primary = limits?.find((limit) => stringField(limit, 'type') === 'primary') ?? limits?.[0]
  return (
    stringField(body, 'primary_used_percent') ??
    stringField(primaryWindow, 'used_percent') ??
    stringField(secondaryWindow, 'used_percent') ??
    stringField(primary, 'used_percent')
  )
}

function usageLimitResetAt(body: Record<string, unknown> | undefined): number | undefined {
  const rateLimit = recordField(body, 'rate_limit')
  const primaryWindow = recordField(rateLimit, 'primary_window')
  const primaryReset = numberField(primaryWindow, 'reset_at')
  if (primaryReset !== undefined) {
    return primaryReset > 10_000_000_000 ? primaryReset : primaryReset * 1000
  }
  const limits = arrayField(body, 'limits')?.filter(isRecord)
  const primary = limits?.find((limit) => stringField(limit, 'type') === 'primary') ?? limits?.[0]
  const seconds = numberField(primary, 'reset_at')
  return seconds === undefined ? undefined : seconds * 1000
}

function unixSecondsHeader(value: string | string[] | undefined): number | undefined {
  const seconds = Number(firstHeaderValue(value))
  return Number.isFinite(seconds) ? seconds * 1000 : undefined
}

function compactStringList(values: string[] | undefined): string | undefined {
  const compacted = values?.filter(Boolean).slice(0, 8)
  return compacted && compacted.length > 0 ? compacted.join(',') : undefined
}

function firstAnalyticsRuntime(
  body: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  return firstAnalyticsParams(body)?.runtime as Record<string, unknown> | undefined
}

function firstAnalyticsAppClient(
  body: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  return recordField(firstAnalyticsParams(body), 'app_server_client')
}

function firstAnalyticsThreadId(body: Record<string, unknown> | undefined): string | undefined {
  return stringField(firstAnalyticsParams(body), 'thread_id')
}

function firstAnalyticsModel(body: Record<string, unknown> | undefined): string | undefined {
  return stringField(firstAnalyticsParams(body), 'model')
}

function firstAnalyticsParams(
  body: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  const event = arrayField(body, 'events')?.find(isRecord)
  return recordField(event, 'event_params')
}

function codexVersionFromUserAgent(userAgent: string | undefined): string | undefined {
  return userAgent?.match(/codex-(?:tui|cli)[/ ]([^); ]+)/)?.[1]
}

function compactAnalysis(input: HttpTrafficAnalysis): HttpTrafficAnalysis {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== '')
  ) as HttpTrafficAnalysis
}

function compactObject(input: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== '')
  )
}

function remainingPercent(usedPercent: string | undefined): number | undefined {
  if (!usedPercent) {
    return undefined
  }
  const used = Number.parseFloat(usedPercent)
  if (!Number.isFinite(used)) {
    return undefined
  }
  return Math.max(0, Math.min(100, 100 - used))
}

function extractBodyUserText(body: Record<string, unknown> | undefined): string | undefined {
  const input = body?.input
  if (typeof input === 'string') {
    return input
  }
  if (!Array.isArray(input)) {
    return undefined
  }
  const userItems = input.filter((item) => isRecord(item) && stringField(item, 'role') === 'user')
  const source = userItems.length > 0 ? userItems : input
  return source.flatMap((item) => collectTextValues(item)).at(-1)
}

function collectTextValues(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value]
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectTextValues(item))
  }
  if (!isRecord(value)) {
    return []
  }
  return Object.entries(value).flatMap(([key, child]) =>
    key === 'text' || key === 'content' ? collectTextValues(child) : []
  )
}

function safeSummaryJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return JSON.stringify({ text: String(value) })
  }
}
