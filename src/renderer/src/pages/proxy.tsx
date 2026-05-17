import { MetricCard } from '@renderer/components/app-shell/metric-card'
import { PageHeader } from '@renderer/components/app-shell/page-header'
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
import { FilePenLineIcon, PlayIcon, RotateCcwIcon, SaveIcon, SquareIcon } from 'lucide-react'
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

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      <PageHeader
        actions={
          <>
            <Button loading={busyAction === 'save'} onClick={() => actions.saveConfig(draft)}>
              <SaveIcon data-icon="inline-start" />
              {t('action.save')}
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
            <Button
              loading={busyAction === 'config'}
              onClick={actions.writeCodexConfig}
              variant="outline"
            >
              <FilePenLineIcon data-icon="inline-start" />
              {t('proxy.configToml')}
            </Button>
          </>
        }
        description={t('proxy.desc')}
        title={t('proxy.title')}
      />

      <section className="grid shrink-0 grid-cols-4 gap-2">
        <MetricCard
          detail={snapshot.status.endpoint}
          label={t('metric.proxy')}
          tone={snapshot.status.running ? 'success' : 'warning'}
          value={snapshot.status.running ? t('status.running') : t('status.stopped')}
        />
        <MetricCard
          detail={`${snapshot.status.authPoolAvailableAccounts}/${snapshot.status.authPoolAccounts}`}
          label={t('dashboard.pool')}
          tone={snapshot.status.authPoolEnabled ? 'info' : 'warning'}
          value={snapshot.status.authPoolEnabled ? t('status.enabled') : t('status.disabled')}
        />
        <MetricCard
          detail={snapshot.status.upstreamBaseUrl}
          label={t('proxy.outboundMode')}
          value={t(`mode.${snapshot.status.outboundMode}`)}
        />
        <MetricCard
          detail={snapshot.status.rawCaptureDir}
          label={t('proxy.rawCapture')}
          tone={snapshot.status.rawCaptureEnabled ? 'success' : 'default'}
          value={snapshot.status.rawCaptureEnabled ? t('status.enabled') : t('status.disabled')}
        />
      </section>

      <section className="grid min-h-0 flex-1 gap-2.5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.55fr)]">
        <Card className="min-h-0 overflow-hidden rounded-xl shadow-none">
          <CardHeader className="p-4 pb-2">
            <CardTitle>{t('proxy.title')}</CardTitle>
            <CardDescription>{t('proxy.desc')}</CardDescription>
          </CardHeader>
          <CardPanel className="grid min-h-0 gap-2.5 overflow-y-auto p-4 pt-0 md:grid-cols-2">
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
              <FieldLabel>{t('proxy.authPool')}</FieldLabel>
              <FieldDescription>{snapshot.managedAuthDirectory}</FieldDescription>
            </Field>
            <SwitchField
              checked={draft.rawCaptureEnabled}
              description={formatBytes(draft.rawCaptureMaxBytes, locale)}
              label={t('proxy.rawCapture')}
              onChange={(rawCaptureEnabled) => setDraft({ ...draft, rawCaptureEnabled })}
            />
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

        <aside className="flex min-h-0 min-w-0 flex-col gap-2.5 overflow-hidden">
          <Card className="rounded-xl shadow-none">
            <CardHeader className="p-4 pb-2">
              <CardTitle>{t('proxy.daemonControl')}</CardTitle>
              <CardDescription>{t('proxy.daemonControlDesc')}</CardDescription>
            </CardHeader>
            <CardPanel className="grid gap-2.5 p-4 pt-0">
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
              <Field>
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
                description={
                  snapshot.daemonControl.launchAgent.supported
                    ? (snapshot.daemonControl.launchAgent.plistPath ?? t('status.enabled'))
                    : t('proxy.launchAgentUnsupported')
                }
                disabled={!snapshot.daemonControl.launchAgent.supported}
                label={t('proxy.launchAgent')}
                onChange={(launchAgentEnabled) =>
                  setDaemonDraft({ ...daemonDraft, launchAgentEnabled })
                }
              />
              <Button
                loading={busyAction === 'saveDaemonControl'}
                onClick={() => actions.saveDaemonControlSettings(daemonDraft)}
              >
                <SaveIcon data-icon="inline-start" />
                {t('action.save')}
              </Button>
            </CardPanel>
          </Card>
          <Card className="min-h-0 flex-1 rounded-xl shadow-none">
            <CardHeader className="p-4 pb-2">
              <CardTitle>{t('proxy.adminEndpoint')}</CardTitle>
            </CardHeader>
            <CardPanel className="grid gap-2 p-4 pt-0 text-sm">
              <InfoLine label={t('status.running')} value={snapshot.status.endpoint} />
              <InfoLine
                label={t('proxy.launchAgentPath')}
                value={snapshot.daemonControl.launchAgent.plistPath ?? '-'}
              />
            </CardPanel>
          </Card>
        </aside>
      </section>
    </div>
  )
}

function InfoLine({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="min-w-0 rounded-lg bg-muted/50 p-2.5">
      <div className="font-bold text-muted-foreground text-xs">{label}</div>
      <div className="mt-1 truncate font-mono text-foreground text-xs" title={value}>
        {value}
      </div>
    </div>
  )
}

function SwitchField({
  checked,
  description,
  disabled = false,
  label,
  onChange
}: {
  checked: boolean
  description: string
  disabled?: boolean
  label: string
  onChange: (checked: boolean) => void
}): ReactElement {
  return (
    <Field className="rounded-lg border bg-background p-2">
      <div className="flex w-full items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <FieldLabel>{label}</FieldLabel>
          <FieldDescription className="truncate">{description}</FieldDescription>
        </div>
        <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
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
