import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import { initializeLedgerSchema } from '../proxy/ledger-schema'
import * as schema from './schema'

export function createDatabase(databasePath: string) {
  const sqlite = new Database(databasePath)
  sqlite.pragma('journal_mode = WAL')
  initializeLedgerSchema(sqlite)

  return drizzle(sqlite, { schema })
}
