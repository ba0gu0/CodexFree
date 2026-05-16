import { describe, expect, it } from 'vitest'
import { formatQuotaLedgerMessage, parseQuotaExhaustionEvent } from './quota'

describe('quota websocket event parsing', () => {
  it('extracts usage limit details from decoded websocket errors', () => {
    const event = parseQuotaExhaustionEvent(
      JSON.stringify({
        type: 'error',
        status_code: 429,
        error: {
          type: 'usage_limit_reached'
        },
        headers: {
          'X-Codex-Plan-Type': 'free',
          'X-Codex-Active-Limit': 'premium',
          'X-Codex-Primary-Used-Percent': '100',
          'X-Codex-Primary-Reset-At': '2026-05-20T03:15:00Z'
        }
      })
    )

    expect(event).toEqual({
      errorType: 'usage_limit_reached',
      statusCode: 429,
      planType: 'free',
      activeLimit: 'premium',
      primaryUsedPercent: '100',
      resetsAt: '2026-05-20T03:15:00Z'
    })
    expect(event ? formatQuotaLedgerMessage(event) : '').toContain('usage_limit_reached')
  })

  it('ignores non-quota websocket messages', () => {
    expect(parseQuotaExhaustionEvent('{"type":"response.completed"}')).toBeUndefined()
    expect(parseQuotaExhaustionEvent('not json')).toBeUndefined()
  })
})
