import { describe, expect, it } from 'vitest'
import { formatTokenCost, tokenCostUsd } from './format'

describe('token cost formatting', () => {
  it('uses GPT-5.5 input, cached input, and output rates', () => {
    const cost = tokenCostUsd({
      cachedInputTokens: 200_000,
      inputTokens: 1_000_000,
      outputTokens: 100_000
    })

    expect(cost).toBe(7.1)
  })

  it('does not charge cached input tokens as standard input tokens', () => {
    expect(
      formatTokenCost(
        {
          cachedInputTokens: 1_000_000,
          inputTokens: 1_000_000,
          outputTokens: 0
        },
        'en'
      )
    ).toBe('$0.50')
  })
})
