import { describe, expect, it } from 'vitest'
import { isOverviewHiddenPath } from './dashboard-model'

describe('dashboard model', () => {
  it('hides installed plugin support requests from overview activity', () => {
    expect(isOverviewHiddenPath('/backend-api/ps/plugins/installed?scope=WORKSPACE')).toBe(true)
    expect(isOverviewHiddenPath('/backend-api/codex/responses')).toBe(false)
  })
})
