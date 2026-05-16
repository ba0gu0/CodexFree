import { autoUpdater } from 'electron-updater'
import { logger } from '../logger'

interface UpdateCheckErrorSummary {
  name: string
  message: string
  statusCode?: number
}

function readStringProperty(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) {
    return undefined
  }

  const property = value[key as keyof typeof value]
  return typeof property === 'string' ? property : undefined
}

function readNumberProperty(value: unknown, key: string): number | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) {
    return undefined
  }

  const property = value[key as keyof typeof value]
  return typeof property === 'number' ? property : undefined
}

function summarizeUpdateCheckError(error: unknown): UpdateCheckErrorSummary {
  return {
    name:
      error instanceof Error ? error.name : (readStringProperty(error, 'name') ?? 'UnknownError'),
    message: error instanceof Error ? error.message.split('\n')[0] : 'Update check failed',
    statusCode: readNumberProperty(error, 'statusCode')
  }
}

export function checkForAppUpdates(): void {
  autoUpdater.logger = null
  autoUpdater.autoDownload = false
  autoUpdater.checkForUpdates().catch((error: unknown) => {
    logger.warn('GitHub update check failed during startup', summarizeUpdateCheckError(error))
  })
}
