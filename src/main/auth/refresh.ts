import type { CodexChatGptAuth } from './normalize'

const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const TOKEN_ENDPOINT = 'https://auth.openai.com/oauth/token'
const REFRESH_AFTER_MS = 8 * 24 * 60 * 60 * 1000

interface RefreshTokenResponse {
  access_token?: unknown
  refresh_token?: unknown
  id_token?: unknown
}

export interface TokenRefreshFailure {
  accountId: string
  error: string
}

export type TokenRefresher = (auth: CodexChatGptAuth, now: Date) => Promise<CodexChatGptAuth>

export function shouldRefreshChatGptAuth(auth: CodexChatGptAuth, now = new Date()): boolean {
  const lastRefresh = Date.parse(auth.last_refresh)
  if (!Number.isFinite(lastRefresh)) {
    return true
  }

  return now.getTime() - lastRefresh >= REFRESH_AFTER_MS
}

export async function refreshChatGptAuth(
  auth: CodexChatGptAuth,
  now = new Date(),
  fetchImpl: typeof fetch = fetch
): Promise<CodexChatGptAuth> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CODEX_CLIENT_ID,
    refresh_token: auth.tokens.refresh_token
  })
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  })
  const payload = (await response.json().catch(() => undefined)) as RefreshTokenResponse | undefined
  if (!response.ok || typeof payload?.access_token !== 'string') {
    throw new Error(`ChatGPT token refresh failed with status ${response.status}`)
  }

  return {
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    tokens: {
      id_token: typeof payload.id_token === 'string' ? payload.id_token : auth.tokens.id_token,
      access_token: payload.access_token,
      refresh_token:
        typeof payload.refresh_token === 'string'
          ? payload.refresh_token
          : auth.tokens.refresh_token,
      account_id: auth.tokens.account_id
    },
    last_refresh: now.toISOString()
  }
}

export async function refreshChatGptAuthIfNeeded(
  auth: CodexChatGptAuth,
  now = new Date()
): Promise<CodexChatGptAuth> {
  if (!shouldRefreshChatGptAuth(auth, now)) {
    return auth
  }

  return refreshChatGptAuth(auth, now)
}
