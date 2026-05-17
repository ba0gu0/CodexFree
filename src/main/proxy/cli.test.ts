import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildProxyCliConfig, parseProxyCliArgs, resolveProxyCliPaths } from './cli'
import { defaultProxyConfig, writeProxyConfig } from './config'

describe('proxy cli', () => {
  it('preserves the saved proxy port by default for standalone proxy runs', () => {
    const root = mkdtempSync(join(tmpdir(), 'codexfree-proxy-cli-'))
    const paths = resolveProxyCliPaths({ dataDir: root })

    writeProxyConfig(paths.databasePath, {
      ...defaultProxyConfig,
      listenHost: '127.0.0.1',
      listenPort: 33333
    })

    const config = buildProxyCliConfig({}, paths)

    expect(config.listenHost).toBe('127.0.0.1')
    expect(config.listenPort).toBe(33333)
  })

  it('preserves saved capture and byte limit settings unless explicitly overridden', () => {
    const root = mkdtempSync(join(tmpdir(), 'codexfree-proxy-cli-'))
    const paths = resolveProxyCliPaths({ dataDir: root })

    writeProxyConfig(paths.databasePath, {
      ...defaultProxyConfig,
      maxRequestBodyBytes: 4096,
      rawCaptureEnabled: true,
      rawCaptureMaxBytes: 2048
    })

    expect(buildProxyCliConfig({}, paths).rawCaptureEnabled).toBe(true)
    expect(buildProxyCliConfig({}, paths).maxRequestBodyBytes).toBe(4096)
    expect(buildProxyCliConfig({}, paths).rawCaptureMaxBytes).toBe(2048)
    expect(
      buildProxyCliConfig(
        { maxRequestBodyBytes: 0, rawCaptureEnabled: false, rawCaptureMaxBytes: 0 },
        paths
      )
    ).toMatchObject({
      maxRequestBodyBytes: 0,
      rawCaptureEnabled: false,
      rawCaptureMaxBytes: 0
    })
  })

  it('parses explicit host and port overrides', () => {
    const options = parseProxyCliArgs([
      '--host',
      '127.0.0.1',
      '--port=45555',
      '--max-request-body-bytes=0',
      '--database',
      '/tmp/codexfree.sqlite',
      '--raw-capture-max-bytes',
      '0'
    ])

    expect(options.host).toBe('127.0.0.1')
    expect(options.port).toBe(45555)
    expect(options.maxRequestBodyBytes).toBe(0)
    expect(options.databasePath).toBe('/tmp/codexfree.sqlite')
    expect(options.rawCaptureMaxBytes).toBe(0)
  })
})
