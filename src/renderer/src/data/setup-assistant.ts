import type { CopyKey, Locale } from '@renderer/i18n/copy'
import type { SetupAssistantState } from './proxy-console'

export type SetupSectionKey = 'daemon' | 'config' | 'auth' | 'accounts' | 'success'
export type SetupTone = 'success' | 'warning' | 'error'

export interface SetupSectionStatus {
  detail: string
  key: SetupSectionKey
  label: string
  tone: SetupTone
  value: string
}

export function setupSections(
  state: SetupAssistantState,
  t: (key: CopyKey, values?: Record<string, string | number>) => string,
  locale: Locale
): SetupSectionStatus[] {
  return [
    daemonSection(state, t, locale),
    configSection(state, t, locale),
    authSection(state, t, locale),
    accountSection(state, t, locale),
    successSection(state, t, locale)
  ]
}

export function needsOnboarding(state: SetupAssistantState): boolean {
  return !state.ready
}

export function setupPercent(state: SetupAssistantState): number {
  const completed = setupSections(state, fallbackTranslator, 'zh-CN').filter(
    (item) => item.tone === 'success'
  ).length
  return Math.round((completed / 5) * 100)
}

function daemonSection(
  state: SetupAssistantState,
  t: (key: CopyKey, values?: Record<string, string | number>) => string,
  locale: Locale
): SetupSectionStatus {
  return {
    detail: withCheckedAt(state.daemon.error ?? state.daemon.endpoint, state, t, locale),
    key: 'daemon',
    label: t('setup.daemon'),
    tone: state.daemon.running ? 'success' : 'error',
    value: state.daemon.running
      ? t(`setup.runMode.${state.daemon.mode}` as CopyKey)
      : t('status.stopped')
  }
}

function configSection(
  state: SetupAssistantState,
  t: (key: CopyKey, values?: Record<string, string | number>) => string,
  locale: Locale
): SetupSectionStatus {
  const healthy = state.codexConfig.health === 'current'
  return {
    detail: withCheckedAt(
      t(`setup.configHealth.${state.codexConfig.health}` as CopyKey),
      state,
      t,
      locale
    ),
    key: 'config',
    label: t('setup.codexConfig'),
    tone: healthy ? 'success' : 'warning',
    value: healthy ? t('status.current') : t('setup.needsRepair')
  }
}

function authSection(
  state: SetupAssistantState,
  t: (key: CopyKey, values?: Record<string, string | number>) => string,
  locale: Locale
): SetupSectionStatus {
  const healthy = state.auth.health === 'codex_login_like'
  const tone = healthy ? 'success' : state.auth.health === 'missing' ? 'error' : 'warning'
  return {
    detail: withCheckedAt(t(`setup.authHealth.${state.auth.health}` as CopyKey), state, t, locale),
    key: 'auth',
    label: t('setup.codexAuth'),
    tone,
    value: healthy ? t('setup.loginReady') : t('setup.loginNeeded')
  }
}

function accountSection(
  state: SetupAssistantState,
  t: (key: CopyKey, values?: Record<string, string | number>) => string,
  locale: Locale
): SetupSectionStatus {
  const healthy = state.accounts.available > 0
  return {
    detail: withCheckedAt(
      t('setup.accountsDetail', {
        available: state.accounts.available,
        disabled: state.accounts.disabled,
        exhausted: state.accounts.exhausted,
        total: state.accounts.total,
        usageChecked: state.accounts.usageCheckedAvailable
      }),
      state,
      t,
      locale
    ),
    key: 'accounts',
    label: t('setup.accountPool'),
    tone: healthy ? 'success' : 'warning',
    value: healthy
      ? t('setup.accountsAvailable', { count: state.accounts.available })
      : formatDate(state.accounts.lastUsageCheckedAt, locale)
  }
}

function successSection(
  state: SetupAssistantState,
  t: (key: CopyKey, values?: Record<string, string | number>) => string,
  locale: Locale
): SetupSectionStatus {
  const healthy = state.recentSuccess.kind !== null
  return {
    detail: withCheckedAt(
      healthy
        ? t(`setup.recentSuccess.${state.recentSuccess.kind}` as CopyKey)
        : t('setup.recentSuccess.none'),
      state,
      t,
      locale
    ),
    key: 'success',
    label: t('setup.finishCheck'),
    tone: healthy ? 'success' : 'warning',
    value: formatDate(state.recentSuccess.seenAt, locale)
  }
}

function formatDate(value: number | null, locale: Locale): string {
  if (value === null) {
    return '-'
  }
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit'
  }).format(value)
}

function withCheckedAt(
  detail: string,
  state: SetupAssistantState,
  t: (key: CopyKey, values?: Record<string, string | number>) => string,
  locale: Locale
): string {
  return `${detail} · ${t('setup.checkedAt', { time: formatDate(state.checkedAt, locale) })}`
}

function fallbackTranslator(key: CopyKey): string {
  return key
}
