import { homedir } from 'node:os'
import { join } from 'node:path'
import { env, platform } from 'node:process'

export interface DaemonPathOptions {
  adminTokenPath?: string
  authPoolDir?: string
  configPath?: string
  dataDir?: string
  databasePath?: string
}

export interface DaemonPaths {
  adminTokenPath: string
  authPoolDir: string
  configPath: string
  dataDir: string
  databasePath: string
  rawCaptureDir: string
}

export function resolveDaemonPaths(options: DaemonPathOptions): DaemonPaths {
  const dataDir = options.dataDir ?? defaultDataDir()
  return {
    adminTokenPath: options.adminTokenPath ?? join(dataDir, 'admin-token'),
    authPoolDir: options.authPoolDir ?? join(dataDir, 'auth-pool'),
    configPath: options.configPath ?? join(dataDir, 'proxy-config.json'),
    dataDir,
    databasePath: options.databasePath ?? join(dataDir, 'codexfree.sqlite'),
    rawCaptureDir: join(dataDir, 'raw-captures')
  }
}

function defaultDataDir(): string {
  if (platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'codexfree')
  }
  if (platform === 'win32') {
    return join(env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'codexfree')
  }
  return join(env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'codexfree')
}
