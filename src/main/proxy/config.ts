import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import * as v from 'valibot'
import type { ProxyConfig } from './types'

const outboundProxySchema = v.object({
  mode: v.picklist(['direct', 'http', 'https', 'socks4', 'socks5']),
  url: v.string()
})

const proxyConfigSchema = v.object({
  listenHost: v.pipe(v.string(), v.minLength(1)),
  listenPort: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535)),
  upstreamBaseUrl: v.pipe(v.string(), v.url()),
  outboundProxy: outboundProxySchema,
  rawCaptureEnabled: v.boolean(),
  rawCaptureMaxBytes: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1_048_576))
})

export const defaultProxyConfig: ProxyConfig = {
  listenHost: '0.0.0.0',
  listenPort: 33333,
  upstreamBaseUrl: 'https://chatgpt.com/backend-api/codex',
  outboundProxy: {
    mode: 'direct',
    url: ''
  },
  rawCaptureEnabled: false,
  rawCaptureMaxBytes: 262_144
}

export function readProxyConfig(configPath: string): ProxyConfig {
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as unknown
    const saved = typeof parsed === 'object' && parsed !== null ? parsed : {}
    return v.parse(proxyConfigSchema, { ...defaultProxyConfig, ...saved })
  } catch {
    return defaultProxyConfig
  }
}

export function writeProxyConfig(configPath: string, config: ProxyConfig): ProxyConfig {
  const parsed = v.parse(proxyConfigSchema, config)
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 })
  return parsed
}
