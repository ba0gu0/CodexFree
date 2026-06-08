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

  it('returns full database usage groups independent of request list page size', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'codexfree-ledger-usage-'))
    try {
      const ledger = new ProxyLedger(join(tempDir, 'ledger.sqlite'))
      try {
        ledger.syncAccountPool([
          {
            accountId: 'account-a',
            email: 'alpha@example.test',
            fingerprint: 'fingerprint-a',
            label: 'Account A',
            sourceFormat: 'codex'
          },
          {
            accountId: 'account-b',
            email: 'bravo@example.test',
            fingerprint: 'fingerprint-b',
            label: 'Account B',
            sourceFormat: 'codex'
          }
        ])
        ledger.insert(
          createRequestLedgerEntry(1, {
            accountId: 'account-a',
            cachedInputTokens: 3,
            codexThreadId: 'thread-a',
            codexTurnId: 'turn-1',
            inputTokens: 10,
            outputTokens: 20,
            reasoningTokens: 4,
            responseModel: 'gpt-5.5',
            tokenUsageSource: 'sse',
            totalTokens: 34
          })
        )
        ledger.insert(
          createRequestLedgerEntry(2, {
            accountId: 'account-b',
            cachedInputTokens: 5,
            codexThreadId: 'thread-b',
            codexTurnId: 'turn-2',
            inputTokens: 40,
            outputTokens: 50,
            reasoningTokens: 6,
            responseModel: 'gpt-5.4',
            tokenUsageSource: 'analytics_event',
            totalTokens: 96
          })
        )

        const summary = ledger.usageSummary()

        expect(summary.tokenTotal).toBe(130)
        expect(summary.requestsWithUsage).toBe(2)
        expect(summary.accountGroups).toEqual([
          expect.objectContaining({ key: 'bravo@example.test', total: 96 }),
          expect.objectContaining({ key: 'alpha@example.test', total: 34 })
        ])
        expect(summary.modelGroups).toEqual([
          expect.objectContaining({ key: 'gpt-5.4', total: 96 }),
          expect.objectContaining({ key: 'gpt-5.5', total: 34 })
        ])
        expect(summary.sourceGroups).toEqual([
          expect.objectContaining({ key: 'analytics_event', total: 96 }),
          expect.objectContaining({ key: 'sse', total: 34 })
        ])
        expect(summary.turnGroups).toEqual([
          expect.objectContaining({ key: 'thread-b / turn-2', total: 96 }),
          expect.objectContaining({ key: 'thread-a / turn-1', total: 34 })
        ])
      } finally {
        ledger.close()
      }
    } finally {
      rmSync(tempDir, { force: true, recursive: true })
    }
  })

  it('preserves the last successful usage snapshot when a later check only reports an error', () => {
    const ledger = new ProxyLedger(':memory:')
    try {
      ledger.syncAccountPool([
        {
          accountId: 'account-a',
          fingerprint: 'fingerprint-a',
          label: 'Account A',
          sourceFormat: 'codex'
        }
      ])
      ledger.updateAccountUsage({
        accountId: 'account-a',
        planType: 'free',
        primaryUsedPercent: '42',
        rateLimitResetsAt: 1_779_342_755_000,
        secondaryUsedPercent: '0'
      })
      ledger.updateAccountUsage({
        accountId: 'account-a',
        lastUsageError: 'usage check failed: 401'
      })

      expect(ledger.accounts()).toEqual([
        expect.objectContaining({
          accountId: 'account-a',
          lastUsageError: 'usage check failed: 401',
          planType: 'free',
          primaryUsedPercent: '42',
          rateLimitResetsAt: 1_779_342_755_000,
          secondaryUsedPercent: '0'
        })
      ])
    } finally {
      ledger.close()
    }
  })

  it('marks accounts exhausted when the secondary quota window reaches the guard line', () => {
    const ledger = new ProxyLedger(':memory:')
    try {
      ledger.syncAccountPool([
        {
          accountId: 'account-a',
          fingerprint: 'fingerprint-a',
          label: 'Account A',
          sourceFormat: 'codex'
        }
      ])

      ledger.updateAccountUsage({
        accountId: 'account-a',
        planType: 'team',
        primaryUsedPercent: '10',
        rateLimitResetsAt: 1_780_927_748_000,
        secondaryRateLimitResetsAt: 1_781_496_691_000,
        secondaryUsedPercent: '99'
      })

      expect(ledger.accounts()).toEqual([
        expect.objectContaining({
          accountId: 'account-a',
          planType: 'team',
          primaryUsedPercent: '10',
          secondaryUsedPercent: '99',
          status: 'exhausted'
        })
      ])
    } finally {
      ledger.close()
    }
  })

  it('updates account usage fields when marking quota exhausted', () => {
    const ledger = new ProxyLedger(':memory:')
    const completedAt = new Date(1_800_000_000_000)
    const resetsAt = '1800003600'
    try {
      ledger.syncAccountPool([
        {
          accountId: 'account-a',
          fingerprint: 'fingerprint-a',
          label: 'Account A',
          sourceFormat: 'codex'
        }
      ])
      ledger.updateAccountUsage({
        accountId: 'account-a',
        planType: 'free',
        primaryUsedPercent: '12',
        rateLimitResetsAt: 1_779_342_755_000
      })
      ledger.markAccountQuotaExhausted(
        'account-a',
        'request-quota',
        'conversation-1',
        {
          errorType: 'usage_limit_reached',
          planType: 'plus',
          primaryUsedPercent: '100',
          resetsAt,
          statusCode: 429
        },
        'usage_limit_reached status=429 used=100',
        completedAt
      )

      expect(ledger.accounts()).toEqual([
        expect.objectContaining({
          accountId: 'account-a',
          exhaustedAt: completedAt.getTime(),
          lastUsageCheckedAt: completedAt.getTime(),
          planType: 'plus',
          primaryUsedPercent: '100',
          quotaResetAt: 1_800_003_600_000,
          rateLimitResetsAt: 1_800_003_600_000,
          status: 'exhausted'
        })
      ])
    } finally {
      ledger.close()
    }
  })

  it('returns full database request purpose groups for overview summaries', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'codexfree-ledger-summary-'))
    try {
      const ledger = new ProxyLedger(join(tempDir, 'ledger.sqlite'))
      try {
        ledger.insert(
          createRequestLedgerEntry(1, {
            requestPurpose: 'analytics_events'
          })
        )
        ledger.insert(
          createRequestLedgerEntry(2, {
            requestPurpose: 'codex_response_sse'
          })
        )
        ledger.insert(
          createRequestLedgerEntry(3, {
            requestPurpose: 'analytics_events'
          })
        )

        const summary = ledger.requestSummary()

        expect(summary.total).toBe(3)
        expect(summary.purposeGroups).toEqual([
          { count: 2, key: 'analytics_events' },
          { count: 1, key: 'codex_response_sse' }
        ])
      } finally {
        ledger.close()
      }
    } finally {
      rmSync(tempDir, { force: true, recursive: true })
    }
  })

  it('upserts turn summaries by stable conversation and response keys', () => {
    const ledger = new ProxyLedger(':memory:')
    try {
      ledger.recordTurnSummary({
        conversationKey: 'conversation-1',
        parentResponseId: 'resp-parent',
        requestId: 'request-1',
        turnKey: 'turn-1',
        userText: 'hello'
      })
      ledger.recordTurnSummary({
        assistantText: 'world',
        conversationKey: 'conversation-1',
        outputTokens: 5,
        requestId: 'request-1',
        responseId: 'resp-1',
        status: 'completed',
        toolCallDelta: 1,
        toolResultDelta: 1,
        totalTokens: 9,
        turnKey: 'turn-1'
      })

      expect(ledger.recentTurnSummaries()).toEqual([
        expect.objectContaining({
          assistantText: 'world',
          responseId: 'resp-1',
          status: 'completed',
          toolCallCount: 1,
          toolResultCount: 1,
          totalTokens: 9,
          turnKey: 'turn-1',
          userText: 'hello'
        })
      ])
    } finally {
      ledger.close()
    }
  })

  it('deduplicates structured routing and quota rows from generic log events', () => {
    const ledger = new ProxyLedger(':memory:')
    const createdAt = new Date(1_800_000_000_000)
    try {
      ledger.recordLogEvent(
        {
          accountId: 'account-1',
          eventType: 'account_switch',
          level: 'info',
          message: 'Active account selected',
          requestId: 'request-switch'
        },
        createdAt
      )
      ledger.recordRoutingEvent(
        {
          accountId: 'account-1',
          eventType: 'selected',
          reason: 'auth_pool',
          requestId: 'request-switch'
        },
        createdAt
      )
      ledger.recordLogEvent(
        {
          accountId: 'account-2',
          eventType: 'quota',
          level: 'warn',
          message: 'Usage limit reached; marking account exhausted',
          requestId: 'request-quota'
        },
        createdAt
      )
      ledger.markAccountQuotaExhausted(
        'account-2',
        'request-quota',
        'conversation-1',
        {
          errorType: 'usage_limit_reached',
          primaryUsedPercent: '100',
          statusCode: 429
        },
        'status=429 used=100',
        createdAt
      )

      const rows = ledger.recentLogEvents()

      expect(rows.filter((row) => row.requestId === 'request-switch')).toHaveLength(1)
      expect(rows.filter((row) => row.requestId === 'request-quota')).toEqual([
        expect.objectContaining({
          eventType: 'quota',
          message: 'Quota event'
        })
      ])
    } finally {
      ledger.close()
    }
  })
})

function createRequestLedgerEntry(
  index: number,
  override: Partial<RequestLedgerEntry> = {}
): RequestLedgerEntry {
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
    upstreamHost: 'chatgpt.com',
    ...override
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
