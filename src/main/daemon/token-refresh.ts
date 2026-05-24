import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { type CodexChatGptAuth, normalizeAuthFile } from '../auth/normalize'
import { refreshChatGptAuth, shouldRefreshChatGptAuth, type TokenRefresher } from '../auth/refresh'
import type { ProxyLedger } from '../proxy/ledger'
import type { ProxyStatus } from '../proxy/types'

export interface TokenRefreshMaintainerOptions {
  authPoolDir: string
  intervalMs?: number
  ledger: ProxyLedger
  refreshAccountPool: () => ProxyStatus
  refresher?: TokenRefresher
}

export interface TokenRefreshStats {
  checked: number
  refreshed: number
  skipped: number
}

const defaultIntervalMs = 60 * 60 * 1000

export class TokenRefreshMaintainer {
  private running = false
  private timer?: ReturnType<typeof setInterval>

  constructor(private readonly options: TokenRefreshMaintainerOptions) {}

  start(): void {
    this.stop()
    void this.runBackgroundRefresh()
    this.timer = setInterval(() => void this.runBackgroundRefresh(), this.intervalMs())
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }

  async refreshDueTokens(now = new Date()): Promise<TokenRefreshStats> {
    if (this.running) {
      return { checked: 0, refreshed: 0, skipped: 0 }
    }
    this.running = true
    try {
      const files = authJsonFiles(this.options.authPoolDir)
      let checked = 0
      let refreshed = 0
      let skipped = 0
      for (const filePath of files) {
        const result = await this.refreshFileIfDue(filePath, now)
        checked += result.checked
        refreshed += result.refreshed
        skipped += result.skipped
      }
      if (refreshed > 0) {
        this.options.refreshAccountPool()
      }
      return { checked, refreshed, skipped }
    } finally {
      this.running = false
    }
  }

  private intervalMs(): number {
    return this.options.intervalMs ?? defaultIntervalMs
  }

  private async runBackgroundRefresh(): Promise<void> {
    try {
      await this.refreshDueTokens()
    } catch (error) {
      this.options.ledger.recordLogEvent({
        eventType: 'auth',
        level: 'error',
        message: 'Token refresh maintenance task failed',
        detail: { error: error instanceof Error ? error.message : String(error) }
      })
    }
  }

  private async refreshFileIfDue(filePath: string, now: Date): Promise<TokenRefreshStats> {
    let normalized: ReturnType<typeof normalizeAuthFile>
    try {
      normalized = normalizeAuthFile(JSON.parse(readFileSync(filePath, 'utf8')) as unknown, {
        fileName: basename(filePath),
        now
      })
    } catch (error) {
      this.recordSkipped(undefined, filePath, error)
      return { checked: 0, refreshed: 0, skipped: 1 }
    }
    if (!normalized.refreshable || !shouldRefreshChatGptAuth(normalized.codexAuth, now)) {
      return { checked: 0, refreshed: 0, skipped: 0 }
    }
    try {
      const refreshed = await (this.options.refresher ?? refreshChatGptAuth)(
        normalized.codexAuth,
        now
      )
      writeFileSync(filePath, `${JSON.stringify(toStoredAuth(normalized, refreshed), null, 2)}\n`, {
        mode: 0o600
      })
      this.recordRefreshed(normalized.accountId)
      return { checked: 1, refreshed: 1, skipped: 0 }
    } catch (error) {
      this.recordSkipped(normalized.accountId, filePath, error)
      return { checked: 1, refreshed: 0, skipped: 1 }
    }
  }

  private recordRefreshed(accountId: string): void {
    this.options.ledger.recordLogEvent({
      accountId,
      eventType: 'auth',
      level: 'info',
      message: 'Account access token refreshed'
    })
  }

  private recordSkipped(accountId: string | undefined, filePath: string, error: unknown): void {
    this.options.ledger.recordLogEvent({
      accountId,
      eventType: 'auth',
      level: 'warn',
      message: 'Token refresh skipped account',
      detail: {
        error: error instanceof Error ? error.message : String(error),
        fileName: basename(filePath)
      }
    })
  }
}

function authJsonFiles(directory: string): string[] {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  return readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => join(directory, name))
    .filter((filePath) => statSync(filePath).isFile())
}

function toStoredAuth(
  normalized: ReturnType<typeof normalizeAuthFile>,
  codexAuth: CodexChatGptAuth
): unknown {
  return {
    ...codexAuth,
    disabled: normalized.disabled,
    email: normalized.email,
    refreshable: true
  }
}
