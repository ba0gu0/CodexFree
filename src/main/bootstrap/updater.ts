import { app, BrowserWindow, shell } from 'electron'
import { type UpdateInfo, UpdateManager, VelopackApp, type VelopackAsset } from 'velopack'
import type {
  AppUpdateInfoDto,
  AppUpdateModeDto,
  AppUpdateStatusDto
} from '../../preload/proxy-api'
import { logger } from '../logger'

declare const CODEXFREE_RELEASE_REPOSITORY_URL: string
declare const CODEXFREE_UPDATE_SOURCE_URL: string

const RELEASE_REPOSITORY_URL = CODEXFREE_RELEASE_REPOSITORY_URL
const UPDATE_SOURCE_URL = ensureTrailingSlash(CODEXFREE_UPDATE_SOURCE_URL)
const RELEASES_URL = `${RELEASE_REPOSITORY_URL}/releases`

type StoredUpdate = UpdateInfo | VelopackAsset

export function runVelopackStartup(): void {
  logger.info('Velopack update source configured', { sourceUrl: UPDATE_SOURCE_URL })
  VelopackApp.build()
    .setLogger((level, message) => {
      if (level === 'error') {
        logger.error('Velopack startup error', { message })
        return
      }
      if (level === 'warn') {
        logger.warn('Velopack startup warning', { message })
        return
      }
      logger.debug('Velopack startup event', { level, message })
    })
    .run()
}

export class AppUpdateService {
  private readonly mode: AppUpdateModeDto = 'managed'
  private availableUpdate: UpdateInfo | null = null
  private downloadedUpdate: StoredUpdate | null = null
  private status: AppUpdateStatusDto = this.createInitialStatus()

  currentStatus(): AppUpdateStatusDto {
    this.refreshCapabilities()
    return this.status
  }

  async checkForUpdates(
    options: { silent: boolean } = { silent: false }
  ): Promise<AppUpdateStatusDto> {
    if (!this.isUpdateCheckSupported()) {
      this.setStatus({
        errorMessage: 'Update checks are available only in packaged release builds.',
        state: 'unsupported'
      })
      return this.status
    }

    this.setStatus({ errorMessage: null, progressPercent: null, state: 'checking' })
    try {
      const update = await this.checkUpdateByMode()
      this.downloadedUpdate = null
      this.setStatus(update)
    } catch (error) {
      const message = summarizeUpdateError(error)
      this.availableUpdate = null
      this.downloadedUpdate = null
      this.setStatus({
        availableUpdate: null,
        downloadedUpdate: null,
        errorMessage: message,
        lastCheckedAt: Date.now(),
        state: options.silent ? 'idle' : 'error'
      })
      logger.warn('Velopack update check failed', { message })
    }
    return this.status
  }

  async downloadAvailableUpdate(): Promise<AppUpdateStatusDto> {
    if (!this.availableUpdate) {
      throw new Error('No available update has been checked yet.')
    }

    this.setStatus({ errorMessage: null, progressPercent: 0, state: 'downloading' })
    try {
      await this.createUpdateManager().downloadUpdateAsync(this.availableUpdate, (percent) => {
        this.setStatus({ progressPercent: Math.max(0, Math.min(100, percent)) })
      })
      this.downloadedUpdate = this.availableUpdate
      this.setStatus({
        downloadedUpdate: toStoredUpdateInfoDto(this.downloadedUpdate),
        progressPercent: 100,
        state: 'downloaded'
      })
    } catch (error) {
      const message = summarizeUpdateError(error)
      this.setStatus({ errorMessage: message, state: 'error' })
      logger.warn('Velopack update download failed', { message })
    }
    return this.status
  }

  applyDownloadedUpdate(): AppUpdateStatusDto {
    const update = this.downloadedUpdate ?? this.createUpdateManager().getUpdatePendingRestart()
    if (!update) {
      throw new Error('No downloaded update is ready to install.')
    }

    this.createUpdateManager().waitExitThenApplyUpdate(update)
    app.quit()
    return this.status
  }

  async openReleasePage(): Promise<void> {
    const target = this.status.availableUpdate
      ? `${RELEASES_URL}/tag/v${this.status.availableUpdate.version}`
      : RELEASES_URL
    await shell.openExternal(target)
  }

  checkForUpdatesInBackground(): void {
    this.checkForUpdates({ silent: true }).catch((error: unknown) => {
      const message = summarizeUpdateError(error)
      logger.warn('Velopack background update check failed', { message })
    })
  }

  private async checkUpdateByMode(): Promise<Partial<AppUpdateStatusDto>> {
    const update = await this.createUpdateManager().checkForUpdatesAsync()
    this.availableUpdate = update
    return {
      availableUpdate: toUpdateInfoDto(update),
      downloadedUpdate: null,
      lastCheckedAt: Date.now(),
      state: update ? 'available' : 'not_available'
    }
  }

  private createInitialStatus(): AppUpdateStatusDto {
    return {
      availableUpdate: null,
      canApply: false,
      canCheck: app.isPackaged,
      canDownload: false,
      currentVersion: app.getVersion(),
      downloadedUpdate: null,
      errorMessage: null,
      lastCheckedAt: null,
      mode: this.mode,
      platform: process.platform,
      progressPercent: null,
      releaseUrl: RELEASES_URL,
      state: app.isPackaged ? 'idle' : 'unsupported'
    }
  }

  private createUpdateManager(): UpdateManager {
    return new UpdateManager(UPDATE_SOURCE_URL)
  }

  private isUpdateCheckSupported(): boolean {
    return app.isPackaged
  }

  private refreshCapabilities(): void {
    const pendingUpdate = this.isUpdateCheckSupported()
      ? (this.downloadedUpdate ?? safePendingUpdate(() => this.createUpdateManager()))
      : null
    this.status = withCapabilities({
      ...this.status,
      currentVersion: app.getVersion(),
      downloadedUpdate: toStoredUpdateInfoDto(pendingUpdate),
      state:
        this.status.state === 'idle' && !this.isUpdateCheckSupported()
          ? 'unsupported'
          : this.status.state
    })
  }

  private setStatus(patch: Partial<AppUpdateStatusDto>): void {
    this.status = withCapabilities({ ...this.status, ...patch })
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('app:update-status-changed', this.status)
    }
  }
}

export const appUpdateService = new AppUpdateService()

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`
}

function withCapabilities(status: AppUpdateStatusDto): AppUpdateStatusDto {
  const hasAvailableUpdate = status.availableUpdate !== null
  const hasDownloadedUpdate = status.downloadedUpdate !== null
  return {
    ...status,
    canApply: status.mode === 'managed' && hasDownloadedUpdate,
    canCheck:
      status.state !== 'checking' &&
      status.state !== 'downloading' &&
      status.state !== 'unsupported',
    canDownload:
      status.mode === 'managed' &&
      hasAvailableUpdate &&
      !hasDownloadedUpdate &&
      status.state !== 'checking' &&
      status.state !== 'downloading'
  }
}

function safePendingUpdate(createUpdateManager: () => UpdateManager): StoredUpdate | null {
  try {
    return createUpdateManager().getUpdatePendingRestart()
  } catch (error) {
    logger.debug('Velopack pending update check unavailable', {
      message: summarizeUpdateError(error)
    })
    return null
  }
}

function toStoredUpdateInfoDto(update: StoredUpdate | null): AppUpdateInfoDto | null {
  if (!update) {
    return null
  }
  if ('TargetFullRelease' in update) {
    return toUpdateInfoDto(update)
  }
  return toAssetDto(update, false)
}

function toUpdateInfoDto(update: UpdateInfo | null): AppUpdateInfoDto | null {
  if (!update) {
    return null
  }
  return toAssetDto(update.TargetFullRelease, update.IsDowngrade)
}

function toAssetDto(asset: VelopackAsset, isDowngrade: boolean): AppUpdateInfoDto {
  return {
    fileName: asset.FileName,
    isDowngrade,
    notesMarkdown: asset.NotesMarkdown,
    size: asset.Size,
    version: asset.Version
  }
}

function summarizeUpdateError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.split('\n')[0] ?? error.message
  }
  return String(error)
}
