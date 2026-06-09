import { describe, expect, it } from 'vitest'
import { ProxyLedger } from './ledger'
import { ProtocolMessageLogger } from './protocol-message-logger'
import type { CapturedWebSocketFrame } from './websocket-capture'

describe('protocol message logger', () => {
  it('stores normal WSS activity as turn summaries without protocol detail rows', () => {
    const ledger = new ProxyLedger(':memory:')
    try {
      const logger = new ProtocolMessageLogger(ledger, noopLog)
      const context = {
        accountId: 'account-1',
        conversationKey: 'conversation-1',
        path: '/backend-api/codex/responses',
        requestId: 'request-1'
      }

      logger.logFrame(
        context.requestId,
        context.path,
        context.accountId,
        context.conversationKey,
        textFrame(
          {
            input: [{ role: 'user', content: [{ type: 'input_text', text: 'run tests' }] }],
            model: 'gpt-5.5',
            tools: [{ name: 'shell_exec' }],
            type: 'response.create'
          },
          'codex-to-upstream'
        )
      )
      logger.logFrame(
        context.requestId,
        context.path,
        context.accountId,
        context.conversationKey,
        textFrame({
          item: {
            call_id: 'call-1',
            id: 'item-1',
            name: 'shell_exec',
            type: 'function_call'
          },
          response_id: 'resp-1',
          type: 'response.output_item.added'
        })
      )
      logger.logFrame(
        context.requestId,
        context.path,
        context.accountId,
        context.conversationKey,
        textFrame({
          arguments: '{"cmd":"bun run test"}',
          call_id: 'call-1',
          item_id: 'item-1',
          response_id: 'resp-1',
          type: 'response.function_call_arguments.done'
        })
      )
      logger.logFrame(
        context.requestId,
        context.path,
        context.accountId,
        context.conversationKey,
        textFrame({
          item: {
            call_id: 'call-1',
            id: 'item-1',
            name: 'shell_exec',
            output: 'all tests passed',
            type: 'function_call'
          },
          response_id: 'resp-1',
          type: 'response.output_item.done'
        })
      )
      logger.logFrame(
        context.requestId,
        context.path,
        context.accountId,
        context.conversationKey,
        textFrame({
          output_index: 0,
          response_id: 'resp-1',
          text: 'done',
          type: 'response.output_text.done'
        })
      )
      logger.logFrame(
        context.requestId,
        context.path,
        context.accountId,
        context.conversationKey,
        textFrame({
          response: {
            id: 'resp-1',
            model: 'gpt-5.5',
            status: 'completed',
            usage: {
              input_tokens: 10,
              input_tokens_details: { cached_tokens: 4 },
              output_tokens: 5,
              output_tokens_details: { reasoning_tokens: 2 },
              total_tokens: 15
            }
          },
          type: 'response.completed'
        })
      )

      expect(ledger.recentProtocolMessages()).toEqual([])
      expect(ledger.recentTurnSummaries()).toEqual([
        expect.objectContaining({
          assistantText: 'done',
          inputTokens: 10,
          summaryJson: JSON.stringify({
            model: 'gpt-5.5',
            responseId: 'resp-1',
            status: 'completed'
          }),
          toolCallCount: 1,
          toolResultCount: 1,
          totalTokens: 15,
          userText: 'run tests'
        })
      ])
    } finally {
      ledger.close()
    }
  })

  it('keeps WSS errors as protocol detail rows', () => {
    const ledger = new ProxyLedger(':memory:')
    try {
      const logger = new ProtocolMessageLogger(ledger, noopLog)

      logger.logFrame(
        'request-1',
        '/backend-api/codex/responses',
        'account-1',
        'conversation-1',
        textFrame({
          error: { message: 'upstream failed', type: 'server_error' },
          type: 'error'
        })
      )

      expect(ledger.recentProtocolMessages()).toEqual([
        expect.objectContaining({
          kind: 'error',
          text: '错误: server_error upstream failed'
        })
      ])
    } finally {
      ledger.close()
    }
  })
})

const noopLog = {
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined
}

function textFrame(
  payload: Record<string, unknown>,
  direction: CapturedWebSocketFrame['direction'] = 'upstream-to-codex'
): CapturedWebSocketFrame {
  const payloadText = JSON.stringify(payload)
  return {
    direction,
    opcode: 'text',
    opcodeValue: 1,
    payloadBytes: Buffer.byteLength(payloadText),
    payloadText,
    truncated: false
  }
}
