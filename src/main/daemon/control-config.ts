import { randomBytes } from 'node:crypto'
import Database from 'better-sqlite3'

const defaultAdminHost = '127.0.0.1'
const defaultAdminPort = 44445

export interface DaemonControlConfig {
  adminHost: string
  adminPort: number
  adminToken: string
  launchAgentEnabled: boolean
}

export interface DaemonControlSettings {
  adminHost: string
  adminPort: number
  launchAgentEnabled: boolean
}

export interface DaemonControlUpdateInput {
  adminHost: string
  adminPort: number
  adminToken?: string
  launchAgentEnabled?: boolean
}

export interface DaemonControlReadResult {
  config: DaemonControlConfig
  generatedAdminToken: boolean
}

export interface DaemonControlUpdateResult {
  config: DaemonControlConfig
  settings: DaemonControlSettings
  changed: boolean
}

export function readDaemonControlConfig(databasePath: string): DaemonControlConfig {
  return readDaemonControlConfigWithStatus(databasePath).config
}

export function readDaemonControlConfigWithStatus(databasePath: string): DaemonControlReadResult {
  const sqlite = new Database(databasePath)
  try {
    return readControlConfig(sqlite)
  } finally {
    sqlite.close()
  }
}

export function readDaemonControlSettings(databasePath: string): DaemonControlSettings {
  const config = readDaemonControlConfig(databasePath)
  return {
    adminHost: config.adminHost,
    adminPort: config.adminPort,
    launchAgentEnabled: config.launchAgentEnabled
  }
}

export function updateDaemonControlConfig(
  databasePath: string,
  input: DaemonControlUpdateInput
): DaemonControlUpdateResult {
  const sqlite = new Database(databasePath)
  try {
    const current = readControlConfig(sqlite).config
    const adminHost = normalizeAdminHost(input.adminHost)
    const adminPort = normalizeAdminPort(input.adminPort)
    const tokenInput = input.adminToken?.trim()
    const adminToken = tokenInput ? normalizeAdminToken(tokenInput) : current.adminToken
    const launchAgentEnabled =
      typeof input.launchAgentEnabled === 'boolean'
        ? input.launchAgentEnabled
        : current.launchAgentEnabled

    upsertSetting(sqlite, 'daemon.adminHost', adminHost)
    upsertSetting(sqlite, 'daemon.adminPort', String(adminPort))
    upsertSetting(sqlite, 'daemon.adminToken', adminToken)
    if (typeof launchAgentEnabled === 'boolean') {
      upsertSetting(sqlite, 'daemon.launchAgentEnabled', String(launchAgentEnabled))
    }

    return {
      changed:
        adminHost !== current.adminHost ||
        adminPort !== current.adminPort ||
        adminToken !== current.adminToken ||
        launchAgentEnabled !== current.launchAgentEnabled,
      config: {
        adminHost,
        adminPort,
        adminToken,
        launchAgentEnabled
      },
      settings: {
        adminHost,
        adminPort,
        launchAgentEnabled
      }
    }
  } finally {
    sqlite.close()
  }
}

export function daemonAdminEndpoint(config: DaemonControlConfig): string {
  return `http://${config.adminHost}:${config.adminPort}/admin`
}

function readControlConfig(sqlite: Database.Database): DaemonControlReadResult {
  ensureProxySettingsTable(sqlite)
  const adminHost = readStringSetting(sqlite, 'daemon.adminHost') ?? defaultAdminHost
  const adminPort = readPortSetting(sqlite, 'daemon.adminPort') ?? defaultAdminPort
  const launchAgentEnabled = readBooleanSetting(sqlite, 'daemon.launchAgentEnabled')
  const storedToken = readStringSetting(sqlite, 'daemon.adminToken')
  if (storedToken) {
    return {
      config: {
        adminHost,
        adminPort,
        adminToken: normalizeAdminToken(storedToken),
        launchAgentEnabled
      },
      generatedAdminToken: false
    }
  }

  const adminToken = randomBytes(32).toString('hex')
  upsertSetting(sqlite, 'daemon.adminToken', adminToken)
  return {
    config: {
      adminHost,
      adminPort,
      adminToken,
      launchAgentEnabled
    },
    generatedAdminToken: true
  }
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

function readStringSetting(sqlite: Database.Database, key: string): string | undefined {
  const row = sqlite.prepare('SELECT value FROM proxy_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  const value = row?.value.trim()
  return value && value.length > 0 ? value : undefined
}

function readPortSetting(sqlite: Database.Database, key: string): number | undefined {
  const value = readStringSetting(sqlite, key)
  if (!value) {
    return undefined
  }
  const port = Number.parseInt(value, 10)
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined
}

function readBooleanSetting(sqlite: Database.Database, key: string): boolean {
  const value = readStringSetting(sqlite, key)?.toLowerCase()
  if (value === 'true') {
    return true
  }
  return false
}

function normalizeAdminHost(value: string): string {
  const host = value.trim()
  if (!host) {
    throw new Error('Daemon admin host is required')
  }
  if (host.includes('://') || host.includes('/') || host.includes(' ')) {
    throw new Error(`Invalid daemon admin host: ${host}`)
  }
  return host
}

function normalizeAdminPort(value: number): number {
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new Error(`Invalid daemon admin port: ${value}`)
  }
  return value
}

function normalizeAdminToken(value: string): string {
  const token = value.trim()
  if (token.length < 16) {
    throw new Error('Daemon admin token must be at least 16 characters')
  }
  return token
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
