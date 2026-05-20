import type {
  ConsoleActivityHasMore,
  ConsoleSnapshot,
  DaemonControlSaveInput,
  ProxyConfig,
  UsageProgress
} from '@renderer/data/proxy-console'
import type { CopyKey, Locale } from '@renderer/i18n/copy'
import type { RawCaptureDetailDto } from '../../../preload/proxy-api'

export interface PageActions {
  checkUsage: () => Promise<void>
  checkUsageForAccounts: (accountIds: string[]) => Promise<void>
  cleanExpired: () => Promise<void>
  clearRecords: () => Promise<void>
  exportAuthFiles: () => Promise<void>
  importAuthFiles: () => Promise<void>
  loadMoreActivity: () => void
  openCapture: (requestId: string) => Promise<void>
  openCodexDirectory: () => Promise<void>
  openManagedAuthDirectory: () => Promise<void>
  openRawCaptureDirectory: () => Promise<void>
  openWorkDirectory: () => Promise<void>
  refresh: () => Promise<void>
  resetExhausted: () => Promise<void>
  restartProxy: () => Promise<void>
  saveConfig: (config: ProxyConfig) => Promise<void>
  saveDaemonControlSettings: (input: DaemonControlSaveInput) => Promise<void>
  saveProxyPageConfig: (config: ProxyConfig, daemonInput: DaemonControlSaveInput) => Promise<void>
  setAccountDisabled: (accountId: string, disabled: boolean) => Promise<void>
  setAccountsDisabled: (accountIds: string[], disabled: boolean) => Promise<void>
  deleteAccounts: (accountIds: string[]) => Promise<void>
  showRequests: (searchQuery?: string) => void
  showUsage: () => void
  startProxy: () => Promise<void>
  stopProxy: () => Promise<void>
  writeCodexConfig: () => Promise<void>
}

export interface PageProps {
  actions: PageActions
  busyAction: string | null
  capture: RawCaptureDetailDto | null
  hasMoreActivity: ConsoleActivityHasMore
  lastRefresh: number | null
  locale: Locale
  onCaptureClose: () => void
  requestSearchQuery: string | null
  snapshot: ConsoleSnapshot
  t: (key: CopyKey, values?: Record<string, string | number>) => string
  usageProgress: UsageProgress | null
}
