import type {
  AccountUsageCheckBatchDto,
  AccountUsageCheckProgressDto,
  ActivityPageDto,
  AppUpdateStatusDto,
  AuthExportResultDto,
  AuthImportResultDto,
  CleanExpiredAccountsDto,
  ClearProxyRecordsResultDto,
  CodexAuthRestoreResultDto,
  CodexAuthWriteResultDto,
  CodexConfigBackupRestoreResultDto,
  CodexConfigWriteResultDto,
  CodexSessionProviderRepairResultDto,
  DaemonControlSaveInputDto,
  DaemonControlSaveResultDto,
  DaemonControlSettingsDto,
  ManagedAccountDto,
  PlaceholderAuthResultDto,
  ProtocolMessageDto,
  ProxyConfigDto,
  ProxyLogEventDto,
  ProxyPageSaveResultDto,
  ProxyStatusDto,
  RawCaptureDetailDto,
  RecentRequestDto,
  RequestSummaryDto,
  ResetExhaustedAccountsDto,
  SetAccountDisabledDto,
  SetupAssistantStateDto,
  SwitchAccountDto,
  TurnSummaryDto,
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
      getUpdateStatus: () => Promise<AppUpdateStatusDto>
      checkForUpdate: () => Promise<AppUpdateStatusDto>
      downloadUpdate: () => Promise<AppUpdateStatusDto>
      applyUpdate: () => Promise<AppUpdateStatusDto>
      openReleasePage: () => Promise<void>
      onUpdateStatusChanged: (listener: (status: AppUpdateStatusDto) => void) => () => void
      setLocale: (locale: string) => Promise<void>
      getProxyConfig: () => Promise<ProxyConfigDto>
      getProxyStatus: () => Promise<ProxyStatusDto>
      getDaemonControlSettings: () => Promise<DaemonControlSettingsDto>
      getManagedAuthDirectory: () => Promise<string>
      openManagedAuthDirectory: () => Promise<void>
      openCodexDirectory: () => Promise<void>
      openRawCaptureDirectory: () => Promise<void>
      openWorkDirectory: () => Promise<void>
      getRecentRequests: (limit?: number) => Promise<ActivityPageDto<RecentRequestDto>>
      getManagedAccounts: () => Promise<ManagedAccountDto[]>
      getRequestSummary: () => Promise<RequestSummaryDto>
      getUsageSummary: () => Promise<UsageSummaryDto>
      getProxyLogEvents: (limit?: number) => Promise<ActivityPageDto<ProxyLogEventDto>>
      getProtocolMessages: (limit?: number) => Promise<ActivityPageDto<ProtocolMessageDto>>
      getTurnSummaries: (limit?: number) => Promise<ActivityPageDto<TurnSummaryDto>>
      getRawCapture: (requestId: string) => Promise<RawCaptureDetailDto | undefined>
      clearProxyRecords: () => Promise<ClearProxyRecordsResultDto>
      saveProxyConfig: (
        config: ProxyConfigDto
      ) => Promise<{ config: ProxyConfigDto; status: ProxyStatusDto }>
      saveDaemonControlSettings: (
        input: DaemonControlSaveInputDto
      ) => Promise<DaemonControlSaveResultDto>
      saveProxyPageConfig: (
        config: ProxyConfigDto,
        input: DaemonControlSaveInputDto
      ) => Promise<ProxyPageSaveResultDto>
      importAuthFiles: () => Promise<AuthImportResultDto>
      checkAccountUsage: () => Promise<AccountUsageCheckBatchDto>
      checkSelectedAccountUsage: (accountIds: string[]) => Promise<AccountUsageCheckBatchDto>
      onAccountUsageProgress: (
        listener: (progress: AccountUsageCheckProgressDto) => void
      ) => () => void
      exportAuthFiles: () => Promise<AuthExportResultDto>
      writePlaceholderAuth: () => Promise<PlaceholderAuthResultDto>
      writeCodexConfig: () => Promise<CodexConfigWriteResultDto>
      listCodexConfigBackups: () => Promise<string[]>
      restoreCodexConfigBackup: (
        backupFileName: string
      ) => Promise<CodexConfigBackupRestoreResultDto>
      repairCodexSessionProvider: () => Promise<CodexSessionProviderRepairResultDto>
      getSetupAssistantState: () => Promise<SetupAssistantStateDto>
      renameCodexAuthForRelogin: () => Promise<SetupAssistantStateDto['auth']>
      listCodexAuthBackups: () => Promise<string[]>
      restoreCodexAuthBackup: (backupFileName: string) => Promise<CodexAuthRestoreResultDto>
      writeImportedAccountToCodexAuth: (accountId: string) => Promise<CodexAuthWriteResultDto>
      resetExhaustedAccounts: () => Promise<ResetExhaustedAccountsDto>
      setAccountDisabled: (accountId: string, disabled: boolean) => Promise<SetAccountDisabledDto>
      setAccountsDisabled: (
        accountIds: string[],
        disabled: boolean
      ) => Promise<SetAccountDisabledDto>
      setCurrentAccount: (accountId: string) => Promise<SwitchAccountDto>
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
