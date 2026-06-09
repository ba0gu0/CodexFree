import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const [, , releasesDir, channel] = process.argv

if (!releasesDir || !channel) {
  throw new Error('Usage: node has-velopack-full-release.mjs <releasesDir> <channel>')
}

const feedPath = join(releasesDir, `releases.${channel}.json`)

if (!existsSync(feedPath)) {
  process.exit(1)
}

const feed = JSON.parse(readFileSync(feedPath, 'utf8'))
const hasFullPackage =
  Array.isArray(feed.Assets) &&
  feed.Assets.some((asset) => {
    return asset && typeof asset === 'object' && asset.Type === 'Full'
  })

process.exit(hasFullPackage ? 0 : 1)
