import { zstdCompressSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { summarizeServerSentEvents } from './sse-summary'

describe('SSE protocol summary', () => {
  it('parses a complete HTTP SSE turn into a compact turn summary', () => {
    const requestBody = zstdCompressSync(
      Buffer.from(
        JSON.stringify({
          input: [{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }],
          model: 'gpt-5.5',
          previous_response_id: 'resp-parent',
          tools: [{ name: 'exec_command' }]
        })
      )
    )
    const result = summarizeServerSentEvents({
      accountId: 'account-1',
      conversationKey: 'conversation-1',
      path: '/backend-api/codex/responses',
      requestBody,
      requestBodyEncoding: 'zstd',
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

    expect(result.messages).toEqual([])
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

  it('keeps SSE error events in protocol messages for troubleshooting', () => {
    const result = summarizeServerSentEvents({
      accountId: 'account-1',
      conversationKey: 'conversation-1',
      path: '/backend-api/codex/responses',
      requestBody: Buffer.from(
        JSON.stringify({
          input: [{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }],
          model: 'gpt-5.5'
        })
      ),
      requestId: 'request-1',
      responseBody: Buffer.from(
        [
          'event: error',
          'data: {"type":"error","error":{"type":"server_error","message":"upstream failed"}}',
          ''
        ].join('\n')
      )
    })

    expect(result.messages).toEqual([
      expect.objectContaining({
        direction: 'upstream-to-codex',
        kind: 'error',
        text: '错误: server_error upstream failed'
      })
    ])
    expect(result.turnSummary).toMatchObject({
      status: 'error',
      userText: 'hello'
    })
  })
})
