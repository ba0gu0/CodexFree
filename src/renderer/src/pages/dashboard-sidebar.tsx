import { Button } from '@renderer/components/ui/button'
import { formatDateTime } from '@renderer/data/format'
import { motion } from 'motion/react'
import type { ReactElement } from 'react'
import { type ActivityRow, rowTone, typeLabel } from './dashboard-model'
import type { PageProps } from './types'

const panel = 'rounded-xl border border-border/70 bg-card p-3 shadow-sm'
const muted = 'text-muted-foreground'
const title = 'font-extrabold text-foreground'

export function ServicePanel({ snapshot, t }: Pick<PageProps, 'snapshot' | 't'>): ReactElement {
  const connected = snapshot.status.running
  return (
    <section className={`${panel} flex h-[168px] shrink-0 flex-col gap-2 min-[1400px]:h-[188px]`}>
      <div className={`${muted} font-bold text-xs`}>{t('dashboard.service')}</div>
      <div className="min-w-0">
        <div
          className={`truncate font-extrabold text-xl min-[1400px]:text-2xl ${
            connected ? 'text-success' : 'text-warning'
          }`}
        >
          {connected ? t('dashboard.daemonConnected') : t('dashboard.daemonDisconnected')}
        </div>
        <div className="font-bold text-foreground text-xs">
          {t('dashboard.daemonHistoryRequests', { requests: snapshot.requestSummary.total })}
        </div>
      </div>
      <ConnectionWaves connected={connected} />
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
    <section
      className={`${panel} flex min-h-[196px] flex-1 flex-col gap-3 min-[1400px]:min-h-[216px]`}
    >
      <div className={`${muted} font-bold text-xs`}>{t('dashboard.directories')}</div>
      {rows.map(([key, action, className]) => (
        <Button
          className={`h-11 justify-between border-0 px-3 font-extrabold text-sm min-[1400px]:h-12 ${className}`}
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
      className={`${panel} mt-auto flex h-[132px] shrink-0 flex-col justify-center gap-2 min-[1400px]:h-[146px]`}
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
  const primary = connected ? '#0b7cff' : '#f59e0b'
  const secondary = connected ? '#ffb199' : '#f97316'
  return (
    <div
      className="relative mt-auto min-h-0 flex-1 overflow-hidden rounded-lg border bg-muted/25 shadow-inner"
      aria-hidden
    >
      <svg className="size-full" viewBox="0 0 154 72" role="img">
        <title>{connected ? 'connected network waveform' : 'disconnected network waveform'}</title>
        <path d="M0 20H154" stroke="currentColor" className="text-border/80" />
        <path d="M0 44H154" stroke="currentColor" className="text-border/80" />
        <motion.path
          animate={{
            pathLength: [0.68, 1, 0.78],
            pathOffset: [0, 0.08, 0.16],
            y: connected ? [0, -4, 2, 0] : [5, 2, 7, 5]
          }}
          d="M-8 47 C3 12 18 10 30 35 S52 31 63 30 75 45 83 23 99 50 110 50 119 22 132 35 142 19 160 31"
          fill="none"
          initial={false}
          stroke={primary}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
          transition={{
            duration: connected ? 2.6 : 3.4,
            ease: 'easeInOut',
            repeat: Number.POSITIVE_INFINITY
          }}
        />
        <motion.path
          animate={{
            pathLength: [0.58, 0.92, 0.7],
            pathOffset: [0.12, 0.02, 0.18],
            y: connected ? [3, 0, -3, 3] : [8, 5, 9, 8]
          }}
          d="M-6 55 C2 47 5 64 14 42 S27 62 36 39 50 68 63 31 76 21 86 30 98 25 109 25 121 19 132 22 143 20 153 22 160 62"
          fill="none"
          initial={false}
          opacity={connected ? 0.9 : 0.58}
          stroke={secondary}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
          transition={{
            duration: connected ? 3.1 : 4,
            ease: 'easeInOut',
            repeat: Number.POSITIVE_INFINITY
          }}
        />
      </svg>
    </div>
  )
}
