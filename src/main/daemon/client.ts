import type {
  AccountPoolSnapshot,
  AccountUsageInput,
  LogEventRow,
  ManagedAccountRow,
  ProtocolMessageRow,
  TurnSummaryRow
} from '../proxy/ledger-types'
import type {
  ProxyAccountSwitchResult,
  ProxyConfig,
  ProxyStatus,
  RecentRequest,
  RequestSummary,
  UsageSummary
} from '../proxy/types'

export interface DaemonClientOptions {
  endpoint: string
  token: string
}

export interface DaemonStatusResponse {
  admin: {
    endpoint: string
    host: string
    port: number
    running: boolean
  }
  proxy: ProxyStatus
}

export class DaemonAdminClient {
  constructor(private readonly options: DaemonClientOptions) {}

  status(): Promise<DaemonStatusResponse> {
    return this.getJson('/status')
  }

  config(): Promise<{ config: ProxyConfig }> {
    return this.getJson('/config')
  }

  updateConfig(config: ProxyConfig): Promise<{ config: ProxyConfig }> {
    return this.requestJson('/config', {
      body: JSON.stringify(config),
      method: 'PUT'
    })
  }

  reload(): Promise<{ config: ProxyConfig; proxy: ProxyStatus }> {
    return this.requestJson('/reload', { method: 'POST' })
  }

  accounts(): Promise<{ accounts: ManagedAccountRow[] }> {
    return this.getJson('/accounts')
  }

  requestSummary(): Promise<{ summary: RequestSummary }> {
    return this.getJson('/request-summary')
  }

  usageSummary(): Promise<{ summary: UsageSummary }> {
    return this.getJson('/usage-summary')
  }

  syncAccounts(
    accounts: AccountPoolSnapshot[]
  ): Promise<{ accounts: ManagedAccountRow[]; status: ProxyStatus }> {
    return this.requestJson('/accounts/sync', {
      body: JSON.stringify({ accounts }),
      method: 'POST'
    })
  }

  updateAccountUsage(
    results: Array<AccountUsageInput & { error?: string }>
  ): Promise<{ accounts: ManagedAccountRow[]; status: ProxyStatus }> {
    return this.requestJson('/accounts/usage', {
      body: JSON.stringify({ results }),
      method: 'POST'
    })
  }

  resetExhaustedAccounts(): Promise<{
    accounts: ManagedAccountRow[]
    resetAccounts: number
    status: ProxyStatus
  }> {
    return this.requestJson('/accounts/reset-exhausted', { method: 'POST' })
  }

  switchAccount(accountId?: string): Promise<{
    accounts: ManagedAccountRow[]
    result: ProxyAccountSwitchResult
  }> {
    return this.requestJson('/accounts/switch', {
      body: JSON.stringify({ accountId }),
      method: 'POST'
    })
  }

  setAccountDisabled(
    accountId: string,
    disabled: boolean
  ): Promise<{ accounts: ManagedAccountRow[]; status: ProxyStatus; updatedAccounts: number }> {
    return this.requestJson('/accounts/disable', {
      body: JSON.stringify({ accountId, disabled }),
      method: 'POST'
    })
  }

  deleteAccounts(
    accountIds: string[]
  ): Promise<{ accounts: ManagedAccountRow[]; deletedAccounts: number; status: ProxyStatus }> {
    return this.requestJson('/accounts/delete', {
      body: JSON.stringify({ accountIds }),
      method: 'POST'
    })
  }

  requests(limit = 20): Promise<{ hasMore: boolean; requests: RecentRequest[] }> {
    return this.getJson(`/requests?limit=${limit}`)
  }

  logEvents(limit = 50): Promise<{ events: LogEventRow[]; hasMore: boolean }> {
    return this.getJson(`/log-events?limit=${limit}`)
  }

  protocolMessages(limit = 50): Promise<{ hasMore: boolean; messages: ProtocolMessageRow[] }> {
    return this.getJson(`/protocol-messages?limit=${limit}`)
  }

  turnSummaries(limit = 50): Promise<{ hasMore: boolean; summaries: TurnSummaryRow[] }> {
    return this.getJson(`/turn-summaries?limit=${limit}`)
  }

  clearRecords(): Promise<{ deletedCaptureEntries: number; deletedRequests: number }> {
    return this.requestJson('/clear-records', { method: 'POST' })
  }

  private getJson<T>(path: string): Promise<T> {
    return this.requestJson(path, { method: 'GET' })
  }

  private async requestJson<T>(
    path: string,
    init: { body?: string; method: 'GET' | 'POST' | 'PUT' }
  ): Promise<T> {
    const base = this.options.endpoint.endsWith('/')
      ? this.options.endpoint
      : `${this.options.endpoint}/`
    const response = await fetch(new URL(path.replace(/^\//, ''), base), {
      body: init.body,
      headers: {
        authorization: `Bearer ${this.options.token}`,
        ...(init.body ? { 'content-type': 'application/json' } : {})
      },
      method: init.method
    })
    const body = (await response.json().catch(() => undefined)) as unknown
    if (!response.ok) {
      throw new Error(
        [
          `Daemon admin request failed: ${init.method} ${path} ${response.status}`,
          summarizeErrorBody(body)
        ]
          .filter((item) => item !== undefined)
          .join(' ')
      )
    }
    return body as T
  }
}

function summarizeErrorBody(body: unknown): string | undefined {
  if (body === undefined) {
    return undefined
  }

  try {
    return JSON.stringify(body).slice(0, 500)
  } catch {
    return String(body).slice(0, 500)
  }
}
