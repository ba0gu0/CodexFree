import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultProxyConfig, readManagedProxyConfig, writeProxyConfig } from './config'

describe('proxy config', () => {
  it('forces the app-managed auth pool directory when reading and writing', () => {
    const root = mkdtempSync(join(tmpdir(), 'codexfree-config-'))
    const configPath = join(root, 'proxy-config.json')
    const managedDirectory = join(root, 'auth-pool')
    const legacyDirectory = join(root, 'legacy-auth-pool')

    const saved = writeProxyConfig(
      configPath,
      {
        ...defaultProxyConfig,
        authPool: {
          enabled: true,
          directory: legacyDirectory
        }
      },
      managedDirectory
    )

    expect(saved.authPool).toEqual({ enabled: true, directory: managedDirectory })
    expect(JSON.parse(readFileSync(configPath, 'utf8')).authPool.directory).toBe(managedDirectory)

    const loaded = readManagedProxyConfig(configPath, managedDirectory)
    expect(loaded.authPool).toEqual({ enabled: true, directory: managedDirectory })
  })
})
