import { describe, expect, it } from 'vitest'
import { summarizeServerSentEvents } from './sse-summary'

describe('SSE protocol summary', () => {
  it('parses a complete HTTP SSE turn into protocol messages and a turn summary', () => {
    const result = summarizeServerSentEvents({
      accountId: 'account-1',
      conversationKey: 'conversation-1',
      path: '/backend-api/codex/responses',
      requestBody: Buffer.from(
        JSON.stringify({
          input: [{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }],
          model: 'gpt-5.5',
          previous_response_id: 'resp-parent',
          tools: [{ name: 'exec_command' }]
        })
      ),
      requestId: 'request-1',
      responseBody: Buffer.from(
        [
          'event: response.output_text.done',
          'data: {"type":"response.output_text.done","response_id":"resp-1","text":"hi"}',
          '',
          'event: response.completed',
          'data: {"type":"response.completed","response":{"id":"resp-1","status":"completed","usage":{"input_tokens":10,"input_tokens_details":{"cached_tokens":4},"output_tokens":5,"output_tokens_details":{"reasoning_tokens":2},"total_tokens":15}}}'
        ].join('\n')
      )
    })

    expect(result.messages).toEqual([
      expect.objectContaining({
        direction: 'codex-to-upstream',
        kind: 'user',
        parentResponseId: 'resp-parent',
        text: '用户请求: hello'
      }),
      expect.objectContaining({
        direction: 'upstream-to-codex',
        kind: 'assistant',
        responseId: 'resp-1',
        text: 'AI 回复: hi'
      }),
      expect.objectContaining({
        cachedInputTokens: 4,
        inputTokens: 10,
        kind: 'usage',
        outputTokens: 5,
        reasoningTokens: 2,
        totalTokens: 15
      })
    ])
    expect(result.turnSummary).toMatchObject({
      assistantText: 'hi',
      inputTokens: 10,
      parentResponseId: 'resp-parent',
      responseId: 'resp-1',
      status: 'completed',
      totalTokens: 15,
      userText: 'hello'
    })
  })
})
