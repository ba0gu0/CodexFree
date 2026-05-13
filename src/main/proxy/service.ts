import { mkdirSync } from 'node:fs'
import http, {
  type IncomingMessage,
  type RequestOptions,
  type ServerResponse,
  STATUS_CODES
} from 'node:http'
import https from 'node:https'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Duplex } from 'node:stream'
import { ProxyAgent } from 'proxy-agent'
import type { ProxyLedger } from './ledger'
import { appendSample, createRawCapture } from './raw-capture'
import {
  classifyRequest,
  createRequestId,
  fingerprint,
  firstHeaderValue,
  redactHeaders
} from './redaction'
import type { ProxyConfig, ProxyStatus, RequestLedgerEntry } from './types'

export class TransparentProxyService {
  private server?: http.Server
  private config: ProxyConfig
  private lastError?: string
  readonly rawCaptureDir: string

  constructor(
    initialConfig: ProxyConfig,
    private readonly ledger: ProxyLedger,
    private readonly log: {
      info: (message: string, data?: unknown) => void
      warn: (message: string, data?: unknown) => void
      error: (message: string, data?: unknown) => void
    }
  ) {
    this.config = initialConfig
    this.rawCaptureDir = join(tmpdir(), 'CodexFree', 'raw-captures')
    mkdirSync(this.rawCaptureDir, { recursive: true, mode: 0o700 })
  }

  async start(config = this.config): Promise<ProxyStatus> {
    await this.stop()
    this.config = config

    this.server = http.createServer((request, response) => {
      this.handleRequest(request, response).catch((error: unknown) => {
        this.lastError = error instanceof Error ? error.message : String(error)
        this.log.error('Transparent proxy request failed', { error: this.lastError })
        if (!response.headersSent) {
          response.writeHead(502, { 'content-type': 'application/json' })
        }
        response.end(JSON.stringify({ error: 'proxy_forward_failed' }))
      })
    })
    this.server.on('upgrade', (request, socket, head) => {
      this.handleUpgrade(request, socket, head).catch((error: unknown) => {
        this.lastError = error instanceof Error ? error.message : String(error)
        this.log.error('Transparent proxy upgrade failed', { error: this.lastError })
        socket.destroy()
      })
    })

    try {
      await new Promise<void>((resolve, reject) => {
        this.server?.once('error', reject)
        this.server?.listen(config.listenPort, config.listenHost, resolve)
      })
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      this.server = undefined
      throw error
    }

    this.lastError = undefined
    this.log.info('Transparent proxy started', this.status())
    return this.status()
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return
    }

    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
    this.server = undefined
  }

  status(): ProxyStatus {
    const address = this.server?.address()
    const host =
      typeof address === 'object' && address !== null
        ? normalizeDisplayHost(address)
        : this.config.listenHost
    const port =
      typeof address === 'object' && address !== null ? address.port : this.config.listenPort

    return {
      running: this.server?.listening ?? false,
      endpoint: `http://${host}:${port}/v1`,
      upstreamBaseUrl: this.config.upstreamBaseUrl,
      outboundMode: this.config.outboundProxy.mode,
      rawCaptureEnabled: this.config.rawCaptureEnabled,
      rawCaptureDir: this.rawCaptureDir,
      lastError: this.lastError
    }
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const startedAt = new Date()
    const requestId = createRequestId()
    const requestBody = await readRequestBody(request)
    const targetUrl = this.buildTargetUrl(request.url ?? '/')
    const rawCapture = createRawCapture(
      this.rawCaptureDir,
      requestId,
      this.config.rawCaptureEnabled,
      this.config.rawCaptureMaxBytes
    )
    rawCapture?.writeRequest(
      request.method ?? 'GET',
      request.url ?? '/',
      request.headers,
      requestBody
    )

    const authHeader = firstHeaderValue(request.headers.authorization)
    const cookieHeader = firstHeaderValue(request.headers.cookie)
    const accountId = firstHeaderValue(request.headers['chatgpt-account-id'])
    const conversationKey =
      firstHeaderValue(request.headers.thread_id) ??
      firstHeaderValue(request.headers.session_id) ??
      firstHeaderValue(request.headers['x-client-request-id'])
    const mode = classifyRequest(request.headers)
    const outboundMode = this.config.outboundProxy.mode
    const options = this.createRequestOptions(request, targetUrl)
    rawCapture?.writeOutboundRequest(options, requestBody)

    this.log.info('Forwarding Codex proxy request', {
      id: requestId,
      method: request.method,
      path: request.url,
      targetHost: targetUrl.host,
      outboundMode,
      headers: redactHeaders(request.headers)
    })

    const upstreamResult = await this.forward(options, requestBody, response, rawCapture)
    const completedAt = new Date()
    const entry: RequestLedgerEntry = {
      id: requestId,
      accountId,
      conversationKey,
      method: request.method ?? 'GET',
      path: request.url ?? '/',
      mode,
      outcome: upstreamResult.errorMessage ? 'failed' : 'forwarded',
      statusCode: upstreamResult.statusCode,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      requestBytes: requestBody.byteLength,
      responseBytes: upstreamResult.responseBytes,
      streaming: upstreamResult.streaming,
      upstreamHost: targetUrl.host,
      outboundMode,
      authHeaderPresent: authHeader !== undefined,
      cookieHeaderPresent: cookieHeader !== undefined,
      authFingerprint: fingerprint(authHeader),
      cookieFingerprint: fingerprint(cookieHeader),
      rawCapturePath: rawCapture?.directory,
      errorMessage: upstreamResult.errorMessage,
      startedAt,
      completedAt
    }
    this.ledger.insert(entry)
  }

  private async handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer
  ): Promise<void> {
    const startedAt = new Date()
    const requestId = createRequestId()
    const targetUrl = this.buildTargetUrl(request.url ?? '/')
    const rawCapture = createRawCapture(
      this.rawCaptureDir,
      requestId,
      this.config.rawCaptureEnabled,
      this.config.rawCaptureMaxBytes
    )
    rawCapture?.writeRequest(request.method ?? 'GET', request.url ?? '/', request.headers, head)

    const options = this.createRequestOptions(request, targetUrl)
    rawCapture?.writeOutboundRequest(options, head)
    const upstreamResult = await this.forwardUpgrade(options, socket, head, rawCapture)
    const completedAt = new Date()

    this.ledger.insert({
      id: requestId,
      accountId: firstHeaderValue(request.headers['chatgpt-account-id']),
      conversationKey:
        firstHeaderValue(request.headers.thread_id) ??
        firstHeaderValue(request.headers.session_id) ??
        firstHeaderValue(request.headers['x-client-request-id']),
      method: request.method ?? 'GET',
      path: request.url ?? '/',
      mode: classifyRequest(request.headers),
      outcome: upstreamResult.errorMessage ? 'failed' : 'forwarded',
      statusCode: upstreamResult.statusCode,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      requestBytes: head.byteLength,
      responseBytes: 0,
      streaming: true,
      upstreamHost: targetUrl.host,
      outboundMode: this.config.outboundProxy.mode,
      authHeaderPresent: request.headers.authorization !== undefined,
      cookieHeaderPresent: request.headers.cookie !== undefined,
      authFingerprint: fingerprint(firstHeaderValue(request.headers.authorization)),
      cookieFingerprint: fingerprint(firstHeaderValue(request.headers.cookie)),
      rawCapturePath: rawCapture?.directory,
      errorMessage: upstreamResult.errorMessage,
      startedAt,
      completedAt
    })
  }

  private buildTargetUrl(requestUrl: string): URL {
    const upstream = new URL(this.config.upstreamBaseUrl)
    const parsedRequest = new URL(requestUrl, 'http://codexfree.local')
    const requestPath = normalizeCodexPath(parsedRequest.pathname)
    const basePath = upstream.pathname === '/' ? '' : upstream.pathname.replace(/\/$/, '')
    upstream.pathname = `${basePath}${requestPath}`
    upstream.search = parsedRequest.search
    return upstream
  }

  private createRequestOptions(request: IncomingMessage, targetUrl: URL): RequestOptions {
    const headers = { ...request.headers, host: targetUrl.host }
    const agent =
      this.config.outboundProxy.mode === 'direct'
        ? undefined
        : new ProxyAgent({
            getProxyForUrl: () =>
              normalizeOutboundProxyUrl(
                this.config.outboundProxy.mode,
                this.config.outboundProxy.url
              )
          })

    return {
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      path: `${targetUrl.pathname}${targetUrl.search}`,
      method: request.method,
      headers,
      agent
    }
  }

  private forward(
    options: RequestOptions,
    requestBody: Buffer,
    response: ServerResponse,
    rawCapture: ReturnType<typeof createRawCapture>
  ): Promise<{
    statusCode?: number
    responseBytes: number
    streaming: boolean
    errorMessage?: string
  }> {
    return new Promise((resolve) => {
      const client = options.protocol === 'http:' ? http : https
      const upstreamRequest = client.request(options, (upstreamResponse) => {
        const headers = upstreamResponse.headers
        const contentType = firstHeaderValue(headers['content-type'])
        const streaming = contentType?.includes('text/event-stream') ?? false
        let responseBytes = 0
        let responseSample: Buffer<ArrayBufferLike> = Buffer.alloc(0)

        response.writeHead(upstreamResponse.statusCode ?? 502, headers)
        upstreamResponse.on('data', (chunk: Buffer) => {
          responseBytes += chunk.byteLength
          responseSample = appendSample(responseSample, chunk, this.config.rawCaptureMaxBytes)
          response.write(chunk)
        })
        upstreamResponse.on('end', () => {
          rawCapture?.writeResponse(upstreamResponse.statusCode ?? 502, headers, responseSample)
          response.end()
          resolve({ statusCode: upstreamResponse.statusCode, responseBytes, streaming })
        })
      })

      upstreamRequest.on('upgrade', (upstreamResponse, upstreamSocket, head) => {
        const downstreamSocket = response.socket
        if (!downstreamSocket) {
          upstreamSocket.destroy()
          resolve({
            responseBytes: 0,
            streaming: true,
            errorMessage: 'websocket_downstream_socket_missing'
          })
          return
        }

        downstreamSocket.write(
          formatUpgradeResponse(upstreamResponse.statusCode ?? 101, upstreamResponse.headers)
        )
        if (head.byteLength > 0) {
          downstreamSocket.write(head)
        }
        upstreamSocket.pipe(downstreamSocket)
        downstreamSocket.pipe(upstreamSocket)
        upstreamSocket.once('close', () => {
          resolve({
            statusCode: upstreamResponse.statusCode,
            responseBytes: 0,
            streaming: true
          })
        })
      })

      upstreamRequest.on('error', (error: Error) => {
        if (!response.headersSent) {
          response.writeHead(502, { 'content-type': 'application/json' })
        }
        response.end(JSON.stringify({ error: 'proxy_forward_failed' }))
        resolve({
          responseBytes: 0,
          streaming: false,
          errorMessage: error.message
        })
      })
      upstreamRequest.end(requestBody)
    })
  }

  private forwardUpgrade(
    options: RequestOptions,
    socket: Duplex,
    head: Buffer,
    rawCapture: ReturnType<typeof createRawCapture>
  ): Promise<{ statusCode?: number; errorMessage?: string }> {
    return new Promise((resolve) => {
      const client = options.protocol === 'http:' ? http : https
      const upstreamRequest = client.request(options)

      upstreamRequest.on('upgrade', (upstreamResponse, upstreamSocket, upstreamHead) => {
        rawCapture?.writeUpgradeResponse(
          upstreamResponse.statusCode ?? 101,
          upstreamResponse.headers
        )
        socket.write(
          formatUpgradeResponse(upstreamResponse.statusCode ?? 101, upstreamResponse.headers)
        )
        if (upstreamHead.byteLength > 0) {
          socket.write(upstreamHead)
        }
        if (head.byteLength > 0) {
          upstreamSocket.write(head)
        }
        upstreamSocket.pipe(socket)
        socket.pipe(upstreamSocket)
        upstreamSocket.once('close', () => resolve({ statusCode: upstreamResponse.statusCode }))
      })

      upstreamRequest.on('response', (upstreamResponse) => {
        let responseSample: Buffer<ArrayBufferLike> = Buffer.alloc(0)
        socket.write(
          formatUpgradeResponse(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
        )
        upstreamResponse.on('data', (chunk: Buffer) => {
          responseSample = appendSample(responseSample, chunk, this.config.rawCaptureMaxBytes)
          socket.write(chunk)
        })
        upstreamResponse.on('end', () => {
          rawCapture?.writeResponse(
            upstreamResponse.statusCode ?? 502,
            upstreamResponse.headers,
            responseSample
          )
          socket.end()
          resolve({ statusCode: upstreamResponse.statusCode })
        })
      })

      upstreamRequest.on('error', (error: Error) => {
        socket.destroy()
        resolve({ errorMessage: error.message })
      })

      upstreamRequest.end()
    })
  }
}

function normalizeDisplayHost(address: AddressInfo): string {
  if (address.address === '::' || address.address === '0.0.0.0') {
    return '127.0.0.1'
  }

  return address.address
}

function normalizeCodexPath(pathname: string): string {
  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`
  if (normalized === '/v1') {
    return ''
  }
  if (normalized.startsWith('/v1/')) {
    return normalized.slice(3)
  }
  return normalized
}

function normalizeOutboundProxyUrl(mode: string, value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`Outbound proxy URL is required for ${mode} mode`)
  }
  if (trimmed.includes('://')) {
    return trimmed
  }
  return `${mode}://${trimmed}`
}

function formatUpgradeResponse(statusCode: number, headers: IncomingMessage['headers']): string {
  const statusText = STATUS_CODES[statusCode] ?? 'Connection Established'
  const headerLines = Object.entries(headers).flatMap(([name, value]) => {
    if (Array.isArray(value)) {
      return value.map((item) => `${name}: ${item}`)
    }
    if (value === undefined) {
      return []
    }
    return [`${name}: ${value}`]
  })
  return [`HTTP/1.1 ${statusCode} ${statusText}`, ...headerLines, '', ''].join('\r\n')
}

function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })
}
