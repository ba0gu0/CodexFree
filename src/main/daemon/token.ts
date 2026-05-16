import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export function readOrCreateAdminToken(path: string): string {
  if (existsSync(path)) {
    const token = readFileSync(path, 'utf8').trim()
    if (token.length >= 32) {
      return token
    }
  }

  const token = randomBytes(32).toString('hex')
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${token}\n`, { mode: 0o600 })
  return token
}
