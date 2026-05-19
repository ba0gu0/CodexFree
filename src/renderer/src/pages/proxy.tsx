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

export function ProxyPage({ actions, busyAction, locale, snapshot, t }: PageProps): ReactElement {
  const [draft, setDraft] = useState<ProxyConfig>(snapshot.config)
  const [daemonDraft, setDaemonDraft] = useState({
    adminHost: snapshot.daemonControl.adminHost,
    adminPort: snapshot.daemonControl.adminPort,
    adminToken: '',
    launchAgentEnabled: snapshot.daemonControl.launchAgent.enabled
  })
  const [confirmLaunchAgentOpen, setConfirmLaunchAgentOpen] = useState(false)

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
  const saveAll = async (): Promise<void> => {
    await actions.saveProxyPageConfig(draft, daemonDraft)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      <PageHeader
        actions={
          <>
            <Button loading={busyAction === 'save'} onClick={saveAll}>
              <SaveIcon data-icon="inline-start" />
              {t('action.saveAndRestart')}
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

      <section className="grid h-[92px] shrink-0 grid-cols-4 gap-3">
        <MetricCard
          label={t('metric.proxy')}
          tone={snapshot.status.running ? 'success' : 'warning'}
          value={snapshot.status.running ? t('status.running') : t('status.stopped')}
        />
        <MetricCard
          label={t('metric.totalAccounts')}
          tone={snapshot.status.authPoolAvailableAccounts > 0 ? 'success' : 'warning'}
          value={String(snapshot.status.authPoolAccounts)}
        />
        <MetricCard
          label={t('proxy.outboundMode')}
          tone="warning"
          value={t(`mode.${snapshot.status.outboundMode}`)}
        />
        <MetricCard
          label={t('proxy.rawCapture')}
          tone={snapshot.status.rawCaptureEnabled ? 'success' : 'default'}
          value={snapshot.status.rawCaptureEnabled ? t('status.enabled') : t('status.disabled')}
        />
      </section>

      <section className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="min-h-0 overflow-hidden rounded-xl shadow-none">
          <CardHeader className="p-4 pb-2">
            <CardTitle>{t('proxy.title')}</CardTitle>
            <CardDescription>{t('proxy.desc')}</CardDescription>
          </CardHeader>
          <CardPanel className="grid min-h-0 gap-3 overflow-y-auto p-4 pt-0 md:grid-cols-2">
            <SwitchField
              checked={draft.rawCaptureEnabled}
              className="md:col-span-2"
              controlPosition="left"
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

        <aside className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto pr-1">
          <Card className="flex min-h-full flex-1 flex-col rounded-xl shadow-none">
            <CardHeader className="p-4 pb-2">
              <CardTitle>{t('proxy.daemonControl')}</CardTitle>
              <CardDescription>{t('proxy.daemonControlDesc')}</CardDescription>
            </CardHeader>
            <CardPanel className="grid flex-1 content-start gap-3 p-4 pt-0 md:grid-cols-2">
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
    </div>
  )
}

function ConfigRepairPanel({
  actions,
  busyAction,
  checked,
  onChange,
  t
}: {
  actions: PageProps['actions']
  busyAction: PageProps['busyAction']
  checked: boolean
  onChange: (checked: boolean) => void
  t: PageProps['t']
}): ReactElement {
  return (
    <div className="grid gap-3 md:col-span-2 md:grid-cols-[minmax(0,1fr)_220px]">
      <SwitchField
        checked={checked}
        className={`h-full ${checked ? 'md:col-span-2' : ''}`}
        controlPosition="left"
        description={t('proxy.configMonitorDesc')}
        label={t('proxy.configMonitor')}
        onChange={onChange}
      />
      {!checked ? (
        <Button
          className="h-full min-h-16"
          loading={busyAction === 'config'}
          onClick={actions.writeCodexConfig}
          variant="outline"
        >
          <FilePenLineIcon data-icon="inline-start" />
          {t('proxy.configToml')}
        </Button>
      ) : null}
    </div>
  )
}

function launchAgentDescription(
  launchAgent: PageProps['snapshot']['daemonControl']['launchAgent'],
  t: PageProps['t']
): string {
  return launchAgent.plistPath ?? launchAgent.label ?? t('status.enabled')
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
    <Field className={`rounded-lg border bg-background p-3 ${className ?? ''}`}>
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
          <FieldDescription className="line-clamp-2">{description}</FieldDescription>
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
