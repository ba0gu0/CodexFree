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
import type { SetupAssistantState } from '../../data/proxy-console'
import type { SetupAssistantActions, WizardStep } from './setup-assistant'

interface SetupActionProps {
  actions: SetupAssistantActions
  busyAction: string | null
  onConfirmRename: () => void
  state: SetupAssistantState
  t: (key: CopyKey, values?: Record<string, string | number>) => string
}

export function AssistantActions({
  actions,
  busyAction,
  onConfirmRename,
  state,
  t
}: SetupActionProps): ReactElement {
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
      <Button loading={busyAction === 'usage'} onClick={actions.checkUsage} variant="outline">
        <UsersIcon data-icon="inline-start" />
        {t('setup.checkAllUsage')}
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
  onConfirmRename,
  state,
  step,
  t
}: SetupActionProps & { step: WizardStep }): ReactElement {
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
    return (
      <div className="grid gap-2">
        <Button onClick={actions.openCodexDirectory} variant="outline">
          <FolderOpenIcon data-icon="inline-start" />
          {t('setup.openCodexDir')}
        </Button>
        <Button
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
  return (
    <div className="grid grid-cols-2 gap-2">
      <Button loading={busyAction === 'import'} onClick={actions.importAuthFiles} variant="outline">
        <UploadIcon data-icon="inline-start" />
        {t('action.importShort')}
      </Button>
      <Button loading={busyAction === 'usage'} onClick={actions.checkUsage} variant="outline">
        <UsersIcon data-icon="inline-start" />
        {t('setup.checkAllUsage')}
      </Button>
    </div>
  )
}
