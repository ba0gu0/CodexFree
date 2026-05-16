import type { AccountPoolSnapshot } from './account-pool'

export type { AccountPoolSnapshot } from './account-pool'

export type AccountStatus = 'available' | 'exhausted' | 'disabled'
export type RoutingEventType =
  | 'selected'
  | 'auth_retry_selected'
  | 'auth_failed'
  | 'quota_retry_selected'
  | 'quota_exhausted'
  | 'all_accounts_exhausted'
export type LogEventLevel = 'info' | 'warn' | 'error'

export interface RoutingEventInput {
  requestId: string
  conversationKey?: string
  accountId?: string
  eventType: RoutingEventType
  reason: string
}

export interface AccountUsageInput {
  accountId: string
  planType?: string
  primaryUsedPercent?: string
  secondaryUsedPercent?: string
  rateLimitResetsAt?: number
  lastUsageError?: string
}

export interface ManagedAccountRow {
  accountId: string
  label: string
  fingerprint: string
  status: AccountStatus
  exhaustedAt: number | null
  quotaResetAt: number | null
  planType: string | null
  primaryUsedPercent: string | null
  secondaryUsedPercent: string | null
  rateLimitResetsAt: number | null
  lastUsageCheckedAt: number | null
  lastUsageError: string | null
  active: number
  updatedAt: number
}

export interface AccountUsageSummary {
  planType: string | null
  primaryUsedPercent: string | null
  rateLimitResetsAt: number | null
}

export interface ProtocolMessageInput {
  requestId: string
  path: string
  accountId?: string
  conversationKey?: string
  direction: string
  kind: string
  text: string
}

export interface ProtocolMessageRow {
  accountId: string | null
  conversationKey: string | null
  createdAt: number
  direction: string
  id: string
  kind: string
  path: string
  requestId: string
  text: string
}

export interface LogEventInput {
  level: LogEventLevel
  message: string
  detail?: unknown
  requestId?: string
  accountId?: string
  conversationKey?: string
  path?: string
  method?: string
}

export interface LogEventRow {
  accountId: string | null
  conversationKey: string | null
  createdAt: number
  detailJson: string | null
  id: string
  level: LogEventLevel
  message: string
  method: string | null
  path: string | null
  requestId: string | null
}

export interface AccountPoolSyncInput extends AccountPoolSnapshot {}
