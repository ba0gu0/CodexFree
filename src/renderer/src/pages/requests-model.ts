import type { RecentRequest } from '@renderer/data/proxy-console'

export type RequestFilter = 'all' | 'forwarded' | 'quota_exhausted' | 'failed' | 'rejected'

export interface RequestSummary {
  captured: number
  failed: number
  forwarded: number
  quota: number
  rejected: number
  total: number
}

export const requestFilters: RequestFilter[] = [
  'all',
  'forwarded',
  'quota_exhausted',
  'failed',
  'rejected'
]

export function filterRequests(
  requests: RecentRequest[],
  filter: RequestFilter,
  query: string
): RecentRequest[] {
  const normalized = query.trim().toLowerCase()
  return requests.filter((request) => {
    const matchesFilter = filter === 'all' || request.outcome === filter
    if (!matchesFilter) {
      return false
    }
    if (!normalized) {
      return true
    }
    return [
      request.path,
      request.accountId,
      request.conversationKey,
      request.outcome,
      request.mode,
      request.upstreamHost
    ]
      .filter((value): value is string => typeof value === 'string')
      .some((value) => value.toLowerCase().includes(normalized))
  })
}

export function summarizeRequests(requests: RecentRequest[]): RequestSummary {
  return requests.reduce<RequestSummary>(
    (summary, request) => ({
      captured: summary.captured + (request.rawCapturePath ? 1 : 0),
      failed: summary.failed + (request.outcome === 'failed' ? 1 : 0),
      forwarded: summary.forwarded + (request.outcome === 'forwarded' ? 1 : 0),
      quota: summary.quota + (request.outcome === 'quota_exhausted' ? 1 : 0),
      rejected: summary.rejected + (request.outcome === 'rejected' ? 1 : 0),
      total: summary.total + 1
    }),
    { captured: 0, failed: 0, forwarded: 0, quota: 0, rejected: 0, total: 0 }
  )
}
