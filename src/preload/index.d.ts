import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  ProxyConfigDto,
  ProxyStatusDto,
  RawCaptureDetailDto,
  RecentRequestDto
} from './proxy-api'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      getVersion: () => Promise<string>
      getProxyConfig: () => Promise<ProxyConfigDto>
      getProxyStatus: () => Promise<ProxyStatusDto>
      getRecentRequests: () => Promise<RecentRequestDto[]>
      getRawCapture: (requestId: string) => Promise<RawCaptureDetailDto | undefined>
      saveProxyConfig: (
        config: ProxyConfigDto
      ) => Promise<{ config: ProxyConfigDto; status: ProxyStatusDto }>
      restartProxy: () => Promise<ProxyStatusDto>
    }
  }
}
