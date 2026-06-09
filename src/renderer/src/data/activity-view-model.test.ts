import { createTranslator } from '@renderer/i18n/copy'
import { describe, expect, it } from 'vitest'
import { buildRequestTimeline } from '../pages/requests-model'
import type { ActivityViewContext } from './activity-view-model'
import { protocolActivityViewModel, requestActivityViewModel } from './activity-view-model'
import type { ProtocolMessage, ProxyLogEvent, RecentRequest, TurnSummary } from './proxy-console'

const context: ActivityViewContext = {
  accountLabels: new Map([['acct_1', 'hgray120@example.com']]),
  locale: 'zh-CN',
  t: createTranslator('zh-CN')
}

describe('activity view model', () => {
  it('renders usage query with routed account and remaining quota', () => {
    const request = baseRequest({
      requestPurpose: 'account_usage',
      responsePlanType: 'free',
      summaryJson: JSON.stringify({ primaryRemainingPercent: 96 })
    })
    const view = requestActivityViewModel(request, context)

    expect(view.kind).toBe('usage')
    expect(view.title).toContain('额度查询')
    expect(view.title).toContain('hgray120@example.com')
    expect(view.title).toContain('free')
    expect(view.title).toContain('剩余 96%')
    expect(view.metrics).toContain('剩余 96%')
  })

  it('renders compact requests as compression results', () => {
    const request = baseRequest({
      requestPurpose: 'codex_compact',
      summaryJson: JSON.stringify({
        compressionRatio: 0.338,
        inputBytes: 64_716,
        outputBytes: 21_913
      })
    })
    const view = requestActivityViewModel(request, context)

    expect(view.title).toContain('上下文压缩')
    expect(view.title).toContain('63.2 KiB -> 21.4 KiB')
    expect(view.title).toContain('压缩 66.2%')
  })

  it('renders wham apps JSON-RPC requests as Apps RPC', () => {
    const request = baseRequest({
      path: '/backend-api/wham/apps',
      requestPurpose: 'wham_apps',
      rpcMethod: 'tools/list'
    })
    const view = requestActivityViewModel(request, context)

    expect(view.title).toBe('Apps RPC · tools/list · 200')
    expect(view.subtitle).toContain('RPC tools/list')
  })

  it('labels installed plugin requests separately from generic upstream traffic', () => {
    const request = baseRequest({
      method: 'GET',
      path: '/backend-api/ps/plugins/installed?scope=WORKSPACE',
      requestPurpose: 'plugin_installed'
    })
    const view = requestActivityViewModel(request, context)

    expect(view.title).toBe('已安装插件查询 · WORKSPACE · 200')
    expect(view.badges).toContain('HTTP')
  })

  it('labels historical installed plugin rows even when purpose is still upstream', () => {
    const request = baseRequest({
      method: 'GET',
      path: '/backend-api/ps/plugins/installed?scope=GLOBAL&includeDownloadUrls=true',
      requestPurpose: 'upstream'
    })
    const view = requestActivityViewModel(request, context)

    expect(view.title).toBe('已安装插件查询 · GLOBAL · 200')
  })

  it('renders protocol tool calls with tool name and arguments', () => {
    const message = baseProtocol({
      kind: 'tool_call',
      summaryJson: JSON.stringify({ arguments: 'bun run test', tool: 'shell_exec' })
    })
    const view = protocolActivityViewModel(message, context)

    expect(view.kind).toBe('tool')
    expect(view.title).toContain('工具调用 · shell_exec')
    expect(view.title).toContain('bun run test')
  })

  it('groups WSS protocol messages under request and turn parents', () => {
    const request = baseRequest({
      conversationKey: 'conversation_1',
      id: 'req_wss',
      path: '/backend-api/codex/responses',
      requestPurpose: 'codex_wss'
    })
    const tool = baseProtocol({
      callId: 'call_1',
      conversationKey: 'conversation_1',
      kind: 'tool_call',
      requestId: 'req_wss',
      summaryJson: JSON.stringify({ arguments: 'bun run test', tool: 'shell_exec' })
    })
    const turn = baseTurn({
      conversationKey: 'conversation_1',
      requestId: 'req_wss',
      toolCallCount: 1,
      userText: '帮我跑测试'
    })

    const timeline = buildRequestTimeline([request], [], [tool], [turn], context)

    expect(timeline.filter((item) => item.kind === 'protocol')).toHaveLength(0)
    const turnItem = timeline.find((item) => item.kind === 'turn')

    expect(timeline.find((item) => item.kind === 'request')).toBeUndefined()
    expect(turnItem?.activity.children).toHaveLength(0)
    expect(turnItem?.activity.title).toContain('用户请求')
  })

  it('keeps request-scoped log events as children instead of duplicate top-level rows', () => {
    const request = baseRequest({
      id: 'req_http',
      requestPurpose: 'wham_apps'
    })
    const event = baseLogEvent({
      eventType: 'account_switch',
      requestId: 'req_http'
    })

    const timeline = buildRequestTimeline([request], [event], [], [], context)

    expect(timeline.filter((item) => item.kind === 'log')).toHaveLength(0)
    expect(timeline.find((item) => item.kind === 'request')?.activity.children).toHaveLength(1)
  })
})

function baseRequest(overrides: Partial<RecentRequest> = {}): RecentRequest {
  return {
    accountId: 'acct_1',
    analyticsEventTypes: null,
    cachedInputTokens: null,
    codexRuntimeArch: null,
    codexRuntimeOs: null,
    codexSessionId: null,
    codexThreadId: null,
    codexTurnId: null,
    codexTurnStartedAt: null,
    codexVersion: null,
    conversationKey: null,
    durationMs: 120,
    errorMessage: null,
    id: 'req_1',
    inputTokens: null,
    method: 'POST',
    mode: 'account',
    originator: null,
    outboundMode: 'direct',
    outcome: 'forwarded',
    outputTokens: null,
    path: '/backend-api/wham/usage',
    rawCapturePath: null,
    reasoningTokens: null,
    requestBodyEncoding: 'json',
    requestBytes: 1024,
    requestContentType: 'application/json',
    requestInputItemCount: null,
    requestModel: null,
    requestPurpose: 'account_usage',
    responseActiveLimit: null,
    responseBytes: 2048,
    responseContentType: 'application/json',
    responseItemCount: null,
    responseModel: null,
    responsePlanType: null,
    responsePrimaryUsedPercent: null,
    responseRateLimitResetAt: null,
    rpcId: null,
    rpcMethod: null,
    startedAt: 1_700_000_000_000,
    statusCode: 200,
    streaming: 0,
    summaryJson: null,
    tokenUsageSource: null,
    totalTokens: null,
    upstreamHost: 'chatgpt.com',
    userAgent: null,
    ...overrides
  }
}

function baseProtocol(overrides: Partial<ProtocolMessage> = {}): ProtocolMessage {
  return {
    accountId: 'acct_1',
    cachedInputTokens: null,
    callId: null,
    conversationKey: null,
    createdAt: 1_700_000_000_100,
    direction: 'codex-to-upstream',
    id: 'msg_1',
    inputItemCount: null,
    inputTokens: null,
    itemId: null,
    kind: 'user',
    model: 'gpt-5.5',
    outputTokens: null,
    parentResponseId: null,
    path: '/backend-api/codex/responses',
    payloadBytes: 512,
    previousResponseId: null,
    protocolType: 'wss',
    reasoningTokens: null,
    requestId: 'req_1',
    responseId: null,
    sequenceNumber: 1,
    summaryJson: null,
    text: '用户请求: 帮我跑测试',
    toolCount: null,
    totalTokens: null,
    truncated: null,
    ...overrides
  }
}

function baseTurn(overrides: Partial<TurnSummary> = {}): TurnSummary {
  return {
    accountId: 'acct_1',
    assistantText: null,
    cachedInputTokens: null,
    codexThreadId: null,
    codexTurnId: null,
    completedAt: null,
    conversationKey: null,
    id: 'turn_1',
    inputTokens: null,
    outputTokens: null,
    parentResponseId: null,
    reasoningTokens: null,
    requestId: 'req_1',
    responseId: 'resp_1',
    startedAt: 1_700_000_000_100,
    status: 'completed',
    summaryJson: JSON.stringify({ model: 'gpt-5.5' }),
    toolCallCount: 0,
    toolResultCount: 0,
    totalTokens: null,
    turnKey: 'turn_key_1',
    updatedAt: 1_700_000_000_200,
    userText: null,
    ...overrides
  }
}

function baseLogEvent(overrides: Partial<ProxyLogEvent> = {}): ProxyLogEvent {
  return {
    accountId: 'acct_1',
    conversationKey: null,
    createdAt: 1_700_000_000_150,
    detailJson: JSON.stringify({ eventType: 'selected', reason: 'auth_pool' }),
    eventType: 'account_switch',
    id: 'log_1',
    level: 'info',
    message: 'Routing event',
    method: null,
    path: null,
    requestId: 'req_1',
    ...overrides
  }
}
