import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  AccountUsageCheckBatchDto,
  AuthExportResultDto,
  AuthImportResultDto,
  CleanExpiredAccountsDto,
  ClearProxyRecordsResultDto,
  ManagedAccountDto,
  ProtocolMessageDto,
  ProxyConfigDto,
  ProxyLogEventDto,
  ProxyStatusDto,
  RawCaptureDetailDto,
  RecentRequestDto,
  ResetExhaustedAccountsDto,
  SetAccountDisabledDto
} from './proxy-api'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      getVersion: () => Promise<string>
      getProxyConfig: () => Promise<ProxyConfigDto>
      getProxyStatus: () => Promise<ProxyStatusDto>
      getManagedAuthDirectory: () => Promise<string>
      getRecentRequests: () => Promise<RecentRequestDto[]>
      getManagedAccounts: () => Promise<ManagedAccountDto[]>
      getProxyLogEvents: () => Promise<ProxyLogEventDto[]>
      getProtocolMessages: () => Promise<ProtocolMessageDto[]>
      getRawCapture: (requestId: string) => Promise<RawCaptureDetailDto | undefined>
      clearProxyRecords: () => Promise<ClearProxyRecordsResultDto>
      saveProxyConfig: (
        config: ProxyConfigDto
      ) => Promise<{ config: ProxyConfigDto; status: ProxyStatusDto }>
      importAuthFiles: () => Promise<AuthImportResultDto>
      checkAccountUsage: () => Promise<AccountUsageCheckBatchDto>
      exportAuthFiles: () => Promise<AuthExportResultDto>
      resetExhaustedAccounts: () => Promise<ResetExhaustedAccountsDto>
      setAccountDisabled: (accountId: string, disabled: boolean) => Promise<SetAccountDisabledDto>
      cleanExpiredAccounts: () => Promise<CleanExpiredAccountsDto>
      startProxy: () => Promise<ProxyStatusDto>
      stopProxy: () => Promise<ProxyStatusDto>
      restartProxy: () => Promise<ProxyStatusDto>
    }
  }
}
