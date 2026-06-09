import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const [, , feedsDir, version] = process.argv

if (!feedsDir || !version) {
  throw new Error('Usage: node validate-velopack-feeds.mjs <feedsDir> <version>')
}

const forbiddenName =
  /(^com\.baoguo\.codexfree|^assets\.|^RELEASES|\.blockmap$|Portable\.zip$|-full\.nupkg$)/
const allowedPortableName = new RegExp(
  `^CodexFree-${escapeRegExp(version)}-macos-(x64|arm64)-Portable\\.zip$`
)
const assets = new Set(
  readFileSync(join(feedsDir, 'assets.txt'), 'utf8').split(/\r?\n/).filter(Boolean)
)
const feeds = readdirSync(feedsDir)
  .filter((name) => /^releases\..+\.json$/.test(name))
  .sort()

if (feeds.length !== 6) {
  throw new Error(`Expected 6 Velopack feed files, found ${feeds.length}: ${feeds.join(', ')}`)
}

for (const feedName of feeds) {
  const feed = JSON.parse(readFileSync(join(feedsDir, feedName), 'utf8'))

  if (!Array.isArray(feed.Assets)) {
    throw new Error(`Feed is missing Assets array: ${feedName}`)
  }

  let hasFullAsset = false

  for (const asset of feed.Assets) {
    if (!asset || typeof asset !== 'object') {
      throw new Error(`Invalid feed asset in ${feedName}`)
    }

    if (asset.Version !== version) {
      throw new Error(`${feedName} contains non-current version: ${asset.Version}`)
    }

    if (
      typeof asset.FileName !== 'string' ||
      (forbiddenName.test(asset.FileName) && !allowedPortableName.test(asset.FileName))
    ) {
      throw new Error(`${feedName} contains invalid asset name: ${asset.FileName}`)
    }

    if (!assets.has(asset.FileName)) {
      throw new Error(`${feedName} references missing release asset: ${asset.FileName}`)
    }

    if (asset.Type === 'Full') {
      hasFullAsset = true
    }
  }

  if (!hasFullAsset) {
    throw new Error(`Feed is missing a Full asset: ${feedName}`)
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
