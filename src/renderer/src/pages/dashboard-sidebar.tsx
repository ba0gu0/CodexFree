import { Button } from '@renderer/components/ui/button'
import { formatDateTime } from '@renderer/data/format'
import type { ReactElement } from 'react'
import { type ActivityRow, rowTone, typeLabel } from './dashboard-model'
import type { PageProps } from './types'

const panel = 'rounded-xl border border-border/70 bg-card p-3 shadow-sm'
const muted = 'text-muted-foreground'
const title = 'font-extrabold text-foreground'

export function ServicePanel({ snapshot, t }: Pick<PageProps, 'snapshot' | 't'>): ReactElement {
  const connected = snapshot.status.running
  return (
    <section
      className={`${panel} flex h-[144px] shrink-0 flex-col justify-center gap-2 min-[1400px]:h-[158px]`}
    >
      <div className={`${muted} font-bold text-xs`}>{t('dashboard.service')}</div>
      <div className="flex min-w-0 items-center gap-2">
        <ConnectionWaves connected={connected} />
        <div
          className={`truncate font-extrabold text-xl min-[1400px]:text-2xl ${
            connected ? 'text-success' : 'text-warning'
          }`}
        >
          {connected ? t('dashboard.daemonConnected') : t('dashboard.daemonDisconnected')}
        </div>
      </div>
      <div className="font-bold text-foreground text-xs">
        {t('dashboard.daemonHistoryRequests', { requests: snapshot.requests.length })}
      </div>
      <div className={`${muted} font-semibold text-xs`}>{t('dashboard.daemonHint')}</div>
    </section>
  )
}

export function DirectoryPanel({ actions, t }: Pick<PageProps, 'actions' | 't'>): ReactElement {
  const rows = [
    ['dashboard.authDirectory', actions.openManagedAuthDirectory, 'bg-info/12 text-info'],
    ['dashboard.captureDirectory', actions.openRawCaptureDirectory, 'bg-warning/12 text-warning'],
    ['dashboard.workDirectory', actions.openWorkDirectory, 'bg-success/12 text-success']
  ] as const
  return (
    <section className={`${panel} flex h-[160px] shrink-0 flex-col gap-2.5 min-[1400px]:h-[188px]`}>
      <div className={`${muted} font-bold text-xs`}>{t('dashboard.directories')}</div>
      {rows.map(([key, action, className]) => (
        <Button
          className={`h-9 justify-between border-0 px-2.5 font-extrabold text-sm min-[1400px]:h-10 ${className}`}
          key={key}
          onClick={action}
          size="sm"
          variant="ghost"
        >
          {t(key)}
          <span className="font-bold text-xs">{t('dashboard.open')}</span>
        </Button>
      ))}
    </section>
  )
}

export function AlertPanel({ rows, t }: { rows: ActivityRow[]; t: PageProps['t'] }): ReactElement {
  const alerts = rows.slice(0, 3)
  return (
    <section
      className={`${panel} flex h-[140px] shrink-0 flex-col gap-2 p-3 min-[1400px]:h-[190px] min-[1400px]:p-4`}
    >
      <div className={`${muted} font-bold text-xs min-[1400px]:text-sm`}>
        {t('dashboard.alerts')}
      </div>
      {alerts.length === 0 ? (
        <div className="rounded-lg bg-muted/60 p-3 font-semibold text-muted-foreground text-xs">
          {t('dashboard.noEvent')}
        </div>
      ) : (
        alerts.map((row) => (
          <div
            className={`h-8 rounded-lg px-2 py-1 min-[1400px]:h-[38px] ${rowTone(row.kind)}`}
            key={row.id}
          >
            <div className="flex items-center gap-1.5 font-extrabold text-xs">
              <span className="shrink-0 rounded bg-background/70 px-1.5 py-0.5">
                {typeLabel(row.kind, t)}
              </span>
              <span className="min-w-0 truncate">{row.time}</span>
            </div>
            <div className="truncate font-semibold text-xs">{row.event}</div>
          </div>
        ))
      )}
    </section>
  )
}

export function VersionPanel({
  lastRefresh,
  locale,
  snapshot,
  t
}: Pick<PageProps, 'lastRefresh' | 'locale' | 'snapshot' | 't'>): ReactElement {
  return (
    <section
      className={`${panel} flex h-[132px] shrink-0 flex-col justify-center gap-2 min-[1400px]:h-[146px]`}
    >
      <div className={`${muted} font-bold text-xs`}>{t('dashboard.versionUpdate')}</div>
      <div className="flex items-center justify-between gap-2">
        <div className={`${title} text-lg`}>v{snapshot.version}</div>
        <span className="shrink-0 rounded-full bg-success/12 px-2 py-1 font-bold text-success text-xs">
          {t('dashboard.latest')}
        </span>
      </div>
      {lastRefresh ? (
        <div className="truncate text-muted-foreground text-xs">
          {t('shell.lastRefresh', { time: formatDateTime(lastRefresh, locale) })}
        </div>
      ) : null}
    </section>
  )
}

function ConnectionWaves({ connected }: { connected: boolean }): ReactElement {
  const tone = connected ? 'bg-success' : 'bg-warning'
  return (
    <div className="flex h-5 w-8 shrink-0 items-end gap-1" aria-hidden>
      {[0, 1, 2].map((index) => (
        <span
          className={`w-1.5 rounded-full ${tone} opacity-70 motion-safe:animate-pulse`}
          key={index}
          style={{
            animationDelay: `${index * 160}ms`,
            height: `${8 + index * 4}px`
          }}
        />
      ))}
    </div>
  )
}
