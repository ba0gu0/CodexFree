export type OutboundProxyMode = 'direct' | 'http' | 'https' | 'socks4' | 'socks5'

export interface ProxyConfigDto {
  listenHost: string
  listenPort: number
  upstreamBaseUrl: string
  outboundProxy: {
    mode: OutboundProxyMode
    url: string
  }
  rawCaptureEnabled: boolean
  rawCaptureMaxBytes: number
}

export interface ProxyStatusDto {
  running: boolean
  endpoint: string
  upstreamBaseUrl: string
  outboundMode: OutboundProxyMode
  rawCaptureEnabled: boolean
  rawCaptureDir: string
  lastError?: string
}

export interface RecentRequestDto {
  id: string
  method: string
  path: string
  outcome: string
  statusCode: number | null
  durationMs: number
  streaming: number
  upstreamHost: string
  outboundMode: string
  rawCapturePath: string | null
  startedAt: number
}

export interface RawCaptureFileDto {
  name: string
  size: number
  content: string
}

export interface RawCaptureDetailDto {
  requestId: string
  directory: string
  files: RawCaptureFileDto[]
}
