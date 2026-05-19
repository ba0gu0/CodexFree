import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { platform } from 'node:process'

const launchAgentLabel = 'com.baoguo.codexfree.daemon'
const windowsServiceName = 'CodexFreeDaemon'

export interface DaemonLaunchAgentOptions {
  commandPath: string
  dataDir: string
  scriptPath: string
  workingDirectory: string
}

export interface DaemonLaunchAgentSettings {
  enabled: boolean
  label: string
  manager: 'launchd' | 'systemd' | 'windows-service' | 'unsupported'
  plistPath: string | null
  programPath: string
  scriptPath: string
  supported: boolean
}

export function readDaemonLaunchAgentSettings(
  options: DaemonLaunchAgentOptions
): DaemonLaunchAgentSettings {
  const plistPath = launchAgentPlistPath()
  if (platform === 'win32') {
    return {
      enabled: windowsServiceExists(),
      label: windowsServiceName,
      manager: 'windows-service',
      plistPath: windowsServiceName,
      programPath: options.commandPath,
      scriptPath: options.scriptPath,
      supported: true
    }
  }
  if (platform === 'linux') {
    return {
      enabled: systemdUserServiceExists(),
      label: systemdServiceName(),
      manager: 'systemd',
      plistPath: systemdUserServicePath(),
      programPath: options.commandPath,
      scriptPath: options.scriptPath,
      supported: true
    }
  }
  return {
    enabled: Boolean(plistPath && existsSync(plistPath)),
    label: launchAgentLabel,
    manager: platform === 'darwin' ? 'launchd' : 'unsupported',
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
  if (platform === 'win32') {
    setWindowsServiceEnabled(options, enabled)
    return readDaemonLaunchAgentSettings(options)
  }

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

export function startDaemonLaunchAgent(options: DaemonLaunchAgentOptions): void {
  const settings = readDaemonLaunchAgentSettings(options)
  if (!settings.enabled) {
    throw new Error('CodexFree daemon startup service is not enabled')
  }
  if (platform === 'darwin') {
    startLaunchdService(settings)
    return
  }
  if (platform === 'win32') {
    execFileSync('sc.exe', ['start', windowsServiceName], { stdio: 'ignore' })
    return
  }
  if (platform === 'linux') {
    execFileSync('systemctl', ['--user', 'start', systemdServiceName()], { stdio: 'ignore' })
  }
}

export function stopDaemonLaunchAgent(options: DaemonLaunchAgentOptions): void {
  const settings = readDaemonLaunchAgentSettings(options)
  if (!settings.enabled) {
    throw new Error('CodexFree daemon startup service is not enabled')
  }
  if (platform === 'darwin') {
    stopLaunchdService(settings)
    return
  }
  if (platform === 'win32') {
    execFileSync('sc.exe', ['stop', windowsServiceName], { stdio: 'ignore' })
    return
  }
  if (platform === 'linux') {
    execFileSync('systemctl', ['--user', 'stop', systemdServiceName()], { stdio: 'ignore' })
  }
}

export function restartDaemonLaunchAgent(options: DaemonLaunchAgentOptions): void {
  stopDaemonLaunchAgent(options)
  startDaemonLaunchAgent(options)
}

function windowsServiceExists(): boolean {
  try {
    execFileSync('sc.exe', ['query', windowsServiceName], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function setWindowsServiceEnabled(options: DaemonLaunchAgentOptions, enabled: boolean): void {
  if (enabled) {
    if (windowsServiceExists()) {
      return
    }
    execFileSync('sc.exe', [
      'create',
      windowsServiceName,
      `binPath= ${windowsServiceCommand(options)}`,
      'start= auto',
      'DisplayName= CodexFree Daemon'
    ])
    return
  }

  if (windowsServiceExists()) {
    execFileSync('sc.exe', ['delete', windowsServiceName])
  }
}

function startLaunchdService(settings: DaemonLaunchAgentSettings): void {
  const serviceTarget = launchdServiceTarget()
  if (settings.plistPath) {
    try {
      execFileSync('launchctl', ['bootstrap', launchdDomain(), settings.plistPath], {
        stdio: 'ignore'
      })
    } catch {
      // Service may already be bootstrapped; kickstart below is the effective start operation.
    }
  }
  execFileSync('launchctl', ['kickstart', '-k', serviceTarget], { stdio: 'ignore' })
}

function stopLaunchdService(settings: DaemonLaunchAgentSettings): void {
  try {
    execFileSync('launchctl', ['bootout', launchdServiceTarget()], { stdio: 'ignore' })
    return
  } catch {
    if (!settings.plistPath) {
      throw new Error('CodexFree launch agent plist path is unavailable')
    }
  }
  execFileSync('launchctl', ['unload', settings.plistPath], { stdio: 'ignore' })
}

function launchdDomain(): string {
  const uid = process.getuid?.()
  return typeof uid === 'number' ? `gui/${uid}` : 'gui/0'
}

function launchdServiceTarget(): string {
  return `${launchdDomain()}/${launchAgentLabel}`
}

function systemdServiceName(): string {
  return 'codexfree-daemon.service'
}

function systemdUserServicePath(): string {
  return join(homedir(), '.config', 'systemd', 'user', systemdServiceName())
}

function systemdUserServiceExists(): boolean {
  return existsSync(systemdUserServicePath())
}

function windowsServiceCommand(options: DaemonLaunchAgentOptions): string {
  const command = [
    'cmd.exe',
    '/d',
    '/s',
    '/c',
    [
      'set ELECTRON_RUN_AS_NODE=1',
      'set NODE_NO_WARNINGS=1',
      `${quoteWindowsArg(options.commandPath)} ${quoteWindowsArg(options.scriptPath)} --data-dir ${quoteWindowsArg(options.dataDir)}`
    ].join('&& ')
  ]
  return command.map(quoteWindowsArg).join(' ')
}

function quoteWindowsArg(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`
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
