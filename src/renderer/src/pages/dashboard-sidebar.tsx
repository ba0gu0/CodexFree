import { Button } from '@renderer/components/ui/button'
import { ActiveProxyCard } from '@renderer/components/vectormotion/codexfree-cards'
import { formatBytes, formatDateTime } from '@renderer/data/format'
import { DownloadIcon, ExternalLinkIcon, RefreshCwIcon, RocketIcon } from 'lucide-react'
import type { ReactElement } from 'react'
import { type ActivityRow, rowTone, typeLabel } from './dashboard-model'
import type { PageProps } from './types'

const panel = 'rounded-xl border border-border/70 bg-card p-3 shadow-sm'
const muted = 'text-muted-foreground'
const title = 'font-extrabold text-foreground'

export function ServicePanel({
  locale,
  snapshot,
  t
}: Pick<PageProps, 'locale' | 'snapshot' | 't'>): ReactElement {
  return (
    <ActiveProxyCard
      className="h-[238px] shrink-0 min-[1400px]:h-[292px]"
      locale={locale}
      snapshot={snapshot}
      t={t}
    />
  )
}

export function DirectoryPanel({ actions, t }: Pick<PageProps, 'actions' | 't'>): ReactElement {
  const rows = [
    [
      'dashboard.authDirectory',
      actions.openManagedAuthDirectory,
      'bg-info/10 text-info hover:bg-info/15'
    ],
    [
      'dashboard.captureDirectory',
      actions.openRawCaptureDirectory,
      'bg-warning/10 text-warning hover:bg-warning/15'
    ],
    [
      'dashboard.workDirectory',
      actions.openWorkDirectory,
      'bg-success/10 text-success hover:bg-success/15'
    ]
  ] as const
  return (
    <section className={`${panel} flex min-h-[136px] flex-1 flex-col overflow-hidden p-3`}>
      <div className={`${muted} shrink-0 font-bold text-[11px]`}>{t('dashboard.directories')}</div>
      <div className="grid content-start gap-2 pt-2">
        {rows.map(([key, action, className]) => (
          <Button
            className={`h-10 justify-between rounded-lg border-0 px-3 font-extrabold text-sm ${className}`}
            key={key}
            onClick={action}
            size="sm"
            variant="ghost"
          >
            <span className="min-w-0 truncate">{t(key)}</span>
            <span className="shrink-0 rounded-md bg-background/70 px-2 py-0.5 font-bold text-[11px]">
              {t('dashboard.open')}
            </span>
          </Button>
        ))}
      </div>
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
  actions,
  busyAction,
  lastRefresh,
  locale,
  snapshot,
  t
}: Pick<
  PageProps,
  'actions' | 'busyAction' | 'lastRefresh' | 'locale' | 'snapshot' | 't'
>): ReactElement {
  const update = snapshot.updateStatus
  const available = update.availableUpdate
  const downloaded = update.downloadedUpdate
  const primaryAction = updatePrimaryAction(update)
  return (
    <section
      className={`${panel} mt-auto flex min-h-[132px] shrink-0 flex-col justify-center gap-1.5 p-3 min-[1400px]:min-h-[152px] min-[1400px]:gap-2`}
    >
      <div className={`${muted} font-bold text-xs`}>{t('dashboard.versionUpdate')}</div>
      <div className="flex items-center justify-between gap-2">
        <div className={`${title} text-lg`}>v{snapshot.version}</div>
        <span
          className={`shrink-0 rounded-full px-2 py-1 font-bold text-xs ${updateBadgeTone(update.state)}`}
        >
          {t(updateStateLabel(update.state))}
        </span>
      </div>
      <div className="min-h-4 truncate font-semibold text-muted-foreground text-xs">
        {downloaded
          ? t('dashboard.updateDownloadedVersion', { version: downloaded.version })
          : available
            ? t('dashboard.updateAvailableVersion', {
                size: formatBytes(available.size, locale),
                version: available.version
              })
            : update.errorMessage ||
              t(
                update.mode === 'manual-download'
                  ? 'dashboard.updateManualMac'
                  : 'dashboard.autoUpdate'
              )}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <Button
          className="min-w-0"
          disabled={!update.canCheck && primaryAction === 'check'}
          loading={busyAction === 'updateCheck' || update.state === 'checking'}
          onClick={actions.checkForUpdate}
          size="xs"
          variant="outline"
        >
          <RefreshCwIcon data-icon="inline-start" />
          {t('action.checkUpdate')}
        </Button>
        {primaryAction === 'release' ? (
          <Button
            loading={busyAction === 'openRelease'}
            onClick={actions.openReleasePage}
            size="xs"
            variant="secondary"
          >
            <ExternalLinkIcon data-icon="inline-start" />
            {t('action.openRelease')}
          </Button>
        ) : null}
        {primaryAction === 'download' ? (
          <Button
            loading={busyAction === 'updateDownload' || update.state === 'downloading'}
            onClick={actions.downloadUpdate}
            size="xs"
            variant="secondary"
          >
            <DownloadIcon data-icon="inline-start" />
            {update.progressPercent !== null
              ? `${Math.round(update.progressPercent)}%`
              : t('action.downloadUpdate')}
          </Button>
        ) : null}
        {primaryAction === 'apply' ? (
          <Button loading={busyAction === 'updateApply'} onClick={actions.applyUpdate} size="xs">
            <RocketIcon data-icon="inline-start" />
            {t('action.installUpdate')}
          </Button>
        ) : null}
      </div>
      {lastRefresh ? (
        <div className="truncate text-muted-foreground text-xs">
          {t('shell.lastRefresh', { time: formatDateTime(lastRefresh, locale) })}
        </div>
      ) : null}
    </section>
  )
}

function updatePrimaryAction(
  update: PageProps['snapshot']['updateStatus']
): 'apply' | 'download' | 'release' | 'check' {
  if (update.canApply) {
    return 'apply'
  }
  if (update.mode === 'manual-download' && update.availableUpdate) {
    return 'release'
  }
  return update.canDownload ? 'download' : 'check'
}

function updateStateLabel(
  state: PageProps['snapshot']['updateStatus']['state']
): Parameters<PageProps['t']>[0] {
  switch (state) {
    case 'available':
      return 'dashboard.updateAvailable'
    case 'checking':
      return 'dashboard.updateChecking'
    case 'downloaded':
      return 'dashboard.updateReady'
    case 'downloading':
      return 'dashboard.updateDownloading'
    case 'error':
      return 'dashboard.updateError'
    case 'unsupported':
      return 'dashboard.updateUnsupported'
    default:
      return 'dashboard.latest'
  }
}

function updateBadgeTone(state: PageProps['snapshot']['updateStatus']['state']): string {
  switch (state) {
    case 'available':
    case 'downloaded':
      return 'bg-info/12 text-info'
    case 'downloading':
    case 'checking':
      return 'bg-warning/12 text-warning'
    case 'error':
    case 'unsupported':
      return 'bg-destructive/12 text-destructive-foreground'
    default:
      return 'bg-success/12 text-success'
  }
}
