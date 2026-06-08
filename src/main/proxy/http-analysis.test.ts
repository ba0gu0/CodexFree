import { zstdCompressSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { analyzeHttpTraffic } from './http-analysis'

describe('HTTP traffic analysis', () => {
  it('extracts Codex turn metadata and request body fields', () => {
    const analysis = analyzeHttpTraffic({
      method: 'GET',
      path: '/backend-api/codex/responses',
      requestBody: Buffer.alloc(0),
      requestHeaders: {
        'content-type': 'application/json',
        'user-agent': 'codex-tui/0.130.0 (Alpine Linux 3.23.4; aarch64)',
        originator: 'codex-tui',
        'x-codex-turn-metadata': JSON.stringify({
          session_id: 'session-1',
          thread_id: 'thread-1',
          turn_id: 'turn-1',
          turn_started_at_unix_ms: 1778682405263
        })
      }
    })

    expect(analysis).toMatchObject({
      codexSessionId: 'session-1',
      codexThreadId: 'thread-1',
      codexTurnId: 'turn-1',
      codexTurnStartedAt: 1778682405263,
      codexVersion: '0.130.0',
      originator: 'codex-tui',
      requestContentType: 'application/json',
      requestPurpose: 'codex_wss'
    })
  })

  it('extracts analytics runtime and model fields', () => {
    const analysis = analyzeHttpTraffic({
      method: 'POST',
      path: '/backend-api/codex/analytics-events/events',
      requestBody: Buffer.from(
        JSON.stringify({
          events: [
            {
              event_type: 'turn_started',
              event_params: {
                app_server_client: { client_version: '0.130.0' },
                model: 'gpt-5.5',
                runtime: {
                  codex_rs_version: '0.130.0',
                  runtime_arch: 'aarch64',
                  runtime_os: 'linux'
                },
                thread_id: 'thread-2',
                input_tokens: 120,
                cached_input_tokens: 80,
                output_tokens: 12,
                reasoning_output_tokens: 3,
                total_tokens: 132
              }
            }
          ]
        })
      ),
      requestHeaders: {}
    })

    expect(analysis).toMatchObject({
      codexRuntimeArch: 'aarch64',
      codexRuntimeOs: 'linux',
      codexThreadId: 'thread-2',
      codexVersion: '0.130.0',
      analyticsEventTypes: 'turn_started',
      cachedInputTokens: 80,
      inputTokens: 120,
      outputTokens: 12,
      reasoningTokens: 3,
      requestModel: 'gpt-5.5',
      requestPurpose: 'analytics_events',
      tokenUsageSource: 'analytics_event',
      totalTokens: 132
    })
  })

  it('extracts response plan and model summary fields', () => {
    const analysis = analyzeHttpTraffic({
      method: 'GET',
      path: '/backend-api/wham/usage',
      requestBody: Buffer.alloc(0),
      requestHeaders: {},
      responseBody: Buffer.from(
        JSON.stringify({
          model: 'gpt-5.5',
          plan_type: 'free',
          rate_limit: {
            primary_window: {
              reset_at: 1779765695,
              used_percent: 3
            }
          }
        })
      ),
      responseHeaders: { 'content-type': 'application/json' }
    })

    expect(analysis).toMatchObject({
      requestPurpose: 'account_usage',
      responseContentType: 'application/json',
      responseModel: 'gpt-5.5',
      responsePlanType: 'free',
      responsePrimaryUsedPercent: '3',
      responseRateLimitResetAt: 1779765695000
    })
    expect(JSON.parse(analysis.summaryJson ?? '{}')).toMatchObject({
      planType: 'free',
      primaryRemainingPercent: 97,
      primaryUsedPercent: '3',
      purpose: 'account_usage'
    })
  })

  it('extracts token usage from Codex response SSE body', () => {
    const requestBody = zstdCompressSync(
      Buffer.from(
        JSON.stringify({
          input: [{ content: [{ text: 'hello', type: 'input_text' }], role: 'user' }],
          model: 'gpt-5.5'
        })
      )
    )
    const analysis = analyzeHttpTraffic({
      method: 'POST',
      path: '/backend-api/codex/responses',
      requestBody,
      requestHeaders: {
        accept: 'text/event-stream',
        'content-encoding': 'zstd',
        'content-type': 'application/json'
      },
      responseBody: Buffer.from(
        [
          'event: response.created',
          'data: {"type":"response.created","response":{"usage":null}}',
          '',
          'event: response.completed',
          'data: {"type":"response.completed","response":{"usage":{"input_tokens":94642,"input_tokens_details":{"cached_tokens":91520},"output_tokens":275,"output_tokens_details":{"reasoning_tokens":18},"total_tokens":94917}}}'
        ].join('\n')
      ),
      responseHeaders: {
        'content-type': 'text/event-stream',
        'x-codex-plan-type': 'plus',
        'x-codex-primary-used-percent': '92',
        'x-codex-primary-reset-at': '1779288431'
      }
    })

    expect(analysis).toMatchObject({
      cachedInputTokens: 91520,
      inputTokens: 94642,
      outputTokens: 275,
      reasoningTokens: 18,
      requestInputItemCount: 1,
      requestBodyEncoding: 'zstd',
      requestModel: 'gpt-5.5',
      requestPurpose: 'codex_response_sse',
      responsePlanType: 'plus',
      responsePrimaryUsedPercent: '92',
      responseRateLimitResetAt: 1779288431000,
      tokenUsageSource: 'sse',
      totalTokens: 94917
    })
    expect(JSON.parse(analysis.summaryJson ?? '{}')).toMatchObject({
      purpose: 'codex_response_sse',
      tokenUsage: { totalTokens: 94917 },
      userText: 'hello'
    })
  })

  it('extracts RPC and catalog item counts from supporting endpoints', () => {
    const analysis = analyzeHttpTraffic({
      method: 'POST',
      path: '/backend-api/wham/apps',
      requestBody: Buffer.from(JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'apps.list' })),
      requestHeaders: {
        'content-type': 'application/json',
        'content-encoding': 'zstd'
      },
      responseBody: Buffer.from(JSON.stringify({ result: { apps: [{ id: 'github' }] } })),
      responseHeaders: { 'content-type': 'application/json' }
    })

    expect(analysis).toMatchObject({
      requestBodyEncoding: 'zstd',
      requestPurpose: 'wham_apps',
      responseItemCount: 1,
      rpcId: '1',
      rpcMethod: 'apps.list'
    })
  })

  it('identifies installed plugin requests for request totals', () => {
    const analysis = analyzeHttpTraffic({
      method: 'GET',
      path: '/backend-api/ps/plugins/installed?scope=WORKSPACE',
      requestBody: Buffer.alloc(0),
      requestHeaders: {},
      responseBody: Buffer.from(JSON.stringify({ items: [{ id: 'browser' }] })),
      responseHeaders: { 'content-type': 'application/json' }
    })

    expect(analysis).toMatchObject({
      requestPurpose: 'plugin_installed',
      responseItemCount: 1
    })
    expect(JSON.parse(analysis.summaryJson ?? '{}')).toMatchObject({
      itemCount: 1,
      purpose: 'plugin_installed'
    })
  })

  it('summarizes compact compression ratio from request and response bytes', () => {
    const analysis = analyzeHttpTraffic({
      method: 'POST',
      path: '/backend-api/codex/responses/compact',
      requestBody: Buffer.from(JSON.stringify({ input: ['x'.repeat(100)] })),
      requestHeaders: { 'content-type': 'application/json' },
      responseBody: Buffer.from(JSON.stringify({ output: [{ type: 'message' }] })),
      responseHeaders: { 'content-type': 'application/json' }
    })

    expect(analysis.requestPurpose).toBe('codex_compact')
    expect(JSON.parse(analysis.summaryJson ?? '{}')).toMatchObject({
      outputItems: 1,
      purpose: 'codex_compact'
    })
  })
})
