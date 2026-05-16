import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { type NormalizedAuthFile, normalizeAuthFile } from './normalize'

export interface AuthImportResult {
  imported: number
  skipped: number
  directory: string
  accounts: {
    accountId: string
    fingerprint: string
    label: string
    fileName: string
  }[]
  errors: {
    filePath: string
    message: string
  }[]
}

export function importAuthFilesToDirectory(
  sourcePaths: string[],
  targetDirectory: string
): AuthImportResult {
  mkdirSync(targetDirectory, { recursive: true, mode: 0o700 })
  const files = sourcePaths.flatMap((sourcePath) => expandJsonFiles(sourcePath))
  const accounts: AuthImportResult['accounts'] = []
  const errors: AuthImportResult['errors'] = []
  let skipped = 0

  for (const filePath of files) {
    try {
      const normalized = normalizeAuthFile(JSON.parse(readFileSync(filePath, 'utf8')) as unknown, {
        fileName: basename(filePath)
      })
      const labelPart = safeFilePart(normalized.label) || 'account'
      const accountPart = safeFilePart(normalized.accountId) || normalized.fingerprint
      const fileName = `${labelPart}-${accountPart}.auth.json`
      const targetPath = join(targetDirectory, fileName)
      writeFileSync(targetPath, `${JSON.stringify(toStoredAuth(normalized), null, 2)}\n`, {
        mode: 0o600
      })
      accounts.push({
        accountId: normalized.accountId,
        fingerprint: normalized.fingerprint,
        label: normalized.label,
        fileName
      })
    } catch (error) {
      skipped += 1
      errors.push({
        filePath,
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

function expandJsonFiles(sourcePath: string): string[] {
  const stat = statSync(sourcePath)
  if (stat.isFile() && sourcePath.endsWith('.json')) {
    return [sourcePath]
  }
  if (!stat.isDirectory()) {
    return []
  }

  return readdirSync(sourcePath)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => join(sourcePath, name))
}

function toStoredAuth(normalized: NormalizedAuthFile): unknown {
  return {
    ...normalized.codexAuth,
    email: normalized.email,
    disabled: normalized.disabled
  }
}

function safeFilePart(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}
