import Database from 'better-sqlite3'
import { initializeLedgerSchema } from './ledger-schema'
import type { RequestPurposeSummary, RequestSummary, UsageSummary, UsageTokenGroup } from './types'

interface UsageSummaryRow {
  averageDurationMs: number | null
  failed: number
  requestBytes: number
  requestsWithUsage: number
  responseBytes: number
  successful: number
  tokenTotal: number
  total: number
}

export function readRequestSummary(databasePath: string): RequestSummary {
  const sqlite = new Database(databasePath, { readonly: false })
  try {
    initializeLedgerSchema(sqlite)
    const summary = sqlite
      .prepare(`
        SELECT
          COUNT(*) AS total,
          COALESCE(SUM(CASE WHEN outcome = 'forwarded' THEN 1 ELSE 0 END), 0) AS forwarded,
          COALESCE(SUM(CASE WHEN outcome = 'quota_exhausted' THEN 1 ELSE 0 END), 0) AS quota,
          COALESCE(SUM(CASE WHEN outcome = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected,
          COALESCE(SUM(CASE WHEN outcome = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
          COALESCE(SUM(CASE WHEN raw_capture_path IS NOT NULL THEN 1 ELSE 0 END), 0) AS captured
        FROM proxy_requests
      `)
      .get() as RequestSummary
    return {
      ...summary,
      purposeGroups: readRequestPurposeGroups(sqlite)
    }
  } finally {
    sqlite.close()
  }
}

function readRequestPurposeGroups(sqlite: Database.Database): RequestPurposeSummary[] {
  return sqlite
    .prepare(`
      SELECT
        COALESCE(request_purpose, 'unknown') AS key,
        COUNT(*) AS count
      FROM proxy_requests
      GROUP BY key
      ORDER BY count DESC, key ASC
      LIMIT 12
    `)
    .all() as RequestPurposeSummary[]
}

export function readUsageSummary(databasePath: string): UsageSummary {
  const sqlite = new Database(databasePath, { readonly: false })
  try {
    initializeLedgerSchema(sqlite)
    const summary = sqlite
      .prepare(`
        SELECT
          COUNT(*) AS total,
          COALESCE(SUM(
            CASE
              WHEN outcome NOT IN ('failed', 'rejected', 'quota_exhausted')
                AND (status_code IS NULL OR status_code < 400)
              THEN 1 ELSE 0
            END
          ), 0) AS successful,
          COALESCE(SUM(CASE WHEN outcome IN ('failed', 'rejected') THEN 1 ELSE 0 END), 0) AS failed,
          COALESCE(SUM(CASE WHEN total_tokens IS NOT NULL THEN 1 ELSE 0 END), 0) AS requestsWithUsage,
          COALESCE(SUM(COALESCE(total_tokens, 0)), 0) AS tokenTotal,
          COALESCE(SUM(request_bytes), 0) AS requestBytes,
          COALESCE(SUM(response_bytes), 0) AS responseBytes,
          AVG(CASE WHEN duration_ms > 0 THEN duration_ms ELSE NULL END) AS averageDurationMs
        FROM proxy_requests
      `)
      .get() as UsageSummaryRow
    return {
      ...summary,
      accountGroups: readUsageGroups(
        sqlite,
        `
          COALESCE(
            proxy_accounts.email,
            NULLIF(proxy_accounts.label, ''),
            proxy_requests.account_id,
            '-'
          )
        `
      ),
      dayGroups: readUsageGroups(
        sqlite,
        "strftime('%Y-%m-%d', started_at / 1000, 'unixepoch', 'localtime')"
      ),
      modelGroups: readUsageGroups(sqlite, "COALESCE(response_model, request_model, '-')"),
      sourceGroups: readUsageGroups(sqlite, "COALESCE(token_usage_source, '-')"),
      turnGroups: readUsageGroups(
        sqlite,
        `
          COALESCE(codex_thread_id, conversation_key, '-') || ' / ' ||
          COALESCE(codex_turn_id, '-')
        `
      )
    }
  } finally {
    sqlite.close()
  }
}

function readUsageGroups(sqlite: Database.Database, keySql: string): UsageTokenGroup[] {
  assertSafeUsageGroupExpression(keySql)
  return sqlite
    .prepare(`
      SELECT
        ${keySql} AS key,
        COUNT(*) AS count,
        COALESCE(SUM(COALESCE(input_tokens, 0)), 0) AS input,
        COALESCE(SUM(COALESCE(cached_input_tokens, 0)), 0) AS cached,
        COALESCE(SUM(COALESCE(output_tokens, 0)), 0) AS output,
        COALESCE(SUM(COALESCE(reasoning_tokens, 0)), 0) AS reasoning,
        COALESCE(SUM(COALESCE(total_tokens, 0)), 0) AS total
      FROM proxy_requests
      LEFT JOIN proxy_accounts ON proxy_accounts.account_id = proxy_requests.account_id
      WHERE total_tokens IS NOT NULL
      GROUP BY key
      ORDER BY total DESC, count DESC
      LIMIT 12
    `)
    .all() as UsageTokenGroup[]
}

function assertSafeUsageGroupExpression(expression: string): void {
  if (/;|--|\/\*/.test(expression)) {
    throw new Error(`Unsafe usage group expression: ${expression}`)
  }
}
