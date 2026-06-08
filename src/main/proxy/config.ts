import Database from 'better-sqlite3'
import * as v from 'valibot'
import type { ProxyConfig } from './types'

const outboundProxySchema = v.object({
  mode: v.picklist(['direct', 'http', 'https', 'socks4', 'socks5']),
  url: v.string()
})

const authPoolSchema = v.object({
  enabled: v.boolean(),
  directory: v.string()
})

const proxyConfigSchema = v.object({
  listenHost: v.pipe(v.string(), v.minLength(1)),
  listenPort: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535)),
  upstreamBaseUrl: v.pipe(v.string(), v.url()),
  outboundProxy: outboundProxySchema,
  authPool: authPoolSchema,
  maxRequestBodyBytes: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(50_000_000)),
  rawCaptureEnabled: v.boolean(),
  rawCaptureMaxBytes: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(50_000_000))
})

export const defaultProxyConfig: ProxyConfig = {
  listenHost: '127.0.0.1',
  listenPort: 33333,
  upstreamBaseUrl: 'https://chatgpt.com/backend-api/codex',
  outboundProxy: {
    mode: 'direct',
    url: ''
  },
  authPool: {
    enabled: true,
    directory: ''
  },
  maxRequestBodyBytes: 0,
  rawCaptureEnabled: false,
  rawCaptureMaxBytes: 0
}

export function withManagedAuthPoolDirectory(
  config: ProxyConfig,
  managedAuthPoolDirectory: string
): ProxyConfig {
  return {
    ...config,
    authPool: {
      enabled: true,
      directory: managedAuthPoolDirectory
    }
  }
}

export function readManagedProxyConfig(
  databasePath: string,
  managedAuthPoolDirectory: string
): ProxyConfig {
  const sqlite = new Database(databasePath)
  try {
    ensureProxySettingsTable(sqlite)
    const saved = readProxyConfigValue(sqlite)
    return withManagedAuthPoolDirectory(saved, managedAuthPoolDirectory)
  } finally {
    sqlite.close()
  }
}

export function writeProxyConfig(
  databasePath: string,
  config: ProxyConfig,
  managedAuthPoolDirectory = config.authPool.directory
): ProxyConfig {
  const parsed = v.parse(
    proxyConfigSchema,
    withManagedAuthPoolDirectory(config, managedAuthPoolDirectory)
  )
  const sqlite = new Database(databasePath)
  try {
    ensureProxySettingsTable(sqlite)
    upsertSetting(sqlite, 'proxy.config', JSON.stringify(parsed))
  } finally {
    sqlite.close()
  }
  return parsed
}

function readProxyConfigValue(sqlite: Database.Database): ProxyConfig {
  const row = sqlite
    .prepare('SELECT value FROM proxy_settings WHERE key = ?')
    .get('proxy.config') as { value: string } | undefined
  if (!row) {
    return defaultProxyConfig
  }
  const parsed = JSON.parse(row.value) as unknown
  const saved = typeof parsed === 'object' && parsed !== null ? parsed : {}
  return v.parse(proxyConfigSchema, { ...defaultProxyConfig, ...saved })
}

function ensureProxySettingsTable(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS proxy_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
}

function upsertSetting(sqlite: Database.Database, key: string, value: string): void {
  sqlite
    .prepare(
      `
        INSERT INTO proxy_settings (key, value, updated_at)
        VALUES (@key, @value, @updatedAt)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `
    )
    .run({
      key,
      updatedAt: Date.now(),
      value
    })
}
