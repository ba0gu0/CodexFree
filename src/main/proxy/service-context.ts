import type { IncomingMessage, RequestOptions, ServerResponse } from 'node:http'
import type { RoutedAccount } from './account-pool'
import type { ProxyLedger } from './ledger'
import type { QuotaExhaustionEvent } from './quota'
import type { ForwardResult } from './transport-http'
import type { ProxyConfig } from './types'
import type { UsageSnapshot } from './usage-response'
import type { CapturedWebSocketFrame } from './websocket-capture'

export interface ProxyServiceLog {
  info: (message: string, data?: unknown) => void
  warn: (message: string, data?: unknown) => void
  error: (message: string, data?: unknown) => void
}

export type WebSocketResponseCreateGuardResult =
  | { action: 'allow' }
  | { action: 'reconnect' }
  | { action: 'terminal_quota'; event: QuotaExhaustionEvent }

export interface ProxyHandlerContext {
  config: ProxyConfig
  ledger: ProxyLedger
  log: ProxyServiceLog
  rawCaptureDir: string
  accountUsageText(accountId: string | undefined): string | undefined
  availableAccountCount(): number
  buildTargetUrl(requestUrl: string): URL
  createRequestOptions(request: IncomingMessage, targetUrl: URL): RequestOptions
  logWebSocketFrame(
    requestId: string,
    path: string,
    accountId: string | undefined,
    conversationKey: string | undefined,
    frame: CapturedWebSocketFrame
  ): void
  markHttpAuthFailed(
    requestId: string,
    accountId: string | undefined,
    conversationKey: string | undefined,
    result: ForwardResult
  ): void
  markHttpQuotaExhausted(
    requestId: string,
    accountId: string | undefined,
    conversationKey: string | undefined,
    event: QuotaExhaustionEvent
  ): void
  guardRoutedAccountForHttpTurn(
    request: IncomingMessage,
    requestId: string,
    routedAccount: RoutedAccount,
    conversationKey: string | undefined
  ): Promise<RoutedAccount | undefined>
  guardWebSocketResponseCreate(
    requestId: string,
    accountId: string | undefined,
    conversationKey: string | undefined
  ): Promise<WebSocketResponseCreateGuardResult>
  routeAccount(
    request: IncomingMessage,
    requestId: string,
    incomingAccountId: string | undefined,
    conversationKey: string | undefined,
    eventType?: 'selected' | 'quota_retry_selected' | 'auth_retry_selected'
  ): Promise<RoutedAccount | undefined>
  routeAccountNow(
    request: IncomingMessage,
    requestId: string,
    incomingAccountId: string | undefined,
    conversationKey: string | undefined,
    eventType?: 'selected' | 'quota_retry_selected' | 'auth_retry_selected'
  ): RoutedAccount | undefined
  switchAccountAfterAuthFailure(
    request: IncomingMessage,
    requestId: string,
    failedAccountId: string | undefined,
    conversationKey: string | undefined
  ): Promise<RoutedAccount | undefined>
  switchAccountAfterExhaustion(
    request: IncomingMessage,
    requestId: string,
    exhaustedAccountId: string | undefined,
    conversationKey: string | undefined,
    eventType: 'quota_retry_selected'
  ): Promise<RoutedAccount | undefined>
  updateUsageFromHttpResponse(
    requestUrl: string | undefined,
    accountId: string | undefined,
    result: ForwardResult
  ): UsageSnapshot | undefined
  writeDeferredHttpResponse(response: ServerResponse, result: ForwardResult): void
}
