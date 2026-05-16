import type { AddressInfo } from 'node:net'

export function normalizeDisplayHost(address: AddressInfo): string {
  return address.address === '::' ? '[::]' : address.address
}

export function normalizeCodexPath(pathname: string): string {
  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`
  if (normalized === '/v1') {
    return ''
  }
  if (normalized.startsWith('/v1/')) {
    return normalized.slice(3)
  }
  return normalized
}

export function resolveAccountUpstreamPath(
  upstreamBasePath: string,
  requestPathname: string
): string {
  const requestPath = requestPathname.startsWith('/') ? requestPathname : `/${requestPathname}`
  if (requestPath.startsWith('/backend-api/')) {
    return requestPath
  }

  const basePath = upstreamBasePath === '/' ? '' : upstreamBasePath.replace(/\/$/, '')
  return `${basePath}${normalizeCodexPath(requestPath)}`
}

export function normalizeOutboundProxyUrl(mode: string, value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`Outbound proxy URL is required for ${mode} mode`)
  }
  if (trimmed.includes('://')) {
    return trimmed
  }
  return `${mode}://${trimmed}`
}

export function isWhamUsagePath(path: string | undefined): boolean {
  return requestPathname(path) === '/backend-api/wham/usage'
}

export function isWhamRemotePath(path: string | undefined): boolean {
  const pathname = requestPathname(path)
  return (
    pathname === '/backend-api/wham/remote' ||
    pathname?.startsWith('/backend-api/wham/remote/') === true
  )
}

export function isCodexModelsPath(path: string | undefined): boolean {
  const pathname = requestPathname(path)
  return pathname === '/backend-api/codex/models' || pathname === '/v1/models'
}

export function isCodexResponsesPath(path: string | undefined): boolean {
  const pathname = requestPathname(path)
  return pathname === '/backend-api/codex/responses' || pathname === '/v1/responses'
}

export function isCodexCompactPath(path: string | undefined): boolean {
  if (!path) {
    return false
  }
  const pathname = requestPathname(path)
  return pathname === '/backend-api/codex/responses/compact' || pathname === '/v1/responses/compact'
}

function requestPathname(path: string | undefined): string | undefined {
  if (!path) {
    return undefined
  }
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return new URL(path).pathname
  }
  const queryStart = path.indexOf('?')
  const hashStart = path.indexOf('#')
  const end =
    queryStart === -1
      ? hashStart === -1
        ? path.length
        : hashStart
      : Math.min(queryStart, path.length)
  return path.slice(0, end)
}
