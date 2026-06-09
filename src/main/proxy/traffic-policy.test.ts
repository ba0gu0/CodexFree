import { describe, expect, it } from 'vitest'
import { shouldRecordProxyRequest, shouldUseManagedAccountHeaders } from './traffic-policy'

describe('proxy traffic policy', () => {
  it('uses managed account headers only for core account requests', () => {
    expect(shouldUseManagedAccountHeaders('/backend-api/codex/responses')).toBe(true)
    expect(shouldUseManagedAccountHeaders('/backend-api/codex/responses/compact')).toBe(true)
    expect(shouldUseManagedAccountHeaders('/backend-api/codex/models')).toBe(true)
    expect(shouldUseManagedAccountHeaders('/backend-api/wham/usage')).toBe(true)
    expect(shouldUseManagedAccountHeaders('/backend-api/codex/analytics-events/events')).toBe(false)
    expect(shouldUseManagedAccountHeaders('/backend-api/ps/plugins/installed')).toBe(false)
    expect(shouldUseManagedAccountHeaders('/backend-api/ps/plugins/list')).toBe(false)
    expect(shouldUseManagedAccountHeaders('/backend-api/wham/apps')).toBe(false)
    expect(shouldUseManagedAccountHeaders('/backend-api/plugins/featured')).toBe(false)
  })

  it('records forwarded rows only for core request events', () => {
    expect(
      shouldRecordProxyRequest({ outcome: 'forwarded', path: '/backend-api/codex/responses' })
    ).toBe(true)
    expect(
      shouldRecordProxyRequest({ outcome: 'forwarded', path: '/backend-api/wham/usage' })
    ).toBe(true)
    expect(
      shouldRecordProxyRequest({ outcome: 'forwarded', path: '/backend-api/codex/models' })
    ).toBe(false)
    expect(
      shouldRecordProxyRequest({
        outcome: 'forwarded',
        path: '/backend-api/codex/analytics-events/events'
      })
    ).toBe(false)
    expect(
      shouldRecordProxyRequest({ outcome: 'failed', path: '/backend-api/plugins/featured' })
    ).toBe(true)
  })
})
