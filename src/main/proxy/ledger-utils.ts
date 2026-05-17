import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'

export function isPercentExhausted(value: string | null): boolean {
  if (!value) {
    return false
  }
  const numeric = Number.parseFloat(value)
  return Number.isFinite(numeric) && numeric >= 100
}

export function randomLedgerId(prefix: string): string {
  return `${prefix}-${randomUUID()}`
}

export function epochSecondsToMillis(value: string | undefined): number | null {
  if (!value) {
    return null
  }

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed * 1000 : null
}

export function serializeLogDetail(detail: unknown): string | null {
  if (detail === undefined) {
    return null
  }

  try {
    return JSON.stringify(detail)
  } catch {
    return JSON.stringify({ text: String(detail) })
  }
}

export function clearLedgerTables(sqlite: Database.Database): number {
  return sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM proxy_routing_events').run()
    sqlite.prepare('DELETE FROM proxy_quota_events').run()
    sqlite.prepare('DELETE FROM proxy_protocol_messages').run()
    sqlite.prepare('DELETE FROM proxy_log_events').run()
    return sqlite.prepare('DELETE FROM proxy_requests').run().changes
  })()
}

export function compactLedgerStorage(sqlite: Database.Database): void {
  try {
    sqlite.pragma('wal_checkpoint(TRUNCATE)')
    sqlite.exec('VACUUM')
    sqlite.pragma('wal_checkpoint(TRUNCATE)')
  } catch (error) {
    throw new Error('Failed to compact SQLite ledger storage after clearing records', {
      cause: error
    })
  }
}

export function pruneLedgerTables(sqlite: Database.Database, olderThan: Date): number {
  const cutoff = olderThan.getTime()
  return sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM proxy_routing_events WHERE created_at < ?').run(cutoff)
    sqlite.prepare('DELETE FROM proxy_quota_events WHERE created_at < ?').run(cutoff)
    sqlite.prepare('DELETE FROM proxy_protocol_messages WHERE created_at < ?').run(cutoff)
    sqlite.prepare('DELETE FROM proxy_log_events WHERE created_at < ?').run(cutoff)
    return sqlite.prepare('DELETE FROM proxy_requests WHERE started_at < ?').run(cutoff).changes
  })()
}
