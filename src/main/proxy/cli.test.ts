import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildProxyCliConfig, parseProxyCliArgs, resolveProxyCliPaths } from './cli'
import { defaultProxyConfig } from './config'

describe('proxy cli', () => {
  it('preserves the saved proxy port by default for standalone proxy runs', () => {
    const root = mkdtempSync(join(tmpdir(), 'codexfree-proxy-cli-'))
    const paths = resolveProxyCliPaths({ dataDir: root })

    writeFileSync(
      paths.configPath,
      JSON.stringify({ ...defaultProxyConfig, listenHost: '127.0.0.1', listenPort: 33333 })
    )

    const config = buildProxyCliConfig({}, paths)

    expect(config.listenHost).toBe('127.0.0.1')
    expect(config.listenPort).toBe(33333)
  })

  it('preserves saved raw capture setting unless explicitly overridden', () => {
    const root = mkdtempSync(join(tmpdir(), 'codexfree-proxy-cli-'))
    const paths = resolveProxyCliPaths({ dataDir: root })

    writeFileSync(
      paths.configPath,
      JSON.stringify({ ...defaultProxyConfig, rawCaptureEnabled: true })
    )

    expect(buildProxyCliConfig({}, paths).rawCaptureEnabled).toBe(true)
    expect(buildProxyCliConfig({ rawCaptureEnabled: false }, paths).rawCaptureEnabled).toBe(false)
  })

  it('parses explicit host and port overrides', () => {
    const options = parseProxyCliArgs(['--host', '127.0.0.1', '--port=45555'])

    expect(options.host).toBe('127.0.0.1')
    expect(options.port).toBe(45555)
  })
})
