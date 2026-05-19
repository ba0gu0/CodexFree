import { AppShell, type ThemeMode, type ViewId } from '@renderer/components/app-shell/app-shell'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import { Card, CardPanel } from '@renderer/components/ui/card'
import { Spinner } from '@renderer/components/ui/spinner'
import { toErrorMessage } from '@renderer/data/format'
import type {
  ConsoleActivityHasMore,
  ConsoleSnapshot,
  DaemonControlSaveInput,
  ProxyConfig,
  UsageProgress
} from '@renderer/data/proxy-console'
import { type CopyKey, createTranslator, type Locale, resolveLocale } from '@renderer/i18n/copy'
import { AccountsPage } from '@renderer/pages/accounts'
import { DashboardPage } from '@renderer/pages/dashboard'
import { ProxyPage } from '@renderer/pages/proxy'
import { RequestsPage } from '@renderer/pages/requests'
import type { PageActions } from '@renderer/pages/types'
import { UsagePage } from '@renderer/pages/usage'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AccountUsageCheckBatchDto, RawCaptureDetailDto } from '../../preload/proxy-api'

const ACTIVITY_INITIAL_LIMIT = 160
const ACTIVITY_PAGE_SIZE = 160
const ACTIVITY_MAX_LIMIT = 1_000
const LOCALE_STORAGE_KEY = 'codexfree.locale'
const THEME_STORAGE_KEY = 'codexfree.theme'
const EMPTY_ACTIVITY_HAS_MORE: ConsoleActivityHasMore = {
  logEvents: false,
  protocolMessages: false,
  requests: false
}

function App(): React.JSX.Element {
  const [activeView, setActiveView] = useState<ViewId>('dashboard')
  const [activityLimit, setActivityLimit] = useState(ACTIVITY_INITIAL_LIMIT)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [capture, setCapture] = useState<RawCaptureDetailDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hasMoreActivity, setHasMoreActivity] =
    useState<ConsoleActivityHasMore>(EMPTY_ACTIVITY_HAS_MORE)
  const [lastRefresh, setLastRefresh] = useState<number | null>(null)
  const [locale, setLocale] = useState<Locale>(resolveInitialLocale)
  const [notice, setNotice] = useState<string | null>(null)
  const [requestSearchQuery, setRequestSearchQuery] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<ConsoleSnapshot | null>(null)
  const [themeMode, setThemeMode] = useState<ThemeMode>(resolveInitialThemeMode)
  const [usageProgress, setUsageProgress] = useState<UsageProgress | null>(null)
  const lastLoadMoreAt = useRef(0)
  const usageTaskRef = useRef(false)
  const t = useMemo(() => createTranslator(locale), [locale])

  const refresh = useCallback(async (): Promise<void> => {
    setError(null)
    const [
      version,
      config,
      status,
      daemonControl,
      managedAuthDirectory,
      requestPage,
      accounts,
      requestSummary,
      logEventPage,
      protocolMessagePage,
      usageSummary
    ] = await Promise.all([
      window.api.getVersion(),
      window.api.getProxyConfig(),
      window.api.getProxyStatus(),
      window.api.getDaemonControlSettings(),
      window.api.getManagedAuthDirectory(),
      window.api.getRecentRequests(activityLimit),
      window.api.getManagedAccounts(),
      window.api.getRequestSummary(),
      window.api.getProxyLogEvents(activityLimit),
      window.api.getProtocolMessages(activityLimit),
      window.api.getUsageSummary()
    ])
    setSnapshot({
      accounts,
      config,
      daemonControl,
      logEvents: logEventPage.items,
      managedAuthDirectory,
      protocolMessages: protocolMessagePage.items,
      requestSummary,
      requests: requestPage.items,
      status,
      usageSummary,
      version
    })
    setHasMoreActivity({
      logEvents: activityLimit < ACTIVITY_MAX_LIMIT && logEventPage.hasMore,
      protocolMessages: activityLimit < ACTIVITY_MAX_LIMIT && protocolMessagePage.hasMore,
      requests: activityLimit < ACTIVITY_MAX_LIMIT && requestPage.hasMore
    })
    setLastRefresh(Date.now())
  }, [activityLimit])

  useEffect(() => {
    refresh().catch((refreshError: unknown) => setError(toErrorMessage(refreshError)))
    return undefined
  }, [refresh])

  useEffect(() => {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
    window.api.setLocale(locale).catch((localeError: unknown) => {
      if (!isMissingLocaleSyncHandlerError(localeError)) {
        setError(toErrorMessage(localeError))
      }
    })
  }, [locale])

  useEffect(() => {
    localStorage.setItem(THEME_STORAGE_KEY, themeMode)
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = (): void => {
      const dark = themeMode === 'dark' || (themeMode === 'system' && media.matches)
      document.documentElement.classList.toggle('dark', dark)
    }
    applyTheme()
    media.addEventListener('change', applyTheme)
    return () => media.removeEventListener('change', applyTheme)
  }, [themeMode])

  useEffect(() => {
    if (!notice) {
      return undefined
    }
    const timer = window.setTimeout(() => setNotice(null), 2_500)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    return window.api.onAccountUsageProgress((progress) => setUsageProgress(progress))
  }, [])

  const switchView = useCallback(
    (view: ViewId, options?: { requestSearchQuery?: string | null }): void => {
      setNotice(null)
      if (view === 'requests') {
        setRequestSearchQuery(options?.requestSearchQuery ?? null)
      } else {
        setRequestSearchQuery(null)
      }
      setActiveView(view)
      refresh().catch((refreshError: unknown) => setError(toErrorMessage(refreshError)))
    },
    [refresh]
  )

  const loadMoreActivity = useCallback((): void => {
    if (!Object.values(hasMoreActivity).some(Boolean)) {
      return
    }
    const now = Date.now()
    if (now - lastLoadMoreAt.current < 600) {
      return
    }
    lastLoadMoreAt.current = now
    setActivityLimit((current) => Math.min(ACTIVITY_MAX_LIMIT, current + ACTIVITY_PAGE_SIZE))
  }, [hasMoreActivity])

  const cycleTheme = useCallback((): void => {
    setThemeMode((current) => {
      if (current === 'system') {
        return 'dark'
      }
      return current === 'dark' ? 'light' : 'system'
    })
  }, [])

  const runAction = useCallback(
    async <T,>(key: string, task: () => Promise<T>, success?: (result: T) => string) => {
      setBusyAction(key)
      setError(null)
      setNotice(null)
      try {
        const result = await task()
        setNotice(success ? success(result) : t('shell.notice'))
        await refresh()
      } catch (actionError) {
        setError(toErrorMessage(actionError))
      } finally {
        setBusyAction(null)
      }
    },
    [refresh, t]
  )

  const runUsageTask = useCallback(
    async (task: () => Promise<AccountUsageCheckBatchDto>) => {
      if (usageTaskRef.current) {
        setNotice(t('accounts.usageTaskRunning'))
        return
      }
      usageTaskRef.current = true
      setUsageProgress({ completed: 0, total: 0 })
      setBusyAction('usage')
      setError(null)
      setNotice(null)
      try {
        const result = await task()
        setNotice(usageDoneText(result, t))
        await refresh()
      } catch (usageError) {
        setError(toErrorMessage(usageError))
      } finally {
        setUsageProgress(null)
        setBusyAction(null)
        usageTaskRef.current = false
      }
    },
    [refresh, t]
  )

  const runSingleUsageTask = useCallback(
    async (accountIds: string[]) => {
      if (usageTaskRef.current) {
        setNotice(t('accounts.usageTaskRunning'))
        return
      }
      usageTaskRef.current = true
      setError(null)
      setNotice(null)
      setUsageProgress(null)
      try {
        const result =
          accountIds.length > 0
            ? await window.api.checkSelectedAccountUsage(accountIds)
            : await window.api.checkAccountUsage()
        setNotice(usageDoneText(result, t))
        await refresh()
      } catch (usageError) {
        setError(toErrorMessage(usageError))
      } finally {
        setUsageProgress(null)
        usageTaskRef.current = false
      }
    },
    [refresh, t]
  )

  const actions: PageActions = {
    checkUsage: () => runUsageTask(() => window.api.checkAccountUsage()),
    checkUsageForAccounts: runSingleUsageTask,
    cleanExpired: () =>
      runAction(
        'clean',
        () => window.api.cleanExpiredAccounts(),
        () => t('notice.cleaned')
      ),
    clearRecords: () =>
      runAction(
        'clear',
        () => window.api.clearProxyRecords(),
        () => t('notice.recordsCleared')
      ),
    exportAuthFiles: () =>
      runAction(
        'export',
        () => window.api.exportAuthFiles(),
        () => t('notice.exported')
      ),
    importAuthFiles: () =>
      runAction(
        'import',
        () => window.api.importAuthFiles(),
        () => t('notice.imported')
      ),
    loadMoreActivity,
    openManagedAuthDirectory: () =>
      runAction(
        'openAuthDir',
        () => window.api.openManagedAuthDirectory(),
        () => t('notice.directoryOpened')
      ),
    openRawCaptureDirectory: () =>
      runAction(
        'openRawDir',
        () => window.api.openRawCaptureDirectory(),
        () => t('notice.directoryOpened')
      ),
    openWorkDirectory: () =>
      runAction(
        'openWorkDir',
        () => window.api.openWorkDirectory(),
        () => t('notice.directoryOpened')
      ),
    openCapture: async (requestId) => {
      setBusyAction(`capture:${requestId}`)
      setError(null)
      try {
        setCapture((await window.api.getRawCapture(requestId)) ?? null)
      } catch (captureError) {
        setError(toErrorMessage(captureError))
      } finally {
        setBusyAction(null)
      }
    },
    refresh: () => runAction('refresh', refresh, () => t('notice.refreshed')),
    resetExhausted: () =>
      runAction(
        'reset',
        () => window.api.resetExhaustedAccounts(),
        () => t('notice.accountsUpdated')
      ),
    restartProxy: () =>
      runAction(
        'restart',
        () => window.api.restartProxy(),
        () => t('notice.proxyRestarted')
      ),
    saveConfig: (config: ProxyConfig) =>
      runAction(
        'save',
        () => window.api.saveProxyConfig(config),
        () => t('notice.configSaved')
      ),
    saveDaemonControlSettings: (input: DaemonControlSaveInput) =>
      runAction(
        'saveDaemonControl',
        () => window.api.saveDaemonControlSettings(input),
        () => t('notice.configSaved')
      ),
    saveProxyPageConfig: (config: ProxyConfig, input: DaemonControlSaveInput) =>
      runAction(
        'save',
        async () => {
          await window.api.saveDaemonControlSettings(input)
          return window.api.saveProxyConfig(config)
        },
        () => t('notice.configSaved')
      ),
    setAccountDisabled: (accountId, disabled) =>
      runAction(
        'account',
        () => window.api.setAccountDisabled(accountId, disabled),
        () => (disabled ? t('notice.accountDisabled') : t('notice.accountEnabled'))
      ),
    setAccountsDisabled: (accountIds, disabled) =>
      runAction(
        'account',
        () => window.api.setAccountsDisabled(accountIds, disabled),
        () => (disabled ? t('notice.accountsDisabled') : t('notice.accountsEnabled'))
      ),
    deleteAccounts: (accountIds) =>
      runAction(
        'account',
        () => window.api.deleteAccounts(accountIds),
        () => t('notice.accountsDeleted')
      ),
    showRequests: (searchQuery) =>
      switchView('requests', { requestSearchQuery: searchQuery ?? null }),
    showUsage: () => switchView('usage'),
    startProxy: () =>
      runAction(
        'start',
        () => window.api.startProxy(),
        () => t('notice.proxyStarted')
      ),
    stopProxy: () =>
      runAction(
        'stop',
        () => window.api.stopProxy(),
        () => t('notice.proxyStopped')
      ),
    writeCodexConfig: () =>
      runAction(
        'config',
        () => window.api.writeCodexConfig(),
        () => t('notice.codexConfigWritten')
      )
  }

  if (!snapshot) {
    return (
      <main className="flex h-full items-center justify-center bg-background p-6 text-foreground">
        <Card className="w-full max-w-md">
          <CardPanel className="flex items-center gap-3">
            <Spinner />
            <div className="flex flex-col gap-1">
              <div className="font-medium">{t('shell.loading')}</div>
              {error ? <div className="text-destructive-foreground text-sm">{error}</div> : null}
            </div>
          </CardPanel>
        </Card>
      </main>
    )
  }

  return (
    <AppShell
      activeView={activeView}
      locale={locale}
      onLocaleChange={setLocale}
      onThemeCycle={cycleTheme}
      onViewChange={switchView}
      t={t}
      themeMode={themeMode}
    >
      {error ? (
        <Alert
          className="fixed top-[76px] left-1/2 z-50 w-[min(300px,calc(100vw-48px))] -translate-x-1/2 rounded-lg border-destructive/35 bg-popover/95 px-3 py-2 text-xs shadow-lg backdrop-blur [&_[data-slot=alert-description]]:text-xs [&_[data-slot=alert-title]]:text-sm"
          variant="error"
        >
          <AlertTitle>{t('shell.error')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert
          className="fixed top-[76px] left-1/2 z-50 w-[min(300px,calc(100vw-48px))] -translate-x-1/2 rounded-lg border-success/35 bg-popover/95 px-3 py-2 text-xs shadow-lg backdrop-blur [&_[data-slot=alert-description]]:text-xs [&_[data-slot=alert-title]]:text-sm"
          variant="success"
        >
          <AlertTitle>{t('shell.success')}</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}
      {renderPage(activeView, {
        actions,
        busyAction,
        capture,
        hasMoreActivity,
        lastRefresh,
        locale,
        onCaptureClose: () => setCapture(null),
        requestSearchQuery,
        snapshot,
        t,
        usageProgress
      })}
    </AppShell>
  )
}

function resolveInitialLocale(): Locale {
  const stored = localStorage.getItem(LOCALE_STORAGE_KEY)
  return stored === 'zh-CN' || stored === 'en' ? stored : resolveLocale(navigator.language)
}

function resolveInitialThemeMode(): ThemeMode {
  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  return stored === 'dark' || stored === 'light' || stored === 'system' ? stored : 'system'
}

function usageDoneText(
  result: AccountUsageCheckBatchDto,
  t: (key: CopyKey, values?: Record<string, string | number>) => string
): string {
  return t('accounts.usageCheckDone', {
    failed: result.results.filter((item) => !item.ok).length,
    total: result.results.length
  })
}

function renderPage(view: ViewId, props: Parameters<typeof DashboardPage>[0]): React.JSX.Element {
  if (view === 'dashboard') {
    return <DashboardPage {...props} />
  }

  const page = renderSecondaryPage(view, props)
  return <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden px-6 py-1">{page}</div>
}

function renderSecondaryPage(
  view: Exclude<ViewId, 'dashboard'>,
  props: Parameters<typeof DashboardPage>[0]
): React.JSX.Element {
  if (view === 'accounts') {
    return <AccountsPage {...props} />
  }
  if (view === 'proxy') {
    return <ProxyPage {...props} />
  }
  if (view === 'requests') {
    return <RequestsPage {...props} />
  }
  if (view === 'usage') {
    return <UsagePage {...props} />
  }
  const exhaustive: never = view
  return exhaustive
}

function isMissingLocaleSyncHandlerError(error: unknown): boolean {
  const message = toErrorMessage(error)
  return message.includes('app:set-locale') && message.includes('No handler registered')
}

export default App
