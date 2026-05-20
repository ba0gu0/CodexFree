import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { platform } from 'node:process'
import { promisify } from 'node:util'

const launchAgentLabel = 'com.baoguo.codexfree.daemon'
const windowsServiceName = 'CodexFreeDaemon'
const execFileAsync = promisify(execFile)
const serviceCommandTimeoutMs = 30_000
const launchdStateTimeoutMs = 5_000

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

export async function startDaemonLaunchAgent(options: DaemonLaunchAgentOptions): Promise<void> {
  const settings = readDaemonLaunchAgentSettings(options)
  if (!settings.enabled) {
    throw new Error('CodexFree daemon startup service is not enabled')
  }
  if (platform === 'darwin') {
    await startLaunchdService(settings)
    return
  }
  if (platform === 'win32') {
    await runServiceCommand('sc.exe', ['start', windowsServiceName])
    return
  }
  if (platform === 'linux') {
    await runServiceCommand('systemctl', ['--user', 'start', systemdServiceName()])
  }
}

export async function stopDaemonLaunchAgent(options: DaemonLaunchAgentOptions): Promise<void> {
  const settings = readDaemonLaunchAgentSettings(options)
  if (!settings.enabled) {
    throw new Error('CodexFree daemon startup service is not enabled')
  }
  if (platform === 'darwin') {
    await stopLaunchdService(settings)
    return
  }
  if (platform === 'win32') {
    await runServiceCommand('sc.exe', ['stop', windowsServiceName])
    return
  }
  if (platform === 'linux') {
    await runServiceCommand('systemctl', ['--user', 'stop', systemdServiceName()])
  }
}

export async function restartDaemonLaunchAgent(options: DaemonLaunchAgentOptions): Promise<void> {
  await stopDaemonLaunchAgent(options)
  await startDaemonLaunchAgent(options)
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

async function startLaunchdService(settings: DaemonLaunchAgentSettings): Promise<void> {
  if (!settings.plistPath) {
    throw new Error('CodexFree launch agent plist path is unavailable')
  }
  if (await bootstrapLaunchdService(settings.plistPath)) {
    await waitForLaunchdLoaded(true)
    return
  }
  if (!(await isLaunchdServiceLoaded())) {
    await delay(300)
    if (await bootstrapLaunchdService(settings.plistPath)) {
      await waitForLaunchdLoaded(true)
      return
    }
  }
  try {
    await runServiceCommand('launchctl', ['kickstart', '-k', launchdServiceTarget()])
  } catch (error) {
    if (await waitForLaunchdLoaded(true, 1_500)) {
      return
    }
    throw error
  }
  await waitForLaunchdLoaded(true)
}

async function stopLaunchdService(settings: DaemonLaunchAgentSettings): Promise<void> {
  try {
    await runServiceCommand('launchctl', ['bootout', launchdServiceTarget()])
    await waitForLaunchdLoaded(false)
    return
  } catch {
    if (!(await isLaunchdServiceLoaded())) {
      return
    }
    if (!settings.plistPath) {
      throw new Error('CodexFree launch agent plist path is unavailable')
    }
  }
  await runServiceCommand('launchctl', ['unload', settings.plistPath])
  await waitForLaunchdLoaded(false)
}

async function runServiceCommand(command: string, args: string[]): Promise<void> {
  await execFileAsync(command, args, {
    timeout: serviceCommandTimeoutMs,
    windowsHide: platform === 'win32'
  })
}

async function bootstrapLaunchdService(plistPath: string): Promise<boolean> {
  try {
    await runServiceCommand('launchctl', ['bootstrap', launchdDomain(), plistPath])
    return true
  } catch {
    return false
  }
}

async function waitForLaunchdLoaded(
  expected: boolean,
  timeoutMs = launchdStateTimeoutMs
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await isLaunchdServiceLoaded()) === expected) {
      return true
    }
    await delay(150)
  }
  return false
}

async function isLaunchdServiceLoaded(): Promise<boolean> {
  try {
    await runServiceCommand('launchctl', ['print', launchdServiceTarget()])
    return true
  } catch {
    return false
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
