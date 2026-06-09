import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [, , releasesDir, version, channel] = process.argv

if (!releasesDir || !version || !channel) {
  throw new Error('Usage: node normalize-velopack-assets.mjs <releasesDir> <version> <channel>')
}

const channelParts = channel.split('-')

if (channelParts.length !== 2) {
  throw new Error(`Unsupported Velopack channel: ${channel}`)
}

const [osName, arch] = channelParts
const platformNames = new Map([
  ['osx', 'macos'],
  ['win', 'windows'],
  ['linux', 'linux']
])
const platformName = platformNames.get(osName)

if (!platformName) {
  throw new Error(`Unsupported Velopack platform: ${osName}`)
}

const releasePrefix = `CodexFree-${version}-${platformName}-${arch}`
const renames = new Map()

const renameFirst = (predicate, targetName) => {
  const currentName = readdirSync(releasesDir).find(predicate)

  if (!currentName) {
    return null
  }

  if (currentName === targetName) {
    return targetName
  }

  const currentPath = join(releasesDir, currentName)
  const targetPath = join(releasesDir, targetName)

  if (existsSync(targetPath)) {
    throw new Error(`Cannot rename ${currentName}; target already exists: ${targetName}`)
  }

  renameSync(currentPath, targetPath)
  renames.set(currentName, targetName)
  return targetName
}

if (osName === 'win') {
  renameFirst((name) => name.endsWith(`${channel}-Setup.exe`), `${releasePrefix}-setup.exe`)
}

if (osName === 'osx') {
  renameFirst((name) => name.endsWith(`${channel}-Portable.zip`), `${releasePrefix}-Portable.zip`)
}

if (osName === 'linux') {
  renameFirst((name) => name.endsWith(`${channel}.AppImage`), `${releasePrefix}.AppImage`)
}

const feedPath = join(releasesDir, `releases.${channel}.json`)

if (existsSync(feedPath)) {
  const feed = JSON.parse(readFileSync(feedPath, 'utf8'))

  if (Array.isArray(feed.Assets)) {
    feed.Assets = feed.Assets.filter((asset) => {
      return asset && typeof asset === 'object' && asset.Version === version
    })

    for (const asset of feed.Assets) {
      if (
        asset &&
        typeof asset === 'object' &&
        typeof asset.FileName === 'string' &&
        renames.has(asset.FileName)
      ) {
        asset.FileName = renames.get(asset.FileName)
      }
    }
  }

  writeFileSync(feedPath, `${JSON.stringify(feed)}\n`)
}

const buildAssetsPath = join(releasesDir, `assets.${channel}.json`)

if (existsSync(buildAssetsPath) && renames.size > 0) {
  const buildAssets = JSON.parse(readFileSync(buildAssetsPath, 'utf8'))

  if (Array.isArray(buildAssets)) {
    for (const asset of buildAssets) {
      if (
        asset &&
        typeof asset === 'object' &&
        typeof asset.RelativeFileName === 'string' &&
        renames.has(asset.RelativeFileName)
      ) {
        asset.RelativeFileName = renames.get(asset.RelativeFileName)
      }
    }
  }

  writeFileSync(buildAssetsPath, `${JSON.stringify(buildAssets)}\n`)
}

for (const [from, to] of renames) {
  console.log(`${from} -> ${to}`)
}
