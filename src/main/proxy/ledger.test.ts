import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { ProxyLedger } from './ledger'
import type { RequestLedgerEntry } from './types'

describe('proxy ledger account sync', () => {
  it('removes account rows missing from the latest auth pool snapshot', () => {
    const ledger = new ProxyLedger(':memory:')
    try {
      ledger.syncAccountPool([
        {
          accountId: 'account-a',
          fingerprint: 'fingerprint-a',
          label: 'Account A',
          sourceFormat: 'codex'
        },
        {
          accountId: 'account-b',
          fingerprint: 'fingerprint-b',
          label: 'Account B',
          sourceFormat: 'cpa'
        }
      ])
      ledger.syncAccountPool([
        {
          accountId: 'account-b',
          fingerprint: 'fingerprint-b2',
          label: 'Account B2',
          sourceFormat: 'sub2api'
        }
      ])

      expect(ledger.accounts()).toEqual([
        expect.objectContaining({
          accountId: 'account-b',
          fingerprint: 'fingerprint-b2',
          label: 'Account B2',
          sourceFormat: 'sub2api'
        })
      ])
    } finally {
      ledger.close()
    }
  })

  it('compacts storage after clearing request history', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'codexfree-ledger-'))

    try {
      const databasePath = join(tempDir, 'ledger.sqlite')
      const ledger = new ProxyLedger(databasePath)

      try {
        for (let index = 0; index < 80; index += 1) {
          ledger.insert(createRequestLedgerEntry(index))
        }

        expect(ledger.clear()).toBe(80)
      } finally {
        ledger.close()
      }

      const sqlite = new Database(databasePath, { readonly: true })
      try {
        expect(readScalarNumber(sqlite, 'SELECT count(*) FROM proxy_requests')).toBe(0)
        expect(readPragmaNumber(sqlite, 'freelist_count')).toBe(0)
      } finally {
        sqlite.close()
      }
    } finally {
      rmSync(tempDir, { force: true, recursive: true })
    }
  })
})

function createRequestLedgerEntry(index: number): RequestLedgerEntry {
  const now = new Date(1_800_000_000_000 + index)
  const largeHeader = JSON.stringify({ sample: 'x'.repeat(10_000) })

  return {
    authHeaderPresent: false,
    completedAt: now,
    cookieHeaderPresent: false,
    durationMs: 12,
    id: `request-${index}`,
    method: 'POST',
    mode: 'account',
    outcome: 'forwarded',
    outboundMode: 'direct',
    path: '/backend-api/codex/responses',
    requestBytes: 128,
    requestHeadersJson: largeHeader,
    responseBytes: 256,
    responseHeadersJson: largeHeader,
    startedAt: now,
    statusCode: 200,
    streaming: false,
    upstreamHost: 'chatgpt.com'
  }
}

function readScalarNumber(sqlite: Database.Database, query: string): number {
  const value = sqlite.prepare(query).pluck().get()
  return assertNumber(value, query)
}

function readPragmaNumber(sqlite: Database.Database, name: string): number {
  const value = sqlite.pragma(name, { simple: true })
  return assertNumber(value, `PRAGMA ${name}`)
}

function assertNumber(value: unknown, source: string): number {
  if (typeof value !== 'number') {
    throw new Error(`${source} returned a non-numeric value`)
  }
  return value
}
