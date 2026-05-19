import { truncateForLog } from './json-utils'
import type { ProxyLedger } from './ledger'
import {
  summarizeWebSocketFrame,
  type ToolCallState,
  type WebSocketSummary
} from './protocol-summary'
import type { ProxyServiceLog } from './service-context'
import type { CapturedWebSocketFrame } from './websocket-capture'

export class ProtocolMessageLogger {
  private readonly activeTurnKeys = new Map<string, string>()
  private readonly protocolMessageKeys = new Set<string>()
  private readonly toolCallSummaries = new Map<string, ToolCallState>()

  constructor(
    private readonly ledger: ProxyLedger,
    private readonly log: ProxyServiceLog
  ) {}

  logFrame(
    requestId: string,
    path: string,
    accountId: string | undefined,
    conversationKey: string | undefined,
    frame: CapturedWebSocketFrame
  ): void {
    let summary = summarizeWebSocketFrame(frame)
    if (!summary) {
      return
    }
    if (summary.kind === 'heartbeat') {
      return
    }
    if ((summary.kind === 'tool_call' || summary.kind === 'tool_result') && summary.tool) {
      const toolSummary = this.mergeToolSummary(requestId, conversationKey, summary)
      if (!toolSummary) {
        return
      }
      summary = {
        ...summary,
        kind: 'tool_call',
        summaryJson: toolSummary.summaryJson,
        text: toolSummary.text
      }
    }
    const messageKey = [
      requestId,
      frame.direction,
      summary.kind,
      summary.itemId ?? '',
      summary.callId ?? '',
      summary.text
    ].join('|')
    if (this.protocolMessageKeys.has(messageKey)) {
      return
    }
    this.protocolMessageKeys.add(messageKey)
    if (this.protocolMessageKeys.size > 1000) {
      this.protocolMessageKeys.clear()
    }

    this.log.info('WSS message', {
      id: requestId,
      path,
      accountId,
      direction: frame.direction,
      cachedInputTokens: summary.cachedInputTokens,
      kind: summary.kind,
      callId: summary.callId,
      inputItemCount: summary.inputItemCount,
      inputTokens: summary.inputTokens,
      itemId: summary.itemId,
      model: summary.model,
      outputTokens: summary.outputTokens,
      parentResponseId: summary.parentResponseId,
      payloadBytes: summary.payloadBytes,
      previousResponseId: summary.previousResponseId,
      protocolType: summary.protocolType,
      reasoningTokens: summary.reasoningTokens,
      responseId: summary.responseId,
      sequenceNumber: summary.sequenceNumber,
      summaryJson: summary.summaryJson,
      text: summary.text,
      toolCount: summary.toolCount,
      totalTokens: summary.totalTokens,
      truncated: summary.truncated
    })
    if (typeof this.ledger.recordProtocolMessage !== 'function') {
      return
    }
    this.ledger.recordProtocolMessage({
      requestId,
      path,
      accountId,
      conversationKey,
      direction: frame.direction,
      cachedInputTokens: summary.cachedInputTokens,
      callId: summary.callId,
      inputItemCount: summary.inputItemCount,
      inputTokens: summary.inputTokens,
      itemId: summary.itemId,
      kind: summary.kind,
      model: summary.model,
      outputTokens: summary.outputTokens,
      parentResponseId: summary.parentResponseId,
      payloadBytes: summary.payloadBytes,
      previousResponseId: summary.previousResponseId,
      protocolType: summary.protocolType,
      reasoningTokens: summary.reasoningTokens,
      responseId: summary.responseId,
      sequenceNumber: summary.sequenceNumber,
      summaryJson: summary.summaryJson,
      text: summary.text,
      toolCount: summary.toolCount,
      totalTokens: summary.totalTokens,
      truncated: summary.truncated
    })
    if (typeof this.ledger.recordTurnSummary === 'function') {
      this.recordTurnSummary(requestId, accountId, conversationKey, frame.direction, summary)
    }
  }

  private mergeToolSummary(
    requestId: string,
    conversationKey: string | undefined,
    summary: WebSocketSummary
  ): { summaryJson: string; text: string } | undefined {
    const tool = summary.tool
    if (!tool) {
      return { summaryJson: summary.summaryJson ?? '{}', text: summary.text }
    }

    const itemId = summary.itemId ?? tool.name ?? 'tool'
    const key = toolCorrelationKey(requestId, conversationKey, summary, itemId)
    const current = this.toolCallSummaries.get(key) ?? {}
    current.name = tool.name ?? current.name
    current.arguments = tool.arguments ?? current.arguments
    current.result = tool.result ?? current.result
    current.resultCount = tool.resultCount ?? current.resultCount
    this.toolCallSummaries.set(key, current)

    if (tool.phase !== 'completed') {
      return undefined
    }

    this.toolCallSummaries.delete(key)
    const name = current.name ?? 'unknown_tool'
    const parts = [`工具调用: ${name}`]
    if (current.arguments) {
      parts.push(`参数: ${current.arguments}`)
    }
    if (current.resultCount !== undefined) {
      parts.push(`结果: ${current.resultCount} 条`)
    } else if (current.result) {
      parts.push(`结果: ${current.result}`)
    } else {
      parts.push('结果: completed')
    }
    return {
      summaryJson: safeToolSummaryJson({
        arguments: current.arguments,
        result: current.result,
        resultCount: current.resultCount,
        tool: name
      }),
      text: truncateForLog(parts.join(' '))
    }
  }

  private recordTurnSummary(
    requestId: string,
    accountId: string | undefined,
    conversationKey: string | undefined,
    direction: string,
    summary: WebSocketSummary
  ): void {
    const contextKey = `${conversationKey ?? 'no-conversation'}:${requestId}`
    if (direction === 'codex-to-upstream' && summary.kind === 'user') {
      const turnKey = [
        conversationKey,
        requestId,
        summary.previousResponseId ?? summary.parentResponseId ?? 'root',
        summary.sequenceNumber ?? Date.now()
      ]
        .filter((value) => value !== undefined)
        .join(':')
      this.activeTurnKeys.set(contextKey, turnKey)
      this.ledger.recordTurnSummary({
        accountId,
        conversationKey,
        parentResponseId: summary.previousResponseId ?? summary.parentResponseId,
        requestId,
        startedAt: Date.now(),
        summaryJson: summary.summaryJson,
        turnKey,
        userText: summary.text.replace(/^用户请求:\s*/, '')
      })
      return
    }

    const turnKey =
      this.activeTurnKeys.get(contextKey) ??
      [conversationKey, requestId, summary.responseId, summary.parentResponseId]
        .filter((value) => value !== undefined)
        .join(':') ??
      requestId
    if (summary.kind === 'assistant') {
      this.ledger.recordTurnSummary({
        accountId,
        assistantText: summary.text.replace(/^AI 回复:\s*/, ''),
        conversationKey,
        parentResponseId: summary.parentResponseId,
        requestId,
        responseId: summary.responseId,
        summaryJson: summary.summaryJson,
        turnKey
      })
    } else if (summary.kind === 'usage') {
      this.ledger.recordTurnSummary({
        accountId,
        cachedInputTokens: summary.cachedInputTokens,
        completedAt: Date.now(),
        conversationKey,
        inputTokens: summary.inputTokens,
        outputTokens: summary.outputTokens,
        parentResponseId: summary.parentResponseId,
        reasoningTokens: summary.reasoningTokens,
        requestId,
        responseId: summary.responseId,
        status: 'completed',
        summaryJson: summary.summaryJson,
        totalTokens: summary.totalTokens,
        turnKey
      })
      this.activeTurnKeys.delete(contextKey)
    } else if (summary.kind === 'tool_call') {
      this.ledger.recordTurnSummary({
        accountId,
        conversationKey,
        parentResponseId: summary.parentResponseId,
        requestId,
        responseId: summary.responseId,
        summaryJson: summary.summaryJson,
        toolCallDelta: isCompletedToolProtocol(summary.protocolType) ? 1 : 0,
        toolResultDelta: isCompletedToolProtocol(summary.protocolType) ? 1 : 0,
        turnKey
      })
    } else if (summary.kind === 'tool_result') {
      this.ledger.recordTurnSummary({
        accountId,
        conversationKey,
        parentResponseId: summary.parentResponseId,
        requestId,
        responseId: summary.responseId,
        summaryJson: summary.summaryJson,
        toolResultDelta: 1,
        turnKey
      })
    } else if (summary.kind === 'error') {
      this.ledger.recordTurnSummary({
        accountId,
        completedAt: Date.now(),
        conversationKey,
        parentResponseId: summary.parentResponseId,
        requestId,
        responseId: summary.responseId,
        status: 'error',
        summaryJson: summary.summaryJson,
        turnKey
      })
      this.activeTurnKeys.delete(contextKey)
    }
  }
}

function toolCorrelationKey(
  requestId: string,
  conversationKey: string | undefined,
  summary: WebSocketSummary,
  itemId: string
): string {
  return [
    conversationKey ?? requestId,
    summary.responseId,
    summary.parentResponseId ?? summary.previousResponseId,
    summary.callId,
    itemId
  ]
    .filter((value): value is string => Boolean(value))
    .join(':')
}

function isCompletedToolProtocol(protocolType: string | undefined): boolean {
  return (
    protocolType === 'response.output_item.done' ||
    protocolType === 'response.output_item.completed'
  )
}

function safeToolSummaryJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return JSON.stringify({ text: String(value) })
  }
}
