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
    if (summary.kind === 'tool' && summary.tool) {
      const toolText = this.mergeToolSummary(requestId, summary)
      if (!toolText) {
        return
      }
      summary = { ...summary, text: toolText }
    }
    const messageKey = [
      requestId,
      frame.direction,
      summary.kind,
      summary.itemId ?? '',
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
      inputItemCount: summary.inputItemCount,
      inputTokens: summary.inputTokens,
      model: summary.model,
      outputTokens: summary.outputTokens,
      payloadBytes: summary.payloadBytes,
      previousResponseId: summary.previousResponseId,
      protocolType: summary.protocolType,
      reasoningTokens: summary.reasoningTokens,
      responseId: summary.responseId,
      sequenceNumber: summary.sequenceNumber,
      text: summary.text,
      toolCount: summary.toolCount,
      totalTokens: summary.totalTokens,
      truncated: summary.truncated
    })
    this.ledger.recordProtocolMessage({
      requestId,
      path,
      accountId,
      conversationKey,
      direction: frame.direction,
      cachedInputTokens: summary.cachedInputTokens,
      inputItemCount: summary.inputItemCount,
      inputTokens: summary.inputTokens,
      kind: summary.kind,
      model: summary.model,
      outputTokens: summary.outputTokens,
      payloadBytes: summary.payloadBytes,
      previousResponseId: summary.previousResponseId,
      protocolType: summary.protocolType,
      reasoningTokens: summary.reasoningTokens,
      responseId: summary.responseId,
      sequenceNumber: summary.sequenceNumber,
      text: summary.text,
      toolCount: summary.toolCount,
      totalTokens: summary.totalTokens,
      truncated: summary.truncated
    })
  }

  private mergeToolSummary(requestId: string, summary: WebSocketSummary): string | undefined {
    const tool = summary.tool
    if (!tool) {
      return summary.text
    }

    const itemId = summary.itemId ?? tool.name ?? 'tool'
    const key = `${requestId}:${itemId}`
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
    return truncateForLog(parts.join(' '))
  }
}
