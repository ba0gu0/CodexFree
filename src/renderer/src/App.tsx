import { Activity, BarChart3, FileClock, Server, Settings, UsersRound } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import * as m from './paraglide/messages.js'
import { PageHeader, ViewContent } from './proxy-ui'
import { text, titleForView } from './ui-text'

export type ProxyConfig = Awaited<ReturnType<(typeof window)['api']['getProxyConfig']>>
export type ProxyStatus = Awaited<ReturnType<(typeof window)['api']['getProxyStatus']>>
export type RecentRequest = Awaited<ReturnType<(typeof window)['api']['getRecentRequests']>>[number]
export type Locale = 'zh-CN' | 'en'
export type ViewId = 'dashboard' | 'proxy' | 'requests' | 'accounts' | 'usage' | 'settings'

function App(): React.JSX.Element {
  const [config, setConfig] = useState<ProxyConfig>()
  const [status, setStatus] = useState<ProxyStatus>()
  const [requests, setRequests] = useState<RecentRequest[]>([])
  const [activeView, setActiveView] = useState<ViewId>('dashboard')
  const [locale, setLocale] = useState<Locale>(() => resolveSystemLocale())
  const [isDark, setIsDark] = useState<boolean>(() => resolveSystemTheme())

  const refresh = useCallback(async (): Promise<void> => {
    const [nextConfig, nextStatus, nextRequests] = await Promise.all([
      window.api.getProxyConfig(),
      window.api.getProxyStatus(),
      window.api.getRecentRequests()
    ])
    setConfig(nextConfig)
    setStatus(nextStatus)
    setRequests(nextRequests)
  }, [])

  const refreshStatus = useCallback(async (): Promise<void> => {
    const [nextStatus, nextRequests] = await Promise.all([
      window.api.getProxyStatus(),
      window.api.getRecentRequests()
    ])
    setStatus(nextStatus)
    setRequests(nextRequests)
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refreshStatus(), 3000)
    return () => window.clearInterval(timer)
  }, [refresh, refreshStatus])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onThemeChange = (): void => setIsDark(media.matches)
    const onLanguageChange = (): void => setLocale(resolveSystemLocale())
    media.addEventListener('change', onThemeChange)
    window.addEventListener('languagechange', onLanguageChange)
    return () => {
      media.removeEventListener('change', onThemeChange)
      window.removeEventListener('languagechange', onLanguageChange)
    }
  }, [])

  const navItems = useMemo(
    () => [
      { id: 'dashboard' as const, label: text(m.nav_dashboard, locale), Icon: Activity },
      { id: 'proxy' as const, label: text(m.nav_proxy, locale), Icon: Server },
      { id: 'requests' as const, label: text(m.nav_requests, locale), Icon: FileClock },
      { id: 'accounts' as const, label: text(m.nav_accounts, locale), Icon: UsersRound },
      { id: 'usage' as const, label: text(m.nav_usage, locale), Icon: BarChart3 },
      { id: 'settings' as const, label: text(m.nav_settings, locale), Icon: Settings }
    ],
    [locale]
  )

  async function saveConfig(): Promise<void> {
    if (!config) {
      return
    }
    const result = await window.api.saveProxyConfig(config)
    setConfig(result.config)
    setStatus(result.status)
    setRequests(await window.api.getRecentRequests())
  }

  async function restartProxy(): Promise<void> {
    setStatus(await window.api.restartProxy())
  }

  const themeClass = isDark ? 'dark bg-zinc-950 text-zinc-100' : 'bg-slate-50 text-slate-950'

  return (
    <main className={`min-h-screen ${themeClass}`}>
      <aside className="fixed inset-y-0 left-0 w-64 border-slate-200 border-r bg-white px-4 py-5 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center gap-3 px-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-950 text-white dark:bg-zinc-100 dark:text-zinc-950">
            <Server aria-hidden="true" size={18} />
          </div>
          <div>
            <h1 className="font-semibold text-lg tracking-normal">{text(m.app_title, locale)}</h1>
            <p className="text-slate-500 text-xs dark:text-zinc-500">
              {status?.running ? text(m.proxy_running, locale) : text(m.proxy_stopped, locale)}
            </p>
          </div>
        </div>

        <nav className="mt-8 grid gap-1">
          {navItems.map(({ Icon, id, label }) => (
            <button
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-left text-sm ${
                activeView === id
                  ? 'bg-slate-950 text-white dark:bg-zinc-100 dark:text-zinc-950'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-zinc-300 dark:hover:bg-zinc-900'
              }`}
              key={id}
              onClick={() => setActiveView(id)}
              type="button"
            >
              <Icon aria-hidden="true" size={16} />
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <section className="ml-64 px-8 py-7">
        <PageHeader locale={locale} title={titleForView(activeView, locale)} view={activeView} />
        <ViewContent
          activeView={activeView}
          config={config}
          isDark={isDark}
          locale={locale}
          requests={requests}
          restartProxy={restartProxy}
          saveConfig={saveConfig}
          setConfig={setConfig}
          status={status}
        />
      </section>
    </main>
  )
}

function resolveSystemLocale(): Locale {
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

function resolveSystemTheme(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export default App
