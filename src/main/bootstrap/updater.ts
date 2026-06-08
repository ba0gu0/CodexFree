import { app, BrowserWindow, shell } from 'electron'
import { type UpdateInfo, UpdateManager, VelopackApp, type VelopackAsset } from 'velopack'
import type {
  AppUpdateInfoDto,
  AppUpdateModeDto,
  AppUpdateStatusDto
} from '../../preload/proxy-api'
import { logger } from '../logger'

const UPDATE_SOURCE_URL = 'https://github.com/ba0gu0/CodexFree'
const GITHUB_RELEASES_API_URL = 'https://api.github.com/repos/ba0gu0/CodexFree/releases?per_page=30'
const RELEASES_URL = `${UPDATE_SOURCE_URL}/releases`

type StoredUpdate = UpdateInfo | VelopackAsset

export function runVelopackStartup(): void {
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
  private readonly mode: AppUpdateModeDto =
    process.platform === 'darwin' ? 'manual-download' : 'managed'
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
    if (this.mode === 'manual-download') {
      throw new Error('macOS alpha builds use manual downloads from GitHub releases.')
    }
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
    if (this.mode === 'manual-download') {
      throw new Error('macOS alpha builds use manual downloads from GitHub releases.')
    }
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
    if (this.mode === 'manual-download') {
      const update = await checkGitHubReleaseUpdate(app.getVersion())
      this.availableUpdate = null
      return {
        availableUpdate: update,
        downloadedUpdate: null,
        lastCheckedAt: Date.now(),
        state: update ? 'available' : 'not_available'
      }
    }

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
    const pendingUpdate =
      this.mode === 'managed'
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

interface GitHubReleaseAsset {
  browser_download_url: string
  name: string
  size: number
}

interface GitHubRelease {
  assets: GitHubReleaseAsset[]
  body: string | null
  draft: boolean
  html_url: string
  prerelease: boolean
  tag_name: string
}

interface ParsedSemver {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

async function checkGitHubReleaseUpdate(currentVersion: string): Promise<AppUpdateInfoDto | null> {
  const response = await fetch(GITHUB_RELEASES_API_URL, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': `CodexFree/${currentVersion}`
    }
  })
  if (!response.ok) {
    throw new Error(`GitHub release check failed with HTTP ${response.status}`)
  }
  const releases = parseGitHubReleases(await response.json())
  const current = parseSemver(currentVersion)
  if (!current) {
    throw new Error(`Current app version is not valid semver: ${currentVersion}`)
  }
  const includePrerelease = current.prerelease.length > 0
  const newerReleases = releases
    .filter((release) => !release.draft && (includePrerelease || !release.prerelease))
    .map((release) => ({ release, version: parseSemver(stripVersionPrefix(release.tag_name)) }))
    .filter(
      (item): item is { release: GitHubRelease; version: ParsedSemver } =>
        item.version !== null && compareSemver(item.version, current) > 0
    )
    .sort((left, right) => compareSemver(right.version, left.version))

  const latest = newerReleases[0]?.release
  if (!latest) {
    return null
  }
  const asset =
    latest.assets.find((item) => /\.(dmg|pkg|zip)$/i.test(item.name)) ?? latest.assets[0]
  return {
    fileName: asset?.name ?? latest.html_url,
    isDowngrade: false,
    notesMarkdown: latest.body ?? '',
    size: asset?.size ?? 0,
    version: stripVersionPrefix(latest.tag_name)
  }
}

function parseGitHubReleases(value: unknown): GitHubRelease[] {
  if (!Array.isArray(value)) {
    throw new Error('GitHub release response was not an array')
  }
  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return []
    }
    const release = item as Record<string, unknown>
    const tagName = stringValue(release.tag_name)
    const htmlUrl = stringValue(release.html_url)
    const assets = parseGitHubAssets(release.assets)
    if (!tagName || !htmlUrl) {
      return []
    }
    return [
      {
        assets,
        body: stringValue(release.body),
        draft: booleanValue(release.draft),
        html_url: htmlUrl,
        prerelease: booleanValue(release.prerelease),
        tag_name: tagName
      }
    ]
  })
}

function parseGitHubAssets(value: unknown): GitHubReleaseAsset[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return []
    }
    const asset = item as Record<string, unknown>
    const name = stringValue(asset.name)
    const browserDownloadUrl = stringValue(asset.browser_download_url)
    const size = numberValue(asset.size)
    return name && browserDownloadUrl
      ? [{ browser_download_url: browserDownloadUrl, name, size }]
      : []
  })
}

function parseSemver(version: string): ParsedSemver | null {
  const match = stripVersionPrefix(version).match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/
  )
  if (!match) {
    return null
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : []
  }
}

function compareSemver(left: ParsedSemver, right: ParsedSemver): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    const diff = left[key] - right[key]
    if (diff !== 0) {
      return diff
    }
  }
  return comparePrerelease(left.prerelease, right.prerelease)
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 && right.length > 0) {
    return 1
  }
  if (left.length > 0 && right.length === 0) {
    return -1
  }
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftPart = left[index]
    const rightPart = right[index]
    if (leftPart === undefined) {
      return -1
    }
    if (rightPart === undefined) {
      return 1
    }
    const diff = comparePrereleasePart(leftPart, rightPart)
    if (diff !== 0) {
      return diff
    }
  }
  return 0
}

function comparePrereleasePart(left: string, right: string): number {
  const leftNumber = numericPrereleasePart(left)
  const rightNumber = numericPrereleasePart(right)
  if (leftNumber !== null && rightNumber !== null) {
    return leftNumber - rightNumber
  }
  if (leftNumber !== null) {
    return -1
  }
  if (rightNumber !== null) {
    return 1
  }
  return left.localeCompare(right)
}

function numericPrereleasePart(value: string): number | null {
  return /^\d+$/.test(value) ? Number(value) : null
}

function stripVersionPrefix(version: string): string {
  return version.startsWith('v') ? version.slice(1) : version
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function booleanValue(value: unknown): boolean {
  return value === true
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
