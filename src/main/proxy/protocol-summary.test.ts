import { describe, expect, it } from 'vitest'
import { summarizeWebSocketFrame } from './protocol-summary'
import type { CapturedWebSocketFrame } from './websocket-capture'

describe('websocket protocol summary', () => {
  it('extracts real usage tokens from response.completed frames', () => {
    const summary = summarizeWebSocketFrame(
      textFrame({
        response: {
          id: 'resp-1',
          model: 'gpt-5.5',
          status: 'completed',
          usage: {
            input_tokens: 10915,
            input_tokens_details: { cached_tokens: 4096 },
            output_tokens: 25,
            output_tokens_details: { reasoning_tokens: 7 },
            total_tokens: 10940
          }
        },
        sequence_number: 2,
        type: 'response.completed'
      })
    )

    expect(summary).toMatchObject({
      cachedInputTokens: 4096,
      inputTokens: 10915,
      kind: 'usage',
      outputTokens: 25,
      reasoningTokens: 7,
      responseId: 'resp-1',
      sequenceNumber: 2,
      totalTokens: 10940
    })
  })

  it('does not estimate tokens when usage is absent', () => {
    const summary = summarizeWebSocketFrame(
      textFrame({
        output_index: 0,
        sequence_number: 3,
        text: 'hello world',
        type: 'response.output_text.done'
      })
    )

    expect(summary).toMatchObject({
      kind: 'assistant',
      text: 'AI 回复: hello world'
    })
    expect(summary).not.toHaveProperty('inputTokens')
    expect(summary).not.toHaveProperty('totalTokens')
  })

  it('extracts response.create routing fields without token counts', () => {
    const summary = summarizeWebSocketFrame(
      textFrame(
        {
          input: [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
          model: 'gpt-5.5',
          previous_response_id: 'resp-old',
          reasoning: { effort: 'medium' },
          tools: [{ name: 'exec_command', type: 'function' }],
          type: 'response.create'
        },
        'codex-to-upstream'
      )
    )

    expect(summary).toMatchObject({
      inputItemCount: 1,
      kind: 'user',
      model: 'gpt-5.5',
      previousResponseId: 'resp-old',
      text: '用户请求: hi',
      toolCount: 1
    })
    expect(summary).not.toHaveProperty('inputTokens')
  })
})

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
