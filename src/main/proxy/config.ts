import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { stderr } from 'node:process'
import * as v from 'valibot'
import type { ProxyConfig } from './types'

const outboundProxySchema = v.object({
  mode: v.picklist(['direct', 'http', 'https', 'socks4', 'socks5']),
  url: v.string()
})

const authPoolSchema = v.object({
  enabled: v.boolean(),
  directory: v.string()
})

const proxyConfigSchema = v.object({
  listenHost: v.pipe(v.string(), v.minLength(1)),
  listenPort: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535)),
  upstreamBaseUrl: v.pipe(v.string(), v.url()),
  outboundProxy: outboundProxySchema,
  authPool: authPoolSchema,
  maxRequestBodyBytes: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(50_000_000)),
  rawCaptureEnabled: v.boolean(),
  rawCaptureMaxBytes: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(50_000_000))
})

export const defaultProxyConfig: ProxyConfig = {
  listenHost: '127.0.0.1',
  listenPort: 33333,
  upstreamBaseUrl: 'https://chatgpt.com/backend-api/codex',
  outboundProxy: {
    mode: 'direct',
    url: ''
  },
  authPool: {
    enabled: false,
    directory: ''
  },
  maxRequestBodyBytes: 10_485_760,
  rawCaptureEnabled: false,
  rawCaptureMaxBytes: 0
}

export function readProxyConfig(configPath: string): ProxyConfig {
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as unknown
    const saved = typeof parsed === 'object' && parsed !== null ? parsed : {}
    return v.parse(proxyConfigSchema, { ...defaultProxyConfig, ...saved })
  } catch (error) {
    if (!isMissingConfigFile(error)) {
      const message = error instanceof Error ? error.message : String(error)
      stderr.write(`[codexfree] proxy config read failed, using defaults: ${message}\n`)
    }
    return defaultProxyConfig
  }
}

function isMissingConfigFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}

export function withManagedAuthPoolDirectory(
  config: ProxyConfig,
  managedAuthPoolDirectory: string
): ProxyConfig {
  return {
    ...config,
    authPool: {
      enabled: config.authPool.enabled,
      directory: managedAuthPoolDirectory
    }
  }
}

export function readManagedProxyConfig(
  configPath: string,
  managedAuthPoolDirectory: string
): ProxyConfig {
  return withManagedAuthPoolDirectory(readProxyConfig(configPath), managedAuthPoolDirectory)
}

export function writeProxyConfig(
  configPath: string,
  config: ProxyConfig,
  managedAuthPoolDirectory = config.authPool.directory
): ProxyConfig {
  const parsed = v.parse(
    proxyConfigSchema,
    withManagedAuthPoolDirectory(config, managedAuthPoolDirectory)
  )
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 })
  return parsed
}
