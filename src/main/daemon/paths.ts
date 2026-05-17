import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { env, platform } from 'node:process'

export interface DaemonPathOptions {
  authPoolDir?: string
  dataDir?: string
  databasePath?: string
}

export interface DaemonPaths {
  authPoolDir: string
  dataDir: string
  databasePath: string
  rawCaptureDir: string
}

export function resolveDaemonPaths(options: DaemonPathOptions): DaemonPaths {
  const dataDir =
    options.dataDir ?? (options.databasePath ? dirname(options.databasePath) : defaultDataDir())
  return {
    authPoolDir: options.authPoolDir ?? join(dataDir, 'auth-pool'),
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
