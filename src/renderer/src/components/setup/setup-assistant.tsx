import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Progress } from '@renderer/components/ui/progress'
import {
  Sheet,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle
} from '@renderer/components/ui/sheet'
import { type SetupSectionKey, setupPercent, setupSections } from '@renderer/data/setup-assistant'
import type { CopyKey, Locale } from '@renderer/i18n/copy'
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  KeyRoundIcon,
  RefreshCwIcon,
  ShieldAlertIcon
} from 'lucide-react'
import type { ReactElement } from 'react'
import { useMemo, useState } from 'react'
import type { SetupAssistantState } from '../../data/proxy-console'
import { AssistantActions, WizardStepActions } from './setup-action-buttons'

export interface SetupAssistantActions {
  checkUsage: () => Promise<void>
  importAuthFiles: () => Promise<void>
  markOnboardingComplete: () => void
  openCodexDirectory: () => Promise<void>
  openRawCaptureDirectory: () => Promise<void>
  openWorkDirectory: () => Promise<void>
  refresh: () => Promise<void>
  renameCodexAuth: () => Promise<void>
  restartProxy: () => Promise<void>
  startProxy: () => Promise<void>
  writeCodexConfig: () => Promise<void>
}

export interface SetupAssistantProps {
  actions: SetupAssistantActions
  busyAction: string | null
  locale: Locale
  onOpenChange: (open: boolean) => void
  onWizardOpenChange: (open: boolean) => void
  open: boolean
  state: SetupAssistantState | null
  t: (key: CopyKey, values?: Record<string, string | number>) => string
  wizardOpen: boolean
}

const wizardSteps = ['intro', 'proxy', 'config', 'auth', 'accounts', 'finish'] as const
export type WizardStep = (typeof wizardSteps)[number]

export function SetupAssistant({
  actions,
  busyAction,
  locale,
  onOpenChange,
  onWizardOpenChange,
  open,
  state,
  t,
  wizardOpen
}: SetupAssistantProps): ReactElement {
  const [confirmRenameOpen, setConfirmRenameOpen] = useState(false)
  const [step, setStep] = useState<WizardStep>('intro')
  const sections = useMemo(() => (state ? setupSections(state, t, locale) : []), [locale, state, t])
  const openWizardAt = (next: WizardStep): void => {
    setStep(next)
    onWizardOpenChange(true)
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetPopup className="max-w-lg">
          <SheetHeader>
            <SheetTitle>{t('setup.title')}</SheetTitle>
            <SheetDescription>{t('setup.desc')}</SheetDescription>
          </SheetHeader>
          <SheetPanel className="grid gap-3">
            {state ? (
              <>
                <SetupProgress percent={setupPercent(state)} ready={state.ready} t={t} />
                <div className="grid gap-2">
                  {sections.map(({ key, ...section }) => (
                    <StatusRow
                      key={key}
                      onResolve={() => openWizardAt(stepForSection(key))}
                      sectionKey={key}
                      t={t}
                      {...section}
                    />
                  ))}
                </div>
                <AssistantActions
                  actions={actions}
                  busyAction={busyAction}
                  onConfirmRename={() => setConfirmRenameOpen(true)}
                  state={state}
                  t={t}
                />
                <WorkMode t={t} />
              </>
            ) : (
              <div className="rounded-lg border bg-background p-4 text-sm text-muted-foreground">
                {t('setup.loading')}
              </div>
            )}
          </SheetPanel>
          <SheetFooter>
            <Button onClick={() => openWizardAt('intro')} variant="outline">
              {t('setup.openWizard')}
            </Button>
            <Button loading={busyAction === 'setupRefresh'} onClick={actions.refresh}>
              <RefreshCwIcon data-icon="inline-start" />
              {t('shell.refresh')}
            </Button>
          </SheetFooter>
        </SheetPopup>
      </Sheet>

      <Dialog open={wizardOpen} onOpenChange={onWizardOpenChange}>
        <DialogPopup className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t(`setup.wizard.${step}.title` as CopyKey)}</DialogTitle>
            <DialogDescription>{t(`setup.wizard.${step}.desc` as CopyKey)}</DialogDescription>
          </DialogHeader>
          <DialogPanel className="grid gap-3">
            {state ? (
              <WizardBody
                actions={actions}
                busyAction={busyAction}
                locale={locale}
                onConfirmRename={() => setConfirmRenameOpen(true)}
                state={state}
                step={step}
                t={t}
              />
            ) : null}
          </DialogPanel>
          <DialogFooter>
            <Button
              onClick={() => {
                if (step === 'intro') {
                  onOpenChange(true)
                  onWizardOpenChange(false)
                  return
                }
                setStep(previousStep(step))
              }}
              variant="outline"
            >
              {step === 'intro' ? t('setup.enterCheck') : t('setup.previous')}
            </Button>
            <Button
              disabled={step === 'accounts' && !canLeaveAccountsStep(state)}
              onClick={() => {
                if (step === 'finish') {
                  actions.markOnboardingComplete()
                  onWizardOpenChange(false)
                  return
                }
                setStep(nextStep(step))
              }}
            >
              {step === 'intro'
                ? t('setup.startConfig')
                : step === 'finish'
                  ? t('setup.finish')
                  : t('setup.next')}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <Dialog open={confirmRenameOpen} onOpenChange={setConfirmRenameOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>{t('setup.renameAuthTitle')}</DialogTitle>
            <DialogDescription>
              {t('setup.renameAuthDesc', {
                file: state?.auth.backupFileName ?? 'auth.backup.json'
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setConfirmRenameOpen(false)} variant="outline">
              {t('action.cancel')}
            </Button>
            <Button
              disabled={!state?.auth.exists}
              loading={busyAction === 'setupRenameAuth'}
              onClick={() => {
                setConfirmRenameOpen(false)
                void actions.renameCodexAuth()
              }}
              variant="destructive-outline"
            >
              <KeyRoundIcon data-icon="inline-start" />
              {t('setup.renameAuth')}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  )
}

function SetupProgress({
  percent,
  ready,
  t
}: {
  percent: number
  ready: boolean
  t: SetupAssistantProps['t']
}): ReactElement {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-semibold">{ready ? t('setup.ready') : t('setup.notReady')}</span>
        <Badge variant={ready ? 'success' : 'warning'}>{percent}%</Badge>
      </div>
      <Progress className="mt-3" value={percent} />
    </div>
  )
}

function StatusRow({
  detail,
  label,
  onResolve,
  sectionKey,
  t,
  tone,
  value
}: {
  detail: string
  label: string
  onResolve?: () => void
  sectionKey?: SetupSectionKey
  t?: SetupAssistantProps['t']
  tone: 'success' | 'warning' | 'error'
  value: string
}): ReactElement {
  const Icon = tone === 'success' ? CheckCircle2Icon : CircleAlertIcon
  const statusAction =
    tone !== 'success' && onResolve && t ? (
      <Button aria-label={`${label} ${value}`} onClick={onResolve} size="xs" variant="outline">
        {t('setup.fixInGuide')}
      </Button>
    ) : (
      <Badge variant={tone === 'success' ? 'success' : tone === 'error' ? 'error' : 'warning'}>
        {value}
      </Badge>
    )
  return (
    <div className="grid gap-1 rounded-lg border bg-background p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className={tone === 'success' ? 'text-success' : 'text-warning'} />
          <span className="truncate font-medium text-sm">{label}</span>
        </div>
        {statusAction}
      </div>
      <div className="truncate text-muted-foreground text-xs" data-section={sectionKey}>
        {detail}
      </div>
    </div>
  )
}

function WizardBody({
  actions,
  busyAction,
  locale,
  onConfirmRename,
  state,
  step,
  t
}: {
  actions: SetupAssistantActions
  busyAction: string | null
  locale: Locale
  onConfirmRename: () => void
  state: SetupAssistantState
  step: WizardStep
  t: SetupAssistantProps['t']
}): ReactElement {
  if (step === 'intro') {
    return <WorkMode t={t} />
  }
  if (step === 'finish') {
    return <FinishPanel locale={locale} state={state} t={t} />
  }
  const section = setupSections(state, t, locale).find((item) => item.key === stepKey(step))
  return (
    <div className="grid gap-3">
      {section ? <StatusRow {...section} /> : null}
      {step === 'config' ? <ConfigPreview state={state} t={t} /> : null}
      {step === 'accounts' ? <AccountsGate state={state} t={t} /> : null}
      <WizardStepActions
        actions={actions}
        busyAction={busyAction}
        onConfirmRename={onConfirmRename}
        state={state}
        step={step}
        t={t}
      />
    </div>
  )
}

function WorkMode({ t }: { t: SetupAssistantProps['t'] }): ReactElement {
  return (
    <div className="grid gap-2 rounded-lg border border-warning/35 bg-warning/5 p-3 text-sm">
      <div className="flex items-center gap-2 font-semibold">
        <ShieldAlertIcon className="text-warning" />
        {t('setup.workModeTitle')}
      </div>
      <p className="text-muted-foreground">{t('setup.workModeClient')}</p>
      <p className="text-muted-foreground">{t('setup.workModeProxy')}</p>
      <p className="text-muted-foreground">{t('setup.workModePool')}</p>
      <p className="text-muted-foreground">{t('setup.workModeApiKey')}</p>
      <p className="text-muted-foreground">{t('setup.workModeAuthJson')}</p>
      <p className="text-muted-foreground">{t('setup.workModeConfig')}</p>
    </div>
  )
}

function FinishPanel({
  state,
  locale,
  t
}: {
  locale: Locale
  state: SetupAssistantState
  t: SetupAssistantProps['t']
}): ReactElement {
  return (
    <div className="grid gap-2 rounded-lg border bg-background p-3 text-sm">
      <div className="font-semibold">{state.ready ? t('setup.ready') : t('setup.notReady')}</div>
      {setupSections(state, t, locale).map((section) => (
        <div className="flex justify-between gap-3" key={section.key}>
          <span className="text-muted-foreground">{section.label}</span>
          <span>{section.value}</span>
        </div>
      ))}
      <div className="flex justify-between gap-3">
        <span className="text-muted-foreground">{t('dashboard.availableModels')}</span>
        <span>{state.availableModelCount ?? '-'}</span>
      </div>
    </div>
  )
}

function ConfigPreview({
  state,
  t
}: {
  state: SetupAssistantState
  t: SetupAssistantProps['t']
}): ReactElement {
  return (
    <div className="grid gap-2 rounded-lg border bg-muted/25 p-3 text-xs">
      <div className="font-semibold text-foreground">{t('setup.targetConfig')}</div>
      <code className="grid gap-1 rounded-md bg-background p-2 text-muted-foreground">
        <span>{`chatgpt_base_url = "${state.target.chatgptBaseUrl}"`}</span>
        <span>{`openai_base_url = "${state.target.openaiBaseUrl}"`}</span>
      </code>
    </div>
  )
}

function AccountsGate({
  state,
  t
}: {
  state: SetupAssistantState
  t: SetupAssistantProps['t']
}): ReactElement {
  const message = canLeaveAccountsStep(state)
    ? t('setup.accountsUsageChecked')
    : t('setup.accountsUsageRequired')
  const className = 'rounded-lg border bg-muted/25 p-3 text-muted-foreground text-xs'
  return <div className={className}>{message}</div>
}

function stepKey(step: WizardStep): 'daemon' | 'config' | 'auth' | 'accounts' {
  if (step === 'proxy') {
    return 'daemon'
  }
  if (step === 'config') {
    return 'config'
  }
  if (step === 'auth') {
    return 'auth'
  }
  return 'accounts'
}

function stepForSection(section: SetupSectionKey): WizardStep {
  if (section === 'daemon') {
    return 'proxy'
  }
  if (section === 'config') {
    return 'config'
  }
  if (section === 'auth') {
    return 'auth'
  }
  if (section === 'accounts') {
    return 'accounts'
  }
  return 'finish'
}

function nextStep(step: WizardStep): WizardStep {
  return wizardSteps[Math.min(wizardSteps.indexOf(step) + 1, wizardSteps.length - 1)]
}

function previousStep(step: WizardStep): WizardStep {
  return wizardSteps[Math.max(wizardSteps.indexOf(step) - 1, 0)]
}

function canLeaveAccountsStep(state: SetupAssistantState | null): boolean {
  return Boolean(
    state &&
      state.accounts.available > 0 &&
      state.accounts.usageCheckedAvailable >= state.accounts.available
  )
}
