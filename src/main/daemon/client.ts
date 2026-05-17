import type {
  AccountPoolSnapshot,
  AccountUsageInput,
  LogEventRow,
  ManagedAccountRow,
  ProtocolMessageRow
} from '../proxy/ledger-types'
import type {
  ProxyAccountSwitchResult,
  ProxyConfig,
  ProxyStatus,
  RecentRequest
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

  updateConfig(config: ProxyConfig): Promise<{ config: ProxyConfig; proxy: ProxyStatus }> {
    return this.requestJson('/config', {
      body: JSON.stringify(config),
      method: 'PUT'
    })
  }

  start(): Promise<{ proxy: ProxyStatus }> {
    return this.requestJson('/start', { method: 'POST' })
  }

  restart(): Promise<{ proxy: ProxyStatus }> {
    return this.requestJson('/restart', { method: 'POST' })
  }

  stop(): Promise<{ proxy: ProxyStatus }> {
    return this.requestJson('/stop', { method: 'POST' })
  }

  accounts(): Promise<{ accounts: ManagedAccountRow[] }> {
    return this.getJson('/accounts')
  }

  syncAccounts(accounts: AccountPoolSnapshot[]): Promise<{ accounts: ManagedAccountRow[] }> {
    return this.requestJson('/accounts/sync', {
      body: JSON.stringify({ accounts }),
      method: 'POST'
    })
  }

  updateAccountUsage(
    results: Array<AccountUsageInput & { error?: string }>
  ): Promise<{ accounts: ManagedAccountRow[] }> {
    return this.requestJson('/accounts/usage', {
      body: JSON.stringify({ results }),
      method: 'POST'
    })
  }

  resetExhaustedAccounts(): Promise<{
    accounts: ManagedAccountRow[]
    resetAccounts: number
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
  ): Promise<{ accounts: ManagedAccountRow[]; updatedAccounts: number }> {
    return this.requestJson('/accounts/disable', {
      body: JSON.stringify({ accountId, disabled }),
      method: 'POST'
    })
  }

  deleteAccounts(
    accountIds: string[]
  ): Promise<{ accounts: ManagedAccountRow[]; deletedAccounts: number }> {
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
