import { Button } from '@renderer/components/ui/button'
import type { CopyKey } from '@renderer/i18n/copy'
import {
  DatabaseIcon,
  FilePenLineIcon,
  FolderOpenIcon,
  KeyRoundIcon,
  PlayIcon,
  RotateCcwIcon,
  UploadIcon,
  UsersIcon
} from 'lucide-react'
import type { ReactElement } from 'react'
import type { SetupAssistantState, UsageProgress } from '../../data/proxy-console'
import type { SetupAssistantActions, WizardStep } from './setup-assistant'

interface SetupActionProps {
  actions: SetupAssistantActions
  busyAction: string | null
  onConfirmRename: () => void
  state: SetupAssistantState
  t: (key: CopyKey, values?: Record<string, string | number>) => string
  usageProgress: UsageProgress | null
}

export function AssistantActions({
  actions,
  busyAction,
  onConfirmRename,
  state,
  t,
  usageProgress
}: SetupActionProps): ReactElement {
  const usageLabel =
    busyAction === 'usage'
      ? (usageProgressText(usageProgress) ?? t('setup.checkAllUsage'))
      : t('setup.checkAllUsage')
  return (
    <div className="grid grid-cols-2 gap-2">
      <Button
        disabled={state.daemon.running}
        loading={busyAction === 'start'}
        onClick={actions.startProxy}
      >
        <PlayIcon data-icon="inline-start" />
        {t('action.start')}
      </Button>
      <Button loading={busyAction === 'restart'} onClick={actions.restartProxy} variant="outline">
        <RotateCcwIcon data-icon="inline-start" />
        {t('action.restart')}
      </Button>
      <Button
        loading={busyAction === 'config'}
        onClick={actions.writeCodexConfig}
        variant="outline"
      >
        <FilePenLineIcon data-icon="inline-start" />
        {t('setup.writeConfig')}
      </Button>
      <Button onClick={actions.openCodexDirectory} variant="outline">
        <FolderOpenIcon data-icon="inline-start" />
        {t('setup.openCodexDir')}
      </Button>
      <Button loading={busyAction === 'import'} onClick={actions.importAuthFiles} variant="outline">
        <UploadIcon data-icon="inline-start" />
        {t('action.importShort')}
      </Button>
      <Button disabled={busyAction === 'usage'} onClick={actions.checkUsage} variant="outline">
        <UsersIcon data-icon="inline-start" />
        {usageLabel}
      </Button>
      <Button onClick={actions.openRawCaptureDirectory} variant="outline">
        <DatabaseIcon data-icon="inline-start" />
        {t('dashboard.captureDirectory')}
      </Button>
      <Button onClick={actions.openWorkDirectory} variant="outline">
        <FolderOpenIcon data-icon="inline-start" />
        {t('dashboard.workDirectory')}
      </Button>
      <Button
        className="col-span-2"
        disabled={!state.auth.exists}
        onClick={onConfirmRename}
        variant="destructive-outline"
      >
        <KeyRoundIcon data-icon="inline-start" />
        {t('setup.renameAuth')}
      </Button>
    </div>
  )
}

export function WizardStepActions({
  actions,
  busyAction,
  state,
  step,
  t,
  usageProgress
}: Omit<SetupActionProps, 'onConfirmRename'> & { step: WizardStep }): ReactElement | null {
  if (step === 'proxy') {
    return (
      <div className="grid grid-cols-2 gap-2">
        <Button
          disabled={state.daemon.running}
          loading={busyAction === 'start'}
          onClick={actions.startProxy}
        >
          <PlayIcon data-icon="inline-start" />
          {t('action.start')}
        </Button>
        <Button loading={busyAction === 'restart'} onClick={actions.restartProxy} variant="outline">
          <RotateCcwIcon data-icon="inline-start" />
          {t('action.restart')}
        </Button>
      </div>
    )
  }
  if (step === 'config') {
    return (
      <div className="grid grid-cols-2 gap-2">
        <Button
          loading={busyAction === 'config'}
          onClick={actions.writeCodexConfig}
          variant="outline"
        >
          <FilePenLineIcon data-icon="inline-start" />
          {t('setup.writeConfig')}
        </Button>
        <Button onClick={actions.openCodexDirectory} variant="outline">
          <FolderOpenIcon data-icon="inline-start" />
          {t('setup.openCodexDir')}
        </Button>
      </div>
    )
  }
  if (step === 'auth') {
    return null
  }
  const usageLabel =
    busyAction === 'usage'
      ? (usageProgressText(usageProgress) ?? t('setup.checkAllUsage'))
      : t('setup.checkAllUsage')
  return (
    <div className="grid grid-cols-2 gap-2">
      <Button loading={busyAction === 'import'} onClick={actions.importAuthFiles} variant="outline">
        <UploadIcon data-icon="inline-start" />
        {t('action.importShort')}
      </Button>
      <Button disabled={busyAction === 'usage'} onClick={actions.checkUsage} variant="outline">
        <UsersIcon data-icon="inline-start" />
        {usageLabel}
      </Button>
    </div>
  )
}

function usageProgressText(progress: UsageProgress | null): string | null {
  if (!progress) {
    return null
  }
  return progress.total > 0 ? `${progress.completed}/${progress.total}` : '0/0'
}
