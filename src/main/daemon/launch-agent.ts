import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { platform } from 'node:process'

const launchAgentLabel = 'com.baoguo.codexfree.daemon'

export interface DaemonLaunchAgentOptions {
  commandPath: string
  dataDir: string
  scriptPath: string
  workingDirectory: string
}

export interface DaemonLaunchAgentSettings {
  enabled: boolean
  label: string
  plistPath: string | null
  programPath: string
  scriptPath: string
  supported: boolean
}

export function readDaemonLaunchAgentSettings(
  options: DaemonLaunchAgentOptions
): DaemonLaunchAgentSettings {
  const plistPath = launchAgentPlistPath()
  return {
    enabled: Boolean(plistPath && existsSync(plistPath)),
    label: launchAgentLabel,
    plistPath,
    programPath: options.commandPath,
    scriptPath: options.scriptPath,
    supported: platform === 'darwin'
  }
}

export function setDaemonLaunchAgentEnabled(
  options: DaemonLaunchAgentOptions,
  enabled: boolean
): DaemonLaunchAgentSettings {
  const plistPath = launchAgentPlistPath()
  if (!plistPath) {
    return readDaemonLaunchAgentSettings(options)
  }

  if (enabled) {
    mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true, mode: 0o755 })
    mkdirSync(options.dataDir, { recursive: true, mode: 0o700 })
    writeFileSync(plistPath, renderLaunchAgentPlist(options), { mode: 0o644 })
  } else if (existsSync(plistPath)) {
    unlinkSync(plistPath)
  }

  return readDaemonLaunchAgentSettings(options)
}

function launchAgentPlistPath(): string | null {
  if (platform !== 'darwin') {
    return null
  }
  return join(homedir(), 'Library', 'LaunchAgents', `${launchAgentLabel}.plist`)
}

function renderLaunchAgentPlist(options: DaemonLaunchAgentOptions): string {
  const args = [options.commandPath, options.scriptPath, '--data-dir', options.dataDir]

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"',
    '  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${escapeXml(launchAgentLabel)}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    ...args.map((arg) => `    <string>${escapeXml(arg)}</string>`),
    '  </array>',
    '  <key>WorkingDirectory</key>',
    `  <string>${escapeXml(options.workingDirectory)}</string>`,
    '  <key>EnvironmentVariables</key>',
    '  <dict>',
    '    <key>ELECTRON_RUN_AS_NODE</key>',
    '    <string>1</string>',
    '    <key>NODE_NO_WARNINGS</key>',
    '    <string>1</string>',
    '  </dict>',
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <false/>',
    '  <key>StandardOutPath</key>',
    `  <string>${escapeXml(join(options.dataDir, 'daemon.launchd.out.log'))}</string>`,
    '  <key>StandardErrorPath</key>',
    `  <string>${escapeXml(join(options.dataDir, 'daemon.launchd.err.log'))}</string>`,
    '</dict>',
    '</plist>',
    ''
  ].join('\n')
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}
