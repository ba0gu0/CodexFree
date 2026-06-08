import { MetricCard } from '@renderer/components/app-shell/metric-card'
import { PageHeader } from '@renderer/components/app-shell/page-header'
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle
} from '@renderer/components/ui/alert-dialog'
import { Button } from '@renderer/components/ui/button'
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle
} from '@renderer/components/ui/card'
import { Field, FieldDescription, FieldLabel } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Switch } from '@renderer/components/ui/switch'
import { formatBytes } from '@renderer/data/format'
import { type OutboundMode, outboundModes, type ProxyConfig } from '@renderer/data/proxy-console'
import {
  FilePenLineIcon,
  PlayIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SaveIcon,
  SquareIcon
} from 'lucide-react'
import { type ReactElement, useEffect, useState } from 'react'
import type { PageProps } from './types'

interface DaemonDraft {
  adminHost: string
  adminPort: number
  adminToken: string
  launchAgentEnabled: boolean
}

export function ProxyPage({ actions, busyAction, locale, snapshot, t }: PageProps): ReactElement {
  const [draft, setDraft] = useState<ProxyConfig>(snapshot.config)
  const [daemonDraft, setDaemonDraft] = useState<DaemonDraft>({
    adminHost: snapshot.daemonControl.adminHost,
    adminPort: snapshot.daemonControl.adminPort,
    adminToken: '',
    launchAgentEnabled: snapshot.daemonControl.launchAgent.enabled
  })
  const [confirmLaunchAgentOpen, setConfirmLaunchAgentOpen] = useState(false)
  const [confirmSessionProviderOpen, setConfirmSessionProviderOpen] = useState(false)

  useEffect(() => {
    setDraft(snapshot.config)
  }, [snapshot.config])
  useEffect(() => {
    setDaemonDraft({
      adminHost: snapshot.daemonControl.adminHost,
      adminPort: snapshot.daemonControl.adminPort,
      adminToken: '',
      launchAgentEnabled: snapshot.daemonControl.launchAgent.enabled
    })
  }, [snapshot.daemonControl])

  const modeItems = outboundModes.map((mode) => ({ label: t(`mode.${mode}`), value: mode }))
  const hasDraftChanges = proxyPageChanged(draft, daemonDraft, snapshot)
  const saveAll = async (): Promise<void> => {
    if (!hasDraftChanges) {
      return
    }
    await actions.saveProxyPageConfig(draft, daemonDraft)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      <PageHeader
        actions={
          <>
            <Button disabled={!hasDraftChanges} loading={busyAction === 'save'} onClick={saveAll}>
              <SaveIcon data-icon="inline-start" />
              {hasDraftChanges ? t('action.configChangedSaveRestart') : t('action.saveAndRestart')}
            </Button>
            <Button loading={busyAction === 'refresh'} onClick={actions.refresh} variant="outline">
              <RefreshCwIcon data-icon="inline-start" />
              {t('shell.refresh')}
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
            <Button
              loading={busyAction === 'restart'}
              onClick={actions.restartProxy}
              variant="outline"
            >
              <RotateCcwIcon data-icon="inline-start" />
              {t('action.restart')}
            </Button>
          </>
        }
        description={t('proxy.desc')}
        title={t('proxy.title')}
      />

      <section className="grid h-[76px] shrink-0 grid-cols-4 gap-3">
        <MetricCard
          density="compact"
          label={t('metric.proxy')}
          tone={snapshot.status.running ? 'success' : 'warning'}
          value={snapshot.status.running ? t('status.running') : t('status.stopped')}
        />
        <MetricCard
          density="compact"
          label={t('metric.totalAccounts')}
          tone={snapshot.status.authPoolAvailableAccounts > 0 ? 'success' : 'warning'}
          value={String(snapshot.status.authPoolAccounts)}
        />
        <MetricCard
          density="compact"
          label={t('proxy.outboundMode')}
          tone="warning"
          value={t(`mode.${snapshot.status.outboundMode}`)}
        />
        <MetricCard
          density="compact"
          label={t('proxy.rawCapture')}
          tone={snapshot.status.rawCaptureEnabled ? 'success' : 'default'}
          value={snapshot.status.rawCaptureEnabled ? t('status.enabled') : t('status.disabled')}
        />
      </section>

      <section className="grid min-h-0 items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="overflow-hidden rounded-xl shadow-none">
          <CardHeader className="p-3 pb-1.5">
            <CardTitle className="text-lg">{t('proxy.title')}</CardTitle>
            <CardDescription className="line-clamp-1">{t('proxy.desc')}</CardDescription>
          </CardHeader>
          <CardPanel className="grid min-h-0 content-start gap-2 overflow-hidden p-3 pt-0 md:grid-cols-2 [&_[data-slot=field]]:gap-1.5">
            <SwitchField
              checked={draft.rawCaptureEnabled}
              className="md:col-span-2"
              description={t('proxy.rawCaptureDesc')}
              label={t('proxy.rawCapture')}
              onChange={(rawCaptureEnabled) => setDraft({ ...draft, rawCaptureEnabled })}
            />
            <Field>
              <FieldLabel>{t('proxy.host')}</FieldLabel>
              <Input
                onChange={(event) => setDraft({ ...draft, listenHost: event.target.value })}
                value={draft.listenHost}
              />
            </Field>
            <Field>
              <FieldLabel>{t('proxy.port')}</FieldLabel>
              <Input
                min={1}
                nativeInput
                onChange={(event) => patchNumber(setDraft, draft, 'listenPort', event.target.value)}
                type="number"
                value={draft.listenPort}
              />
            </Field>
            <Field className="md:col-span-2">
              <FieldLabel>{t('proxy.upstream')}</FieldLabel>
              <Input
                onChange={(event) => setDraft({ ...draft, upstreamBaseUrl: event.target.value })}
                value={draft.upstreamBaseUrl}
              />
            </Field>
            <Field>
              <FieldLabel>{t('proxy.outboundMode')}</FieldLabel>
              <Select
                items={modeItems}
                onValueChange={(value) => {
                  if (isOutboundMode(value)) {
                    setDraft({
                      ...draft,
                      outboundProxy: { ...draft.outboundProxy, mode: value }
                    })
                  }
                }}
                value={draft.outboundProxy.mode}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  <SelectGroup>
                    {modeItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectPopup>
              </Select>
            </Field>
            <Field>
              <FieldLabel>{t('proxy.outboundUrl')}</FieldLabel>
              <Input
                disabled={draft.outboundProxy.mode === 'direct'}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    outboundProxy: { ...draft.outboundProxy, url: event.target.value }
                  })
                }
                value={draft.outboundProxy.url}
              />
            </Field>
            <Field>
              <FieldLabel>{t('proxy.maxBody')}</FieldLabel>
              <Input
                min={0}
                nativeInput
                onChange={(event) =>
                  patchNumber(setDraft, draft, 'maxRequestBodyBytes', event.target.value)
                }
                type="number"
                value={draft.maxRequestBodyBytes}
              />
              <FieldDescription>{formatBytes(draft.maxRequestBodyBytes, locale)}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>{t('proxy.rawCaptureBytes')}</FieldLabel>
              <Input
                min={0}
                nativeInput
                onChange={(event) =>
                  patchNumber(setDraft, draft, 'rawCaptureMaxBytes', event.target.value)
                }
                type="number"
                value={draft.rawCaptureMaxBytes}
              />
              <FieldDescription>{formatBytes(draft.rawCaptureMaxBytes, locale)}</FieldDescription>
            </Field>
          </CardPanel>
        </Card>

        <aside className="flex min-h-0 min-w-0 flex-col gap-3 overflow-hidden">
          <Card className="flex flex-col rounded-xl shadow-none">
            <CardHeader className="p-3 pb-1.5">
              <CardTitle className="text-lg">{t('proxy.daemonControl')}</CardTitle>
              <CardDescription className="line-clamp-1">
                {t('proxy.daemonControlDesc')}
              </CardDescription>
            </CardHeader>
            <CardPanel className="grid content-start gap-2 p-3 pt-0 md:grid-cols-2 [&_[data-slot=field]]:gap-1.5">
              <Field>
                <FieldLabel>{t('proxy.adminHost')}</FieldLabel>
                <Input
                  onChange={(event) =>
                    setDaemonDraft({ ...daemonDraft, adminHost: event.target.value })
                  }
                  value={daemonDraft.adminHost}
                />
              </Field>
              <Field>
                <FieldLabel>{t('proxy.adminPort')}</FieldLabel>
                <Input
                  min={1}
                  nativeInput
                  onChange={(event) =>
                    setDaemonDraft({
                      ...daemonDraft,
                      adminPort: Number.parseInt(event.target.value, 10)
                    })
                  }
                  type="number"
                  value={daemonDraft.adminPort}
                />
              </Field>
              <Field className="md:col-span-2">
                <FieldLabel>{t('proxy.adminToken')}</FieldLabel>
                <Input
                  onChange={(event) =>
                    setDaemonDraft({ ...daemonDraft, adminToken: event.target.value })
                  }
                  placeholder={t('proxy.adminTokenDesc')}
                  type="password"
                  value={daemonDraft.adminToken}
                />
              </Field>
              <SwitchField
                checked={daemonDraft.launchAgentEnabled}
                className="md:col-span-2"
                description={
                  snapshot.daemonControl.launchAgent.supported
                    ? launchAgentDescription(snapshot.daemonControl.launchAgent, t)
                    : t('proxy.launchAgentUnsupported')
                }
                disabled={!snapshot.daemonControl.launchAgent.supported}
                label={t('proxy.launchAgent')}
                onChange={(launchAgentEnabled) => {
                  if (launchAgentEnabled && !daemonDraft.launchAgentEnabled) {
                    setConfirmLaunchAgentOpen(true)
                    return
                  }
                  setDaemonDraft({ ...daemonDraft, launchAgentEnabled })
                }}
              />
              <ConfigRepairPanel
                actions={actions}
                busyAction={busyAction}
                checked={draft.codexConfigMonitorEnabled}
                onChange={(codexConfigMonitorEnabled) =>
                  setDraft({ ...draft, codexConfigMonitorEnabled })
                }
                onRepairSessionProvider={() => setConfirmSessionProviderOpen(true)}
                t={t}
              />
            </CardPanel>
          </Card>
        </aside>
      </section>
      <AlertDialog open={confirmLaunchAgentOpen} onOpenChange={setConfirmLaunchAgentOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('proxy.launchAgentConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('proxy.launchAgentConfirmDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {t('action.cancel')}
            </AlertDialogClose>
            <AlertDialogClose
              render={
                <Button
                  onClick={() =>
                    setDaemonDraft({
                      ...daemonDraft,
                      launchAgentEnabled: true
                    })
                  }
                />
              }
            >
              {t('action.enable')}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
      <AlertDialog open={confirmSessionProviderOpen} onOpenChange={setConfirmSessionProviderOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('proxy.sessionProviderConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('proxy.sessionProviderConfirmDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {t('action.cancel')}
            </AlertDialogClose>
            <AlertDialogClose
              render={
                <Button
                  loading={busyAction === 'sessionProviderRepair'}
                  onClick={() => {
                    void actions.repairCodexSessionProvider()
                  }}
                  variant="destructive-outline"
                />
              }
            >
              {t('proxy.sessionProviderRepair')}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  )
}

function ConfigRepairPanel({
  actions,
  busyAction,
  checked,
  onRepairSessionProvider,
  onChange,
  t
}: {
  actions: PageProps['actions']
  busyAction: PageProps['busyAction']
  checked: boolean
  onRepairSessionProvider: () => void
  onChange: (checked: boolean) => void
  t: PageProps['t']
}): ReactElement {
  return (
    <div className="grid gap-2 md:col-span-2">
      <SwitchField
        checked={checked}
        description={t('proxy.configMonitorDesc')}
        label={t('proxy.configMonitor')}
        onChange={onChange}
      />
      <div className="grid gap-2">
        <Field className="flex-row items-center justify-between gap-3 rounded-lg border bg-background p-2.5">
          <div className="min-w-0">
            <FieldLabel>{t('proxy.configToml')}</FieldLabel>
            <FieldDescription className="mt-1 line-clamp-1">
              {t('proxy.configTomlDesc')}
            </FieldDescription>
          </div>
          <Button
            className="shrink-0"
            loading={busyAction === 'config'}
            onClick={actions.writeCodexConfig}
            variant="outline"
          >
            <FilePenLineIcon data-icon="inline-start" />
            {t('proxy.configToml')}
          </Button>
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Button
            loading={busyAction === 'configSnapshot'}
            onClick={actions.snapshotCodexConfig}
            variant="outline"
          >
            <SaveIcon data-icon="inline-start" />
            {t('proxy.configSnapshot')}
          </Button>
          <Button
            loading={busyAction === 'configRestore'}
            onClick={actions.restoreCodexApiConfig}
            variant="outline"
          >
            <RotateCcwIcon data-icon="inline-start" />
            {t('proxy.configRestore')}
          </Button>
          <Button
            loading={busyAction === 'sessionProviderRepair'}
            onClick={onRepairSessionProvider}
            variant="outline"
          >
            <RefreshCwIcon data-icon="inline-start" />
            {t('proxy.sessionProviderRepair')}
          </Button>
        </div>
      </div>
    </div>
  )
}

function launchAgentDescription(
  launchAgent: PageProps['snapshot']['daemonControl']['launchAgent'],
  t: PageProps['t']
): string {
  return launchAgent.plistPath ?? launchAgent.label ?? t('status.enabled')
}

function proxyPageChanged(
  draft: ProxyConfig,
  daemonDraft: DaemonDraft,
  snapshot: PageProps['snapshot']
): boolean {
  const config = snapshot.config
  return (
    draft.listenHost !== config.listenHost ||
    draft.listenPort !== config.listenPort ||
    draft.upstreamBaseUrl !== config.upstreamBaseUrl ||
    draft.outboundProxy.mode !== config.outboundProxy.mode ||
    draft.outboundProxy.url !== config.outboundProxy.url ||
    draft.authPool.enabled !== config.authPool.enabled ||
    draft.authPool.directory !== config.authPool.directory ||
    draft.maxRequestBodyBytes !== config.maxRequestBodyBytes ||
    draft.rawCaptureEnabled !== config.rawCaptureEnabled ||
    draft.rawCaptureMaxBytes !== config.rawCaptureMaxBytes ||
    draft.codexConfigMonitorEnabled !== config.codexConfigMonitorEnabled ||
    daemonDraft.adminHost !== snapshot.daemonControl.adminHost ||
    daemonDraft.adminPort !== snapshot.daemonControl.adminPort ||
    daemonDraft.launchAgentEnabled !== snapshot.daemonControl.launchAgent.enabled ||
    daemonDraft.adminToken.trim().length > 0
  )
}

function SwitchField({
  checked,
  className,
  controlPosition = 'right',
  description,
  disabled = false,
  label,
  onChange
}: {
  checked: boolean
  className?: string
  controlPosition?: 'left' | 'right'
  description: string
  disabled?: boolean
  label: string
  onChange: (checked: boolean) => void
}): ReactElement {
  return (
    <Field className={`rounded-lg border bg-background p-2.5 ${className ?? ''}`}>
      <div
        className={`flex w-full items-center gap-3 ${
          controlPosition === 'left' ? 'justify-start' : 'justify-between'
        }`}
      >
        {controlPosition === 'left' ? (
          <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
        ) : null}
        <div className="flex min-w-0 flex-col gap-1">
          <FieldLabel>{label}</FieldLabel>
          <FieldDescription className="line-clamp-1 min-[1400px]:line-clamp-2">
            {description}
          </FieldDescription>
        </div>
        {controlPosition === 'right' ? (
          <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
        ) : null}
      </div>
    </Field>
  )
}

function isOutboundMode(value: unknown): value is OutboundMode {
  return typeof value === 'string' && outboundModes.includes(value as OutboundMode)
}

function patchNumber(
  setDraft: (value: ProxyConfig) => void,
  draft: ProxyConfig,
  key: 'listenPort' | 'maxRequestBodyBytes' | 'rawCaptureMaxBytes',
  value: string
): void {
  const next = Number.parseInt(value, 10)
  if (Number.isFinite(next)) {
    setDraft({ ...draft, [key]: next })
  }
}
