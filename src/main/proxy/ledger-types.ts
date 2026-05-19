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
export type LogEventType = 'request' | 'account_switch' | 'network' | 'quota' | 'auth' | 'system'

export interface RoutingEventInput {
  requestId: string
  conversationKey?: string
  accountId?: string
  eventType: RoutingEventType
  reason: string
}

export interface AccountUsageInput {
  accountId: string
  email?: string
  label?: string
  planType?: string
  primaryUsedPercent?: string
  secondaryUsedPercent?: string
  rateLimitResetsAt?: number
  lastUsageError?: string
}

export interface ManagedAccountRow {
  accountId: string
  label: string
  email: string | null
  fingerprint: string
  sourceFormat: AccountPoolSnapshot['sourceFormat'] | null
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
  cachedInputTokens?: number
  callId?: string
  requestId: string
  path: string
  accountId?: string
  conversationKey?: string
  direction: string
  itemId?: string
  inputItemCount?: number
  inputTokens?: number
  kind: string
  model?: string
  outputTokens?: number
  parentResponseId?: string
  payloadBytes?: number
  previousResponseId?: string
  protocolType?: string
  reasoningTokens?: number
  responseId?: string
  sequenceNumber?: number
  summaryJson?: string
  text: string
  toolCount?: number
  totalTokens?: number
  truncated?: boolean
}

export interface ProtocolMessageRow {
  accountId: string | null
  cachedInputTokens: number | null
  callId: string | null
  conversationKey: string | null
  createdAt: number
  direction: string
  id: string
  itemId: string | null
  inputItemCount: number | null
  inputTokens: number | null
  kind: string
  model: string | null
  outputTokens: number | null
  parentResponseId: string | null
  path: string
  payloadBytes: number | null
  previousResponseId: string | null
  protocolType: string | null
  reasoningTokens: number | null
  requestId: string
  responseId: string | null
  sequenceNumber: number | null
  summaryJson: string | null
  text: string
  toolCount: number | null
  totalTokens: number | null
  truncated: number | null
}

export interface TurnSummaryInput {
  accountId?: string
  assistantText?: string
  cachedInputTokens?: number
  callId?: string
  completedAt?: number
  conversationKey?: string
  codexThreadId?: string
  codexTurnId?: string
  inputTokens?: number
  itemId?: string
  outputTokens?: number
  parentResponseId?: string
  reasoningTokens?: number
  requestId: string
  responseId?: string
  startedAt?: number
  status?: string
  summaryJson?: string
  toolCallDelta?: number
  toolResultDelta?: number
  totalTokens?: number
  turnKey?: string
  userText?: string
}

export interface TurnSummaryRow {
  accountId: string | null
  assistantText: string | null
  cachedInputTokens: number | null
  completedAt: number | null
  conversationKey: string | null
  codexThreadId: string | null
  codexTurnId: string | null
  id: string
  inputTokens: number | null
  outputTokens: number | null
  parentResponseId: string | null
  reasoningTokens: number | null
  requestId: string
  responseId: string | null
  startedAt: number | null
  status: string | null
  summaryJson: string | null
  toolCallCount: number
  toolResultCount: number
  totalTokens: number | null
  turnKey: string
  updatedAt: number
  userText: string | null
}

export interface LogEventInput {
  level: LogEventLevel
  eventType?: LogEventType
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
  eventType: LogEventType | null
  id: string
  level: LogEventLevel
  message: string
  method: string | null
  path: string | null
  requestId: string | null
}

export interface AccountPoolSyncInput extends AccountPoolSnapshot {}
