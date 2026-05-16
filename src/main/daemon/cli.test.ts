import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultProxyConfig } from '../proxy/config'
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
        '--admin-port',
        '45556',
        '--data-dir',
        '/tmp/codexfree',
        '--raw-capture'
      ])
    ).toMatchObject({
      adminPort: 45556,
      dataDir: '/tmp/codexfree',
      host: '0.0.0.0',
      port: 45555,
      rawCaptureEnabled: true
    })
  })

  it('preserves saved raw capture setting unless explicitly overridden', () => {
    const root = mkdtempSync(join(tmpdir(), 'codexfree-daemon-cli-'))
    const paths = resolveDaemonCliPaths({ dataDir: root })

    writeFileSync(
      paths.configPath,
      JSON.stringify({ ...defaultProxyConfig, rawCaptureEnabled: true })
    )

    expect(buildDaemonCliConfig({}, paths).rawCaptureEnabled).toBe(true)
    expect(buildDaemonCliConfig({ rawCaptureEnabled: false }, paths).rawCaptureEnabled).toBe(false)
  })
})
