import { describe, expect, it } from 'vitest'
import { isWhamRemotePath, resolveAccountUpstreamPath } from './path-utils'

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

  it('matches only wham remote paths for original auth preservation', () => {
    expect(isWhamRemotePath('/backend-api/wham/remote')).toBe(true)
    expect(isWhamRemotePath('/backend-api/wham/remote/session?probe=1')).toBe(true)
    expect(isWhamRemotePath('/backend-api/wham/remote-control')).toBe(false)
    expect(isWhamRemotePath('/backend-api/wham/usage')).toBe(false)
  })
})
