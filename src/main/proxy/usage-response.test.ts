import { describe, expect, it } from 'vitest'
import { extractUsageResponse, isUsageQuotaProtected } from './usage-response'

describe('usage response extraction', () => {
  it('parses current team usage responses with 5-hour and weekly windows', () => {
    const usage = extractUsageResponse({
      account_id: 'team-account',
      email: 'team@example.test',
      plan_type: 'team',
      rate_limit: {
        allowed: true,
        limit_reached: false,
        primary_window: {
          limit_window_seconds: 18_000,
          reset_after_seconds: 15_862,
          reset_at: 1_780_927_748,
          used_percent: 10
        },
        secondary_window: {
          limit_window_seconds: 604_800,
          reset_after_seconds: 584_805,
          reset_at: 1_781_496_691,
          used_percent: 7
        }
      }
    })

    expect(usage).toEqual({
      planType: 'team',
      primaryUsedPercent: '10',
      rateLimitResetsAt: 1_780_927_748_000,
      secondaryRateLimitResetsAt: 1_781_496_691_000,
      secondaryUsedPercent: '7'
    })
  })

  it('treats either quota window as protected at the guard threshold', () => {
    expect(isUsageQuotaProtected('10', '99')).toBe(true)
    expect(isUsageQuotaProtected('10', '94')).toBe(false)
  })
})
