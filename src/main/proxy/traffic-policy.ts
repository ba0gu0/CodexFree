export interface RequestRecordPolicyInput {
  outcome: string
  path: string | undefined
}

const managedAccountHeaderPaths = new Set([
  '/backend-api/codex/models',
  '/backend-api/codex/responses',
  '/backend-api/codex/responses/compact',
  '/backend-api/wham/usage'
])

const recordedForwardedPaths = new Set([
  '/backend-api/codex/responses',
  '/backend-api/codex/responses/compact',
  '/backend-api/wham/usage'
])

export function shouldUseManagedAccountHeaders(path: string | undefined): boolean {
  const pathname = requestPathname(path)
  return pathname ? managedAccountHeaderPaths.has(pathname) : false
}

export function shouldRecordProxyRequest(input: RequestRecordPolicyInput): boolean {
  if (input.outcome !== 'forwarded') {
    return true
  }
  const pathname = requestPathname(input.path)
  return pathname ? recordedForwardedPaths.has(pathname) : false
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
