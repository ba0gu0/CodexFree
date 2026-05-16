import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFile } from 'node:fs'
import { type IncomingHttpHeaders, type OutgoingHttpHeaders, STATUS_CODES } from 'node:http'
import type { RequestOptions } from 'node:https'
import { dirname, join } from 'node:path'
import { stderr } from 'node:process'

export interface RawCapture {
  directory: string
  writeRequest(method: string, path: string, headers: IncomingHttpHeaders, body: Buffer): void
  writeOutboundRequest(options: RequestOptions, body: Buffer): void
  writeResponse(statusCode: number, headers: OutgoingHttpHeaders, body: Buffer): void
  writeUpgradeResponse(statusCode: number, headers: IncomingHttpHeaders): void
}

export interface RawCaptureFile {
  name: string
  size: number
  content: string
}

export interface RawCaptureDetail {
  requestId: string
  directory: string
  files: RawCaptureFile[]
}

export interface RawCaptureCleanupResult {
  deletedEntries: number
}

const requestIdPatternStart = '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-'
const requestIdPatternEnd = '[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
const requestIdPattern = new RegExp(`${requestIdPatternStart}${requestIdPatternEnd}`, 'i')

export function createRawCapture(
  rootDirectory: string,
  requestId: string,
  enabled: boolean,
  maxBytes: number
): RawCapture | undefined {
  if (!enabled) {
    return undefined
  }

  const directory = join(rootDirectory, requestId)
  mkdirSync(directory, { recursive: true, mode: 0o700 })

  return {
    directory,
    writeRequest(method, path, headers, body) {
      writeHttpMessage(
        join(directory, 'codex-inbound-request.http'),
        `${method} ${path} HTTP/1.1`,
        headers,
        body.subarray(0, maxBytes)
      )
    },
    writeOutboundRequest(options, body) {
      const headers = options.headers ?? {}
      writeHttpMessage(
        join(directory, 'chatgpt-outbound-request.http'),
        formatRequestLine(options),
        headers,
        body.subarray(0, maxBytes)
      )
    },
    writeResponse(statusCode, headers, body) {
      const startLine = formatResponseLine(statusCode)
      const bodySample = body.subarray(0, maxBytes)
      writeHttpMessage(
        join(directory, 'chatgpt-upstream-response.http'),
        startLine,
        headers,
        bodySample
      )
      writeHttpMessage(
        join(directory, 'codex-downstream-response.http'),
        startLine,
        headers,
        bodySample
      )
    },
    writeUpgradeResponse(statusCode, headers) {
      const startLine = formatResponseLine(statusCode)
      writeHttpMessage(
        join(directory, 'chatgpt-upstream-response.http'),
        startLine,
        headers,
        Buffer.alloc(0)
      )
      writeHttpMessage(
        join(directory, 'codex-downstream-response.http'),
        startLine,
        headers,
        Buffer.alloc(0)
      )
    }
  }
}

export function readRawCaptureDetail(
  rootDirectory: string,
  requestId: string
): RawCaptureDetail | undefined {
  if (!isRequestId(requestId)) {
    return undefined
  }

  const directory = join(rootDirectory, requestId)
  let files: RawCaptureFile[]
  try {
    files = readdirSync(directory)
      .toSorted()
      .map((name) => {
        const path = join(directory, name)
        const stat = statSync(path)
        return {
          name,
          size: stat.size,
          content: readCaptureFile(path)
        }
      })
  } catch {
    return undefined
  }

  return { requestId, directory, files }
}

function isRequestId(value: string): boolean {
  return requestIdPattern.test(value)
}

export function clearRawCaptures(rootDirectory: string): RawCaptureCleanupResult {
  mkdirSync(rootDirectory, { recursive: true, mode: 0o700 })
  let deletedEntries = 0
  for (const entry of readdirSync(rootDirectory)) {
    rmSync(join(rootDirectory, entry), { recursive: true, force: true })
    deletedEntries += 1
  }
  return { deletedEntries }
}

export function appendSample(
  current: Buffer<ArrayBufferLike>,
  chunk: Buffer<ArrayBufferLike>,
  maxBytes: number
): Buffer<ArrayBufferLike> {
  if (current.byteLength >= maxBytes) {
    return current
  }

  return Buffer.concat([current, chunk]).subarray(0, maxBytes)
}

function writeHttpMessage(
  path: string,
  startLine: string,
  headers: RequestOptions['headers'] | IncomingHttpHeaders | OutgoingHttpHeaders,
  body: Buffer
): void {
  const headerLines = serializeHeaders(headers)
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    writeFile(
      path,
      Buffer.concat([Buffer.from(`${startLine}\r\n${headerLines}\r\n\r\n`), body]),
      {
        mode: 0o600
      },
      (writeError) => {
        if (writeError) {
          stderr.write(`[codexfree] raw capture write failed: ${writeError.message}\n`)
        }
      }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    stderr.write(`[codexfree] raw capture write failed: ${message}\n`)
  }
}

function formatRequestLine(options: RequestOptions): string {
  const method = options.method ?? 'GET'
  const path = options.path === undefined ? '/' : String(options.path)
  return `${method} ${path} HTTP/1.1`
}

function formatResponseLine(statusCode: number): string {
  const statusText = STATUS_CODES[statusCode] ?? 'Unknown'
  return `HTTP/1.1 ${statusCode} ${statusText}`
}

function serializeHeaders(
  headers: RequestOptions['headers'] | IncomingHttpHeaders | OutgoingHttpHeaders = {}
): string {
  if (Array.isArray(headers)) {
    return chunkRawHeaders(headers).join('\r\n')
  }

  return Object.entries(headers)
    .flatMap(([name, value]) => {
      if (Array.isArray(value)) {
        return value.map((item) => `${name}: ${item}`)
      }
      if (value === undefined) {
        return []
      }
      return [`${name}: ${value}`]
    })
    .join('\r\n')
}

function chunkRawHeaders(headers: readonly string[]): string[] {
  const lines: string[] = []
  for (let index = 0; index + 1 < headers.length; index += 2) {
    lines.push(`${headers[index]}: ${headers[index + 1]}`)
  }
  return lines
}

function readCaptureFile(path: string): string {
  const content = readFileSync(path)
  const text = content.toString('utf8')
  if (text.includes('\u0000')) {
    return content.toString('base64')
  }
  return text
}
