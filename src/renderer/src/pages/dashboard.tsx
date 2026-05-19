import { PageHeader } from '@renderer/components/app-shell/page-header'
import { Button } from '@renderer/components/ui/button'
import { PlayIcon, RefreshCwIcon, RotateCcwIcon, SquareIcon, UploadIcon } from 'lucide-react'
import { type ReactElement, useMemo, useState } from 'react'
import { ActiveAccountPanel } from './dashboard-inspector'
import { AccountPoolPanel, ProxyControlPanel, RecentActivityPanel } from './dashboard-main'
import { type ActivityFilter, useActivityRows } from './dashboard-model'
import { DirectoryPanel, ServicePanel, VersionPanel } from './dashboard-sidebar'
import type { PageProps } from './types'

export function DashboardPage(props: PageProps): ReactElement {
  const { actions, busyAction, hasMoreActivity, lastRefresh, locale, snapshot, t, usageProgress } =
    props
  const active = snapshot.accounts.find((account) => account.active === 1) ?? snapshot.accounts[0]
  const activityRows = useActivityRows(props)
  const [filter, setFilter] = useState<ActivityFilter>('all')
  const visibleRows = useMemo(
    () => activityRows.filter((row) => filter === 'all' || row.kind === filter),
    [activityRows, filter]
  )
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 px-6 py-1">
        <PageHeader
          actions={
            <>
              <Button
                loading={busyAction === 'refresh'}
                onClick={actions.refresh}
                variant="outline"
              >
                <RefreshCwIcon data-icon="inline-start" />
                {t('shell.refresh')}
              </Button>
              <Button
                loading={busyAction === 'restart'}
                onClick={actions.restartProxy}
                variant="outline"
              >
                <RotateCcwIcon data-icon="inline-start" />
                {t('action.restart')}
              </Button>
              {snapshot.status.running ? (
                <Button
                  loading={busyAction === 'stop'}
                  onClick={actions.stopProxy}
                  variant="destructive-outline"
                >
                  <SquareIcon data-icon="inline-start" />
                  {t('action.stop')}
                </Button>
              ) : (
                <Button loading={busyAction === 'start'} onClick={actions.startProxy}>
                  <PlayIcon data-icon="inline-start" />
                  {t('action.start')}
                </Button>
              )}
              <Button loading={busyAction === 'import'} onClick={actions.importAuthFiles}>
                <UploadIcon data-icon="inline-start" />
                {t('action.import')}
              </Button>
            </>
          }
          description={t('dashboard.desc')}
          title={t('dashboard.title')}
        />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[clamp(274px,18.8vw,340px)_minmax(0,1fr)_clamp(250px,16.8vw,320px)] gap-0 overflow-hidden">
        <aside className="flex min-h-0 min-w-0 flex-col gap-3 overflow-hidden bg-background pt-0 pr-0.5 pb-3 pl-3 min-[1400px]:pr-1 min-[1400px]:pl-4 min-[1400px]:pb-5">
          <ServicePanel snapshot={snapshot} t={t} />
          <DirectoryPanel actions={actions} t={t} />
          <VersionPanel lastRefresh={lastRefresh} locale={locale} snapshot={snapshot} t={t} />
        </aside>

        <section className="flex min-h-0 min-w-0 flex-col gap-3 overflow-hidden px-1 pb-3 min-[1400px]:gap-4 min-[1400px]:px-1.5 min-[1400px]:pb-6">
          <section className="grid h-[236px] shrink-0 grid-cols-[minmax(0,1.12fr)_minmax(260px,0.88fr)] gap-3 min-[1400px]:h-[288px] min-[1400px]:gap-4">
            <ProxyControlPanel locale={locale} snapshot={snapshot} t={t} />
            <AccountPoolPanel snapshot={snapshot} t={t} />
          </section>
          <RecentActivityPanel
            actions={actions}
            filter={filter}
            hasMoreActivity={hasMoreActivity}
            rows={visibleRows}
            setFilter={setFilter}
            t={t}
          />
        </section>

        <aside className="flex min-h-0 min-w-0 flex-col gap-3 overflow-hidden bg-background pt-0 pr-3 pb-3 pl-0.5 min-[1400px]:pr-4 min-[1400px]:pl-1 min-[1400px]:pb-6">
          <ActiveAccountPanel
            active={active}
            actions={actions}
            busyAction={busyAction}
            locale={locale}
            t={t}
            usageProgress={usageProgress}
          />
        </aside>
      </div>
    </div>
  )
}
