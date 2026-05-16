import { describe, expect, it } from 'vitest'
import { resolveAccountUpstreamPath } from './path-utils'

describe('proxy path utilities', () => {
  it('does not duplicate native backend-api/codex paths', () => {
    expect(resolveAccountUpstreamPath('/backend-api/codex', '/backend-api/codex/models')).toBe(
      '/backend-api/codex/models'
    )
  })

  it('preserves sibling backend-api paths used by chatgpt_base_url', () => {
    expect(resolveAccountUpstreamPath('/backend-api/codex', '/backend-api/wham/apps')).toBe(
      '/backend-api/wham/apps'
    )
  })
})
