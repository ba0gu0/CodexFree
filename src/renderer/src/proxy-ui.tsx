import {
  BarChart3,
  DatabaseZap,
  Globe2,
  Languages,
  Moon,
  RotateCcw,
  Save,
  Server,
  ShieldAlert,
  Sun,
  UsersRound
} from 'lucide-react'
import { useState } from 'react'
import type { Locale, ProxyConfig, ProxyStatus, RecentRequest, ViewId } from './App'
import * as m from './paraglide/messages.js'
import { text } from './ui-text'

type OutboundMode = ProxyConfig['outboundProxy']['mode']
type IconComponent = typeof Server
type RawCaptureDetail = Awaited<ReturnType<(typeof window)['api']['getRawCapture']>>

const outboundModes: OutboundMode[] = ['direct', 'http', 'https', 'socks4', 'socks5']

export function PageHeader({
  locale,
  title,
  view
}: {
  locale: Locale
  title: string
  view: ViewId
}): React.JSX.Element {
  const bodyByView: Record<ViewId, string> = {
    dashboard: text(m.dashboard_body, locale),
    proxy: text(m.proxy_body, locale),
    requests: text(m.requests_body, locale),
    accounts: text(m.accounts_body, locale),
    usage: text(m.usage_body, locale),
    settings: text(m.settings_body, locale)
  }

  return (
    <header>
      <p className="text-slate-500 text-sm dark:text-zinc-400">{text(m.app_subtitle, locale)}</p>
      <h2 className="mt-2 font-semibold text-2xl tracking-normal">{title}</h2>
      <p className="mt-3 max-w-4xl text-sm text-slate-600 leading-6 dark:text-zinc-300">
        {bodyByView[view]}
      </p>
    </header>
  )
}

export function ViewContent({
  activeView,
  config,
  isDark,
  locale,
  requests,
  restartProxy,
  saveConfig,
  setConfig,
  status
}: {
  activeView: ViewId
  config: ProxyConfig | undefined
  isDark: boolean
  locale: Locale
  requests: RecentRequest[]
  restartProxy: () => Promise<void>
  saveConfig: () => Promise<void>
  setConfig: (config: ProxyConfig) => void
  status: ProxyStatus | undefined
}): React.JSX.Element {
  if (activeView === 'dashboard') {
    return <Dashboard locale={locale} requests={requests} status={status} />
  }
  if (activeView === 'proxy' && config && status) {
    return (
      <ProxySettings
        config={config}
        locale={locale}
        onChange={setConfig}
        onRestart={restartProxy}
        onSave={saveConfig}
        status={status}
      />
    )
  }
  if (activeView === 'requests') {
    return <RequestLedger locale={locale} requests={requests} />
  }
  if (activeView === 'settings') {
    return <SystemSettings isDark={isDark} locale={locale} />
  }
  if (activeView === 'usage') {
    return (
      <EmptyState
        body={text(m.usage_empty_body, locale)}
        Icon={BarChart3}
        title={text(m.usage_empty_title, locale)}
      />
    )
  }
  return (
    <EmptyState
      body={text(m.accounts_empty_body, locale)}
      Icon={UsersRound}
      title={text(m.accounts_empty_title, locale)}
    />
  )
}

function Dashboard({
  locale,
  requests,
  status
}: {
  locale: Locale
  requests: RecentRequest[]
  status: ProxyStatus | undefined
}): React.JSX.Element {
  const cards = [
    {
      label: text(m.status_proxy, locale),
      value: status?.running ? text(m.proxy_running, locale) : text(m.proxy_stopped, locale),
      Icon: Server
    },
    {
      label: text(m.dashboard_active_endpoint, locale),
      value: status?.endpoint ?? '-',
      Icon: Globe2
    },
    {
      label: text(m.dashboard_request_count, locale),
      value: String(requests.length),
      Icon: DatabaseZap
    },
    {
      label: text(m.dashboard_next_step, locale),
      value: text(m.dashboard_next_step_value, locale),
      Icon: ShieldAlert
    }
  ]

  return (
    <section className="mt-7 grid grid-cols-2 gap-4">
      {cards.map(({ Icon, label, value }) => (
        <article className={cardClass} key={label}>
          <div className="flex items-center gap-2 text-slate-500 dark:text-zinc-400">
            <Icon aria-hidden="true" size={16} />
            <p className="text-sm">{label}</p>
          </div>
          <p className="mt-3 break-all font-medium text-lg tracking-normal">{value}</p>
        </article>
      ))}
    </section>
  )
}

function ProxySettings({
  config,
  locale,
  onChange,
  onRestart,
  onSave,
  status
}: {
  config: ProxyConfig
  locale: Locale
  onChange: (config: ProxyConfig) => void
  onRestart: () => Promise<void>
  onSave: () => Promise<void>
  status: ProxyStatus
}): React.JSX.Element {
  return (
    <section className={`mt-7 p-5 ${cardClass}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-medium text-base tracking-normal">{text(m.proxy_title, locale)}</h3>
          <p className="mt-1 text-slate-500 text-xs dark:text-zinc-400">{status.endpoint}</p>
        </div>
        <div className="flex gap-2">
          <button className={secondaryButtonClass} onClick={() => void onRestart()} type="button">
            <RotateCcw aria-hidden="true" size={16} />
            {text(m.proxy_restart, locale)}
          </button>
          <button className={primaryButtonClass} onClick={() => void onSave()} type="button">
            <Save aria-hidden="true" size={16} />
            {text(m.proxy_save_restart, locale)}
          </button>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4">
        <TextField
          label={text(m.proxy_listen_host, locale)}
          value={config.listenHost}
          onChange={(listenHost) => onChange({ ...config, listenHost })}
        />
        <TextField
          label={text(m.proxy_listen_port, locale)}
          value={String(config.listenPort)}
          onChange={(listenPort) => onChange({ ...config, listenPort: Number(listenPort) })}
        />
        <TextField
          className="col-span-2"
          label={text(m.proxy_upstream_base, locale)}
          value={config.upstreamBaseUrl}
          onChange={(upstreamBaseUrl) => onChange({ ...config, upstreamBaseUrl })}
        />
        <label className={fieldClass}>
          {text(m.proxy_outbound_mode, locale)}
          <select
            className={inputClass}
            value={config.outboundProxy.mode}
            onChange={(event) =>
              onChange({
                ...config,
                outboundProxy: { ...config.outboundProxy, mode: event.target.value as OutboundMode }
              })
            }
          >
            {outboundModes.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </label>
        <TextField
          label={text(m.proxy_outbound_url, locale)}
          value={config.outboundProxy.url}
          onChange={(url) =>
            onChange({ ...config, outboundProxy: { ...config.outboundProxy, url } })
          }
        />
      </div>

      <label className="mt-5 flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-zinc-800 dark:bg-zinc-950">
        <input
          checked={config.rawCaptureEnabled}
          className="mt-1"
          onChange={(event) => onChange({ ...config, rawCaptureEnabled: event.target.checked })}
          type="checkbox"
        />
        <span>
          <span className="block text-sm">{text(m.proxy_raw_capture_toggle, locale)}</span>
          <span className="mt-1 block text-slate-500 text-xs dark:text-zinc-400">
            {text(m.proxy_debug_notice, locale)}
          </span>
          <span className="mt-2 block break-all text-slate-400 text-xs dark:text-zinc-500">
            {text(m.proxy_raw_capture_dir, locale)}: {status.rawCaptureDir}
          </span>
        </span>
      </label>
    </section>
  )
}

function RequestLedger({
  locale,
  requests
}: {
  locale: Locale
  requests: RecentRequest[]
}): React.JSX.Element {
  const [detail, setDetail] = useState<RawCaptureDetail>()

  async function openCapture(requestId: string): Promise<void> {
    setDetail(await window.api.getRawCapture(requestId))
  }

  return (
    <section className={`mt-7 p-5 ${cardClass}`}>
      {requests.length === 0 ? (
        <p className="text-slate-500 text-sm dark:text-zinc-400">
          {text(m.requests_empty, locale)}
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border border-slate-200 dark:border-zinc-800">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-slate-100 text-slate-500 dark:bg-zinc-950 dark:text-zinc-400">
              <tr>
                <th className={tableHeadClass}>{text(m.field_path, locale)}</th>
                <th className={tableHeadClass}>{text(m.field_status, locale)}</th>
                <th className={tableHeadClass}>{text(m.field_duration, locale)}</th>
                <th className={tableHeadClass}>{text(m.field_upstream, locale)}</th>
                <th className={tableHeadClass}>{text(m.field_capture, locale)}</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr className="border-slate-200 border-t dark:border-zinc-800" key={request.id}>
                  <td className="max-w-[360px] break-all px-4 py-3">
                    <span className="font-medium">{request.method}</span> {request.path}
                  </td>
                  <td className={tableCellClass}>{request.statusCode ?? request.outcome}</td>
                  <td className={tableCellClass}>{request.durationMs}ms</td>
                  <td className={tableCellClass}>{request.upstreamHost}</td>
                  <td className={tableCellClass}>
                    {request.rawCapturePath ? (
                      <button
                        className="rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-zinc-700"
                        onClick={() => void openCapture(request.id)}
                        type="button"
                      >
                        {text(m.capture_view, locale)}
                      </button>
                    ) : (
                      text(m.capture_disabled, locale)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {detail ? <CaptureDetail detail={detail} locale={locale} /> : null}
    </section>
  )
}

function CaptureDetail({
  detail,
  locale
}: {
  detail: RawCaptureDetail
  locale: Locale
}): React.JSX.Element {
  if (!detail || detail.files.length === 0) {
    return <p className="mt-5 text-slate-500 text-sm">{text(m.capture_detail_empty, locale)}</p>
  }

  return (
    <section className="mt-5 rounded-md border border-slate-200 bg-slate-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h3 className="font-medium text-base tracking-normal">
        {text(m.capture_detail_title, locale)}
      </h3>
      <p className="mt-2 break-all text-slate-500 text-xs dark:text-zinc-400">
        {text(m.capture_directory, locale)}: {detail.directory}
      </p>
      <div className="mt-4 grid gap-3">
        {detail.files.map((file) => (
          <details
            className="rounded-md border border-slate-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
            key={file.name}
          >
            <summary className="cursor-pointer text-sm">
              {file.name} · {file.size} bytes
            </summary>
            <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs leading-5">
              {file.content}
            </pre>
          </details>
        ))}
      </div>
    </section>
  )
}

function SystemSettings({
  isDark,
  locale
}: {
  isDark: boolean
  locale: Locale
}): React.JSX.Element {
  return (
    <section className="mt-7 grid grid-cols-2 gap-4">
      <PreferenceCard
        Icon={isDark ? Moon : Sun}
        label={text(m.settings_theme, locale)}
        value={`${text(m.settings_theme_system, locale)}: ${
          isDark ? text(m.settings_theme_dark, locale) : text(m.settings_theme_light, locale)
        }`}
      />
      <PreferenceCard
        Icon={Languages}
        label={text(m.settings_language, locale)}
        value={`${text(m.settings_language_system, locale)}: ${locale}`}
      />
    </section>
  )
}

function PreferenceCard({
  Icon,
  label,
  value
}: {
  Icon: IconComponent
  label: string
  value: string
}): React.JSX.Element {
  return (
    <article className={cardClass}>
      <div className="flex items-center gap-2 text-slate-500 dark:text-zinc-400">
        <Icon aria-hidden="true" size={16} />
        <p className="text-sm">{label}</p>
      </div>
      <p className="mt-3 font-medium text-lg tracking-normal">{value}</p>
    </article>
  )
}

function EmptyState({
  Icon,
  body,
  title
}: {
  Icon: IconComponent
  body: string
  title: string
}): React.JSX.Element {
  return (
    <section className={`mt-7 p-8 text-center ${cardClass}`}>
      <Icon aria-hidden="true" className="mx-auto text-slate-400 dark:text-zinc-500" size={28} />
      <h3 className="mt-4 font-medium text-lg tracking-normal">{title}</h3>
      <p className="mx-auto mt-2 max-w-xl text-slate-500 text-sm leading-6 dark:text-zinc-400">
        {body}
      </p>
    </section>
  )
}

function TextField({
  className,
  label,
  onChange,
  value
}: {
  className?: string
  label: string
  onChange: (value: string) => void
  value: string
}): React.JSX.Element {
  return (
    <label className={`${fieldClass} ${className ?? ''}`}>
      {label}
      <input
        className={inputClass}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  )
}

const cardClass =
  'rounded-lg border border-slate-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900'
const fieldClass = 'grid gap-2 text-sm text-slate-600 dark:text-zinc-300'
const inputClass =
  'rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-950 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100'
const primaryButtonClass =
  'inline-flex items-center gap-2 rounded-md bg-slate-950 px-3 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-950'
const secondaryButtonClass =
  'inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 dark:border-zinc-700 dark:text-zinc-200'
const tableHeadClass = 'px-4 py-3 font-medium'
const tableCellClass = 'px-4 py-3 text-slate-600 dark:text-zinc-300'
