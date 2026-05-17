import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { defaultProxyConfig, readManagedProxyConfig, writeProxyConfig } from './config'

describe('proxy config', () => {
  it('forces the app-managed auth pool directory when reading and writing', () => {
    const root = mkdtempSync(join(tmpdir(), 'codexfree-config-'))
    const databasePath = join(root, 'codexfree.sqlite')
    const managedDirectory = join(root, 'auth-pool')
    const legacyDirectory = join(root, 'legacy-auth-pool')

    const saved = writeProxyConfig(
      databasePath,
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
    const sqlite = new Database(databasePath, { readonly: true })
    try {
      const row = sqlite
        .prepare('SELECT value FROM proxy_settings WHERE key = ?')
        .get('proxy.config') as { value: string }
      expect(JSON.parse(row.value).authPool.directory).toBe(managedDirectory)
    } finally {
      sqlite.close()
    }

    const loaded = readManagedProxyConfig(databasePath, managedDirectory)
    expect(loaded.authPool).toEqual({ enabled: true, directory: managedDirectory })
  })
})
