import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readDaemonControlSettings, updateDaemonControlConfig } from './control-config'

describe('daemon control config', () => {
  it('persists the desired startup-service mode in the database', () => {
    const root = mkdtempSync(join(tmpdir(), 'codexfree-control-config-'))
    const databasePath = join(root, 'codexfree.sqlite')
    try {
      expect(readDaemonControlSettings(databasePath).launchAgentEnabled).toBe(false)

      updateDaemonControlConfig(databasePath, {
        adminHost: '127.0.0.1',
        adminPort: 44445,
        launchAgentEnabled: true
      })
      expect(readDaemonControlSettings(databasePath).launchAgentEnabled).toBe(true)

      updateDaemonControlConfig(databasePath, {
        adminHost: '127.0.0.1',
        adminPort: 44445
      })
      expect(readDaemonControlSettings(databasePath).launchAgentEnabled).toBe(true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })
})
