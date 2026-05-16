import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkAuthDirectoryUsage } from './usage-check'

describe('account usage check', () => {
  it('creates an empty managed auth directory before scanning', async () => {
    const directory = join(mkdtempSync(join(tmpdir(), 'codexfree-usage-')), 'missing-auth-pool')

    await expect(checkAuthDirectoryUsage(directory)).resolves.toEqual([])
  })
})
