import type {
  AccountUsageCheckBatchDto,
  AccountUsageCheckProgressDto,
  ActivityPageDto,
  AuthExportResultDto,
  AuthImportResultDto,
  CleanExpiredAccountsDto,
  ClearProxyRecordsResultDto,
  CodexConfigWriteResultDto,
  DaemonControlSaveInputDto,
  DaemonControlSaveResultDto,
  DaemonControlSettingsDto,
  ManagedAccountDto,
  PlaceholderAuthResultDto,
  ProtocolMessageDto,
  ProxyConfigDto,
  ProxyLogEventDto,
  ProxyStatusDto,
  RawCaptureDetailDto,
  RecentRequestDto,
  RequestSummaryDto,
  ResetExhaustedAccountsDto,
  SetAccountDisabledDto,
  UsageSummaryDto
} from './proxy-api'

declare global {
  interface Window {
    electron: {
      ipcRenderer: {
        invoke: <T>(channel: string, ...args: unknown[]) => Promise<T>
      }
    }
    api: {
      getVersion: () => Promise<string>
      setLocale: (locale: string) => Promise<void>
      getProxyConfig: () => Promise<ProxyConfigDto>
      getProxyStatus: () => Promise<ProxyStatusDto>
      getDaemonControlSettings: () => Promise<DaemonControlSettingsDto>
      getManagedAuthDirectory: () => Promise<string>
      openManagedAuthDirectory: () => Promise<void>
      openRawCaptureDirectory: () => Promise<void>
      openWorkDirectory: () => Promise<void>
      getRecentRequests: (limit?: number) => Promise<ActivityPageDto<RecentRequestDto>>
      getManagedAccounts: () => Promise<ManagedAccountDto[]>
      getRequestSummary: () => Promise<RequestSummaryDto>
      getUsageSummary: () => Promise<UsageSummaryDto>
      getProxyLogEvents: (limit?: number) => Promise<ActivityPageDto<ProxyLogEventDto>>
      getProtocolMessages: (limit?: number) => Promise<ActivityPageDto<ProtocolMessageDto>>
      getRawCapture: (requestId: string) => Promise<RawCaptureDetailDto | undefined>
      clearProxyRecords: () => Promise<ClearProxyRecordsResultDto>
      saveProxyConfig: (
        config: ProxyConfigDto
      ) => Promise<{ config: ProxyConfigDto; status: ProxyStatusDto }>
      saveDaemonControlSettings: (
        input: DaemonControlSaveInputDto
      ) => Promise<DaemonControlSaveResultDto>
      importAuthFiles: () => Promise<AuthImportResultDto>
      checkAccountUsage: () => Promise<AccountUsageCheckBatchDto>
      checkSelectedAccountUsage: (accountIds: string[]) => Promise<AccountUsageCheckBatchDto>
      onAccountUsageProgress: (
        listener: (progress: AccountUsageCheckProgressDto) => void
      ) => () => void
      exportAuthFiles: () => Promise<AuthExportResultDto>
      writePlaceholderAuth: () => Promise<PlaceholderAuthResultDto>
      writeCodexConfig: () => Promise<CodexConfigWriteResultDto>
      resetExhaustedAccounts: () => Promise<ResetExhaustedAccountsDto>
      setAccountDisabled: (accountId: string, disabled: boolean) => Promise<SetAccountDisabledDto>
      setAccountsDisabled: (
        accountIds: string[],
        disabled: boolean
      ) => Promise<SetAccountDisabledDto>
      deleteAccounts: (accountIds: string[]) => Promise<{
        accounts: ManagedAccountDto[]
        deletedAccounts: number
        status: ProxyStatusDto
      }>
      cleanExpiredAccounts: () => Promise<CleanExpiredAccountsDto>
      startProxy: () => Promise<ProxyStatusDto>
      stopProxy: () => Promise<ProxyStatusDto>
      restartProxy: () => Promise<ProxyStatusDto>
    }
  }
}
