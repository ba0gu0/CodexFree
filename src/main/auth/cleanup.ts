import { existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { readImportedAuthAccounts } from './import'

const cleanableUsageStatusPattern = /\b(?:401|402)\b/

export function isCleanableUsageError(error: string | null | undefined): boolean {
  if (!error) {
    return false
  }
  return cleanableUsageStatusPattern.test(error)
}

export function deleteImportedAuthFilesForAccounts(
  directory: string,
  accountIds: Iterable<string>
): number {
  if (!existsSync(directory)) {
    return 0
  }

  const deletedAccountIds = new Set(accountIds)
  if (deletedAccountIds.size === 0) {
    return 0
  }

  let deletedFiles = 0
  for (const account of readImportedAuthAccounts(directory)) {
    if (!deletedAccountIds.has(account.accountId)) {
      continue
    }
    unlinkSync(join(directory, account.fileName))
    deletedFiles += 1
  }
  return deletedFiles
}
