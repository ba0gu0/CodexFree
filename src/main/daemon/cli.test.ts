import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultProxyConfig, writeProxyConfig } from '../proxy/config'
import { buildDaemonCliConfig, parseDaemonCliArgs, resolveDaemonCliPaths } from './cli'

describe('daemon cli options', () => {
  it('enables debug output only when the explicit debug flag is present', () => {
    expect(parseDaemonCliArgs([])).not.toHaveProperty('debug')
    expect(parseDaemonCliArgs(['--debug'])).toMatchObject({ debug: true })
    expect(parseDaemonCliArgs(['--no-debug'])).toMatchObject({ debug: false })
  })

  it('parses daemon, admin, data, and capture options', () => {
    expect(
      parseDaemonCliArgs([
        '--host',
        '0.0.0.0',
        '--port',
        '45555',
        '--max-request-body-bytes',
        '0',
        '--admin-port',
        '45556',
        '--database',
        '/tmp/codexfree.sqlite',
        '--data-dir',
        '/tmp/codexfree',
        '--raw-capture',
        '--raw-capture-max-bytes',
        '0'
      ])
    ).toMatchObject({
      adminPort: 45556,
      databasePath: '/tmp/codexfree.sqlite',
      dataDir: '/tmp/codexfree',
      host: '0.0.0.0',
      maxRequestBodyBytes: 0,
      port: 45555,
      rawCaptureMaxBytes: 0,
      rawCaptureEnabled: true
    })
  })

  it('preserves saved capture and byte limit settings unless explicitly overridden', () => {
    const root = mkdtempSync(join(tmpdir(), 'codexfree-daemon-cli-'))
    const paths = resolveDaemonCliPaths({ dataDir: root })

    writeProxyConfig(paths.databasePath, {
      ...defaultProxyConfig,
      maxRequestBodyBytes: 4096,
      rawCaptureEnabled: true,
      rawCaptureMaxBytes: 2048
    })

    expect(buildDaemonCliConfig({}, paths).rawCaptureEnabled).toBe(true)
    expect(buildDaemonCliConfig({}, paths).maxRequestBodyBytes).toBe(4096)
    expect(buildDaemonCliConfig({}, paths).rawCaptureMaxBytes).toBe(2048)
    expect(
      buildDaemonCliConfig(
        { maxRequestBodyBytes: 0, rawCaptureEnabled: false, rawCaptureMaxBytes: 0 },
        paths
      )
    ).toMatchObject({
      maxRequestBodyBytes: 0,
      rawCaptureEnabled: false,
      rawCaptureMaxBytes: 0
    })
  })
})
