import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { type NormalizedAuthFile, normalizeAuthFile } from './normalize'
import { checkAccountUsageByAuthorization } from './usage-check'

export interface AuthImportResult {
  imported: number
  skipped: number
  directory: string
  accounts: {
    accountId: string
    email?: string
    fingerprint: string
    label: string
    refreshable: boolean
    sourceFormat: NormalizedAuthFile['format']
    fileName: string
  }[]
  errors: {
    filePath: string
    message: string
  }[]
}

interface AuthImportOptions {
  timeoutMs?: number
  usageUrl?: string
}

interface AuthImportEntry {
  fileName: string
  filePath: string
  input: unknown
  parseError?: string
}

export async function importAuthFilesToDirectory(
  sourcePaths: string[],
  targetDirectory: string,
  options: AuthImportOptions = {}
): Promise<AuthImportResult> {
  mkdirSync(targetDirectory, { recursive: true, mode: 0o700 })
  const files = sourcePaths.flatMap((sourcePath) => expandJsonFiles(sourcePath))
  const accounts: AuthImportResult['accounts'] = []
  const errors: AuthImportResult['errors'] = []
  let skipped = 0

  for (const entry of expandImportEntries(files)) {
    try {
      if (entry.parseError) {
        throw new Error(entry.parseError)
      }
      const normalized = await normalizeImportAuthFile(entry.input, entry.fileName, options)
      const labelPart = safeFilePart(normalized.label) || 'account'
      const accountPart = safeFilePart(normalized.accountId) || normalized.fingerprint
      const fileName = `${labelPart}-${accountPart}.auth.json`
      const targetPath = join(targetDirectory, fileName)
      removeExistingAccountFiles(targetDirectory, normalized.accountId, fileName)
      writeFileSync(targetPath, `${JSON.stringify(toStoredAuth(normalized), null, 2)}\n`, {
        mode: 0o600
      })
      accounts.push({
        accountId: normalized.accountId,
        email: normalized.email,
        fingerprint: normalized.fingerprint,
        label: normalized.label,
        refreshable: normalized.refreshable,
        sourceFormat: normalized.format,
        fileName
      })
    } catch (error) {
      skipped += 1
      errors.push({
        filePath: entry.filePath,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return {
    imported: accounts.length,
    skipped,
    directory: targetDirectory,
    accounts,
    errors
  }
}

async function normalizeImportAuthFile(
  input: unknown,
  fileName: string,
  options: AuthImportOptions
): Promise<NormalizedAuthFile> {
  try {
    return normalizeAuthFile(input, { fileName })
  } catch (error) {
    const accessToken = accessTokenFromInput(input)
    if (!accessToken || !(error instanceof Error) || !error.message.includes('account_id')) {
      throw error
    }
    const usage = await checkAccountUsageByAuthorization({
      authorization: `Bearer ${accessToken}`,
      label: fileName,
      timeoutMs: options.timeoutMs,
      usageUrl: options.usageUrl
    })
    if (!usage.ok || !usage.accountId) {
      throw new Error(usage.error ?? 'usage precheck failed to resolve account id')
    }
    const normalized = normalizeAuthFile(input, {
      accountId: usage.accountId,
      fileName
    })
    if (!usage.email || normalized.email) {
      return normalized
    }
    return {
      ...normalized,
      email: usage.email,
      label: usage.email
    }
  }
}

export function readImportedAuthAccounts(directory: string): AuthImportResult['accounts'] {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  return expandJsonFiles(directory).flatMap((filePath) => {
    try {
      const normalized = normalizeAuthFile(JSON.parse(readFileSync(filePath, 'utf8')) as unknown, {
        fileName: basename(filePath)
      })
      return [
        {
          accountId: normalized.accountId,
          email: normalized.email,
          fingerprint: normalized.fingerprint,
          label: normalized.label,
          refreshable: normalized.refreshable,
          sourceFormat: normalized.format,
          fileName: basename(filePath)
        }
      ]
    } catch (error) {
      // Invalid imported files are ignored during daemon sync; import reports them separately.
      void error
      return []
    }
  })
}

function expandJsonFiles(sourcePath: string): string[] {
  const stat = statSync(sourcePath)
  if (stat.isFile() && sourcePath.endsWith('.json')) {
    return [sourcePath]
  }
  if (!stat.isDirectory()) {
    return []
  }

  return readdirSync(sourcePath)
    .sort()
    .flatMap((name) => expandJsonFiles(join(sourcePath, name)))
}

function expandImportEntries(filePaths: string[]): AuthImportEntry[] {
  return filePaths.flatMap((filePath) => {
    try {
      const input = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
      const baseName = basename(filePath)
      return recordsFromImportJson(input, baseName).map((entry) => ({
        ...entry,
        filePath:
          entry.fileName === baseName
            ? filePath
            : `${filePath}${entry.fileName.slice(baseName.length)}`
      }))
    } catch (error) {
      return [
        {
          fileName: basename(filePath),
          filePath,
          input: {
            __codexfree_parse_error: error instanceof Error ? error.message : String(error)
          },
          parseError: error instanceof Error ? error.message : String(error)
        }
      ]
    }
  })
}

function recordsFromImportJson(
  input: unknown,
  fileName: string
): Array<Omit<AuthImportEntry, 'filePath'>> {
  if (Array.isArray(input)) {
    return input.map((item, index) => ({ fileName: `${fileName}#${index + 1}`, input: item }))
  }
  if (!isRecord(input)) {
    return [{ fileName, input }]
  }
  if (isAuthLikeRecord(input)) {
    return [{ fileName, input }]
  }

  for (const key of ['accounts', 'auths', 'items', 'records', 'data', 'files']) {
    const child = input[key]
    if (Array.isArray(child)) {
      return child.map((item, index) => ({ fileName: `${fileName}#${index + 1}`, input: item }))
    }
  }

  const entries = Object.entries(input)
    .filter(([, value]) => isRecord(value) && isAuthLikeRecord(value))
    .map(([key, value]) => ({
      fileName: `${fileName}#${safeFilePart(key) || 'record'}`,
      input: value
    }))
  return entries.length > 0 ? entries : [{ fileName, input }]
}

function toStoredAuth(normalized: NormalizedAuthFile): unknown {
  return {
    ...normalized.codexAuth,
    email: normalized.email,
    disabled: normalized.disabled,
    plan_type: normalized.planType,
    refreshable: normalized.refreshable
  }
}

function removeExistingAccountFiles(
  targetDirectory: string,
  accountId: string,
  keepFileName: string
): void {
  for (const filePath of expandJsonFiles(targetDirectory)) {
    if (basename(filePath) === keepFileName) {
      continue
    }
    try {
      const normalized = normalizeAuthFile(JSON.parse(readFileSync(filePath, 'utf8')) as unknown, {
        fileName: basename(filePath)
      })
      if (normalized.accountId === accountId) {
        unlinkSync(filePath)
      }
    } catch (error) {
      // Invalid existing files should not block importing a valid replacement.
      void error
    }
  }
}

function safeFilePart(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function accessTokenFromInput(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return undefined
  }
  const record = input as Record<string, unknown>
  const direct = record.access_token
  if (typeof direct === 'string' && direct.trim() !== '') {
    return direct
  }
  for (const key of ['tokens', 'token_data', 'storage']) {
    const child = record[key]
    if (!isRecord(child)) {
      continue
    }
    const nested = child.access_token
    if (typeof nested === 'string' && nested.trim() !== '') {
      return nested
    }
  }
  return undefined
}

function isAuthLikeRecord(record: Record<string, unknown>): boolean {
  return (
    typeof record.access_token === 'string' ||
    record.auth_mode === 'chatgpt' ||
    isRecord(record.tokens) ||
    isRecord(record.token_data) ||
    isRecord(record.storage)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
