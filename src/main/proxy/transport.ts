import http, { type IncomingMessage, type RequestOptions } from 'node:http'
import https from 'node:https'
import type { Duplex } from 'node:stream'
import type { QuotaExhaustionEvent } from './quota'
import { appendSample, type createRawCapture } from './raw-capture'
import {
  analyzeResponseCreateFrame,
  createServerTextFrame,
  formatUpgradeResponse,
  observeUpstreamFrame,
  parseQuotaEventFromWebSocketChunk,
  safeSocketWrite
} from './transport-utils'
import { type CapturedWebSocketFrame, createWebSocketFrameRecorder } from './websocket-capture'

export interface UpgradeResult {
  statusCode?: number
  errorMessage?: string
}

type WebSocketLifecycleEventType =
  | 'upstream_connecting'
  | 'upstream_connected'
  | 'upstream_closed'
  | 'terminal_quota_forwarded'
  | 'quota_frame_suppressed'
  | 'quota_reconnect_requested'

export interface WebSocketLifecycleEvent {
  statusCode?: number
  type: WebSocketLifecycleEventType
}
type RawCapture = ReturnType<typeof createRawCapture>

export function forwardUpgradeRequest(
  options: RequestOptions,
  socket: Duplex,
  head: Buffer,
  rawCapture: RawCapture,
  maxPayloadBytes: number,
  onQuotaExhausted?: (event: QuotaExhaustionEvent) => void,
  onEarlyQuotaRetry?: (event: QuotaExhaustionEvent) => RequestOptions | undefined,
  onEarlyQuotaCannotReplay?: (event: QuotaExhaustionEvent) => boolean,
  onWebSocketFrame?: (frame: CapturedWebSocketFrame) => void,
  onLifecycle?: (event: WebSocketLifecycleEvent) => void
): Promise<UpgradeResult> {
  return new Promise((resolve) => {
    let currentOptions = options
    let settled = false
    let downstreamAccepted = false
    let activeAttemptId = 0
    const initialDownstreamHead = Buffer.from(head)
    const clientReplayChunks: Buffer[] = []
    let firstUpstreamAttempt = true
    const settle = (result: UpgradeResult) => {
      if (settled) {
        return
      }
      settled = true
      resolve(result)
    }
    const endAcceptedDownstream = () => {
      endDownstreamWithCompletion(socket)
    }

    const connect = () => {
      activeAttemptId += 1
      const attemptId = activeAttemptId
      const client = currentOptions.protocol === 'http:' ? http : https
      onLifecycle?.({ type: 'upstream_connecting' })
      const upstreamRequest = client.request(currentOptions)

      upstreamRequest.on('upgrade', (upstreamResponse, upstreamSocket, upstreamHead) => {
        if (attemptId !== activeAttemptId || settled) {
          upstreamSocket.destroy()
          return
        }
        onLifecycle?.({
          type: 'upstream_connected',
          statusCode: upstreamResponse.statusCode ?? 101
        })
        rawCapture?.writeUpgradeResponse(
          upstreamResponse.statusCode ?? 101,
          upstreamResponse.headers
        )
        const writeUpgradeResponse = !downstreamAccepted
        downstreamAccepted = true
        const downstreamHead = firstUpstreamAttempt
          ? initialDownstreamHead
          : Buffer.concat(clientReplayChunks)
        firstUpstreamAttempt = false
        pipeUpgradedSockets({
          downstreamHead,
          downstreamSocket: socket,
          maxPayloadBytes,
          onEarlyQuota: (event) => {
            const retryOptions = onEarlyQuotaRetry?.(event)
            if (!retryOptions) {
              return false
            }
            currentOptions = retryOptions
            activeAttemptId += 1
            queueMicrotask(connect)
            return true
          },
          onQuotaExhausted,
          onProbeConfirmed: () => undefined,
          onProbeStarted: (frame) => {
            clientReplayChunks.length = 0
            clientReplayChunks.push(Buffer.from(frame))
          },
          onProbeCannotReplayStarted: () => {
            clientReplayChunks.length = 0
          },
          onProbeCannotReplay: onEarlyQuotaCannotReplay,
          onProbeDownstreamChunk: (chunk) => clientReplayChunks.push(Buffer.from(chunk)),
          rawCapture,
          settle: () => settle({ statusCode: upstreamResponse.statusCode }),
          upstreamHead,
          upstreamResponse,
          upstreamSocket,
          onWebSocketFrame,
          onLifecycle,
          writeUpgradeResponse
        })
      })

      upstreamRequest.on('response', (upstreamResponse) => {
        let responseSample: Buffer<ArrayBufferLike> = Buffer.alloc(0)
        socket.on('error', () => upstreamRequest.destroy())
        if (!downstreamAccepted) {
          safeSocketWrite(
            socket,
            formatUpgradeResponse(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
          )
        }
        upstreamResponse.on('data', (chunk: Buffer) => {
          responseSample = appendSample(responseSample, chunk, maxPayloadBytes)
          if (!downstreamAccepted && !safeSocketWrite(socket, chunk)) {
            upstreamRequest.destroy()
          }
        })
        upstreamResponse.on('end', () => {
          if (attemptId !== activeAttemptId || settled) {
            return
          }
          rawCapture?.writeResponse(
            upstreamResponse.statusCode ?? 502,
            upstreamResponse.headers,
            responseSample
          )
          if (downstreamAccepted) {
            endAcceptedDownstream()
            settle({
              statusCode: upstreamResponse.statusCode,
              errorMessage: 'websocket_retry_http_failed'
            })
            return
          }
          if (!downstreamAccepted) {
            socket.end()
          }
          settle({ statusCode: upstreamResponse.statusCode })
        })
      })

      upstreamRequest.on('error', (error: Error) => {
        if (attemptId !== activeAttemptId || settled) {
          return
        }
        socket.destroy()
        settle({ errorMessage: error.message })
      })

      upstreamRequest.end()
    }

    connect()
  })
}

interface PipeUpgradedSocketsOptions {
  downstreamHead: Buffer
  downstreamSocket: Duplex
  maxPayloadBytes: number
  onEarlyQuota?: (event: QuotaExhaustionEvent) => boolean
  onProbeDownstreamChunk?: (chunk: Buffer) => void
  onProbeConfirmed?: () => void
  onProbeCannotReplay?: (event: QuotaExhaustionEvent) => boolean
  onProbeCannotReplayStarted?: () => void
  onProbeStarted?: (frame: Buffer) => void
  onQuotaExhausted?: (event: QuotaExhaustionEvent) => void
  onLifecycle?: (event: WebSocketLifecycleEvent) => void
  onWebSocketFrame?: (frame: CapturedWebSocketFrame) => void
  rawCapture: RawCapture
  settle: () => void
  upstreamHead: Buffer
  upstreamResponse: IncomingMessage
  upstreamSocket: Duplex
  writeUpgradeResponse: boolean
}

type WebSocketPipePhase = 'probing' | 'open' | 'retrying' | 'closing' | 'closed'

function pipeUpgradedSockets(options: PipeUpgradedSocketsOptions): void {
  let settled = false
  let cleaned = false
  let phase: WebSocketPipePhase =
    options.onEarlyQuota !== undefined || options.onQuotaExhausted !== undefined
      ? 'probing'
      : 'open'
  let observingUpstream = false
  let replayStartedFromFrame = false
  let pendingUpstreamFlush = false
  const upstreamBuffer: Buffer[] = []
  const cleanup = () => {
    if (cleaned) {
      return
    }
    cleaned = true
    options.upstreamSocket.off('error', onUpstreamError)
    options.downstreamSocket.off('error', onDownstreamError)
    options.upstreamSocket.off('data', onUpstreamData)
    options.downstreamSocket.off('data', onDownstreamData)
    options.downstreamSocket.off('close', onDownstreamClose)
    options.upstreamSocket.off('close', onUpstreamClose)
    options.downstreamSocket.off('end', onDownstreamEnd)
    options.upstreamSocket.off('end', onUpstreamEnd)
  }
  const settle = () => {
    if (settled) {
      return
    }
    settled = true
    phase = 'closed'
    cleanup()
    options.settle()
  }
  const closeUpstream = (): void => {
    phase = 'closing'
    options.upstreamSocket.destroy()
    settle()
  }
  const closeDownstream = (): void => {
    phase = 'closing'
    options.downstreamSocket.destroy()
    settle()
  }
  let lateProbeMode: 'none' | 'replay' | 'reconnect' = 'none'
  const retryWithNextAccount = (event: QuotaExhaustionEvent): boolean => {
    if (phase !== 'probing' || lateProbeMode !== 'replay' || !options.onEarlyQuota?.(event)) {
      return false
    }
    phase = 'retrying'
    upstreamBuffer.length = 0
    cleanup()
    options.upstreamSocket.destroy()
    return true
  }
  const handleCannotReplayQuota = (event: QuotaExhaustionEvent): void => {
    const hasReplacement = options.onProbeCannotReplay?.(event) ?? false
    if (!hasReplacement) {
      forwardTerminalQuotaEvent(event)
      return
    }
    phase = 'closing'
    upstreamBuffer.length = 0
    options.onLifecycle?.({ type: 'quota_reconnect_requested' })
    options.upstreamSocket.destroy()
    options.downstreamSocket.destroy()
    settle()
  }
  const startProbe = (probe: ReturnType<typeof analyzeResponseCreateFrame>): void => {
    if (!probe) {
      return
    }
    if (phase !== 'probing' && phase !== 'open') {
      return
    }
    if (phase === 'open') {
      upstreamBuffer.length = 0
      pendingUpstreamFlush = false
    }
    phase = 'probing'
    lateProbeMode = probe.replayable ? 'replay' : 'reconnect'
    replayStartedFromFrame = probe.replayable
    if (probe.replayable) {
      options.onProbeStarted?.(probe.rawFrame)
      return
    }
    options.onProbeCannotReplayStarted?.()
  }
  const flushUpstreamBuffer = () => {
    if (phase !== 'probing') {
      return
    }
    if (observingUpstream) {
      pendingUpstreamFlush = true
      return
    }
    phase = 'open'
    replayStartedFromFrame = false
    lateProbeMode = 'none'
    pendingUpstreamFlush = false
    options.onProbeConfirmed?.()
    for (const chunk of upstreamBuffer.splice(0)) {
      if (!safeSocketWrite(options.downstreamSocket, chunk)) {
        options.upstreamSocket.destroy()
        settle()
        return
      }
    }
  }
  function onUpstreamError(): void {
    closeDownstream()
  }
  function onDownstreamError(): void {
    closeUpstream()
  }
  function forwardTerminalQuotaEvent(event: QuotaExhaustionEvent): void {
    options.onQuotaExhausted?.(event)
    phase = 'closing'
    options.onLifecycle?.({ type: 'terminal_quota_forwarded' })
    for (const buffered of upstreamBuffer.splice(0)) {
      safeSocketWrite(options.downstreamSocket, buffered)
    }
    options.upstreamSocket.destroy()
    options.downstreamSocket.end()
    settle()
  }

  const upstreamFrames = createWebSocketFrameRecorder(
    options.rawCapture?.directory,
    'upstream-to-codex',
    options.maxPayloadBytes,
    {
      onFrame: (frame) => {
        observeUpstreamFrame({
          frame,
          flushProbe: flushUpstreamBuffer,
          onEarlyQuota: (event) => {
            if (lateProbeMode === 'reconnect') {
              handleCannotReplayQuota(event)
              return true
            }
            if (lateProbeMode === 'replay') {
              const retrying = retryWithNextAccount(event)
              if (!retrying) {
                forwardTerminalQuotaEvent(event)
              }
              return true
            }
            handleCannotReplayQuota(event)
            return true
          },
          onQuotaExhausted: (event) => {
            forwardTerminalQuotaEvent(event)
          }
        })
        options.onWebSocketFrame?.(frame)
      }
    }
  )
  const downstreamFrames = createWebSocketFrameRecorder(
    options.rawCapture?.directory,
    'codex-to-upstream',
    options.maxPayloadBytes,
    {
      onFrame: (frame) => {
        const probe = analyzeResponseCreateFrame(frame)
        startProbe(probe)
        options.onWebSocketFrame?.(frame)
      }
    }
  )
  const flushIfReady = (): void => {
    if (pendingUpstreamFlush && phase !== 'closing' && phase !== 'retrying') {
      flushUpstreamBuffer()
    }
    if (phase !== 'open') {
      return
    }
    for (const buffered of upstreamBuffer.splice(0)) {
      if (!safeSocketWrite(options.downstreamSocket, buffered)) {
        options.upstreamSocket.destroy()
        settle()
        return
      }
    }
  }
  function onUpstreamData(chunk: Buffer): void {
    upstreamBuffer.push(Buffer.from(chunk))
    const directQuotaEvent = parseQuotaEventFromWebSocketChunk(chunk)
    if (directQuotaEvent) {
      if (lateProbeMode === 'reconnect') {
        handleCannotReplayQuota(directQuotaEvent)
        return
      }
      if (lateProbeMode === 'replay') {
        if (!retryWithNextAccount(directQuotaEvent)) {
          forwardTerminalQuotaEvent(directQuotaEvent)
        }
        return
      }
      handleCannotReplayQuota(directQuotaEvent)
      return
    }
    observingUpstream = true
    upstreamFrames?.observe(chunk)
    observingUpstream = false
    flushIfReady()
  }
  function onDownstreamData(chunk: Buffer): void {
    forwardDownstreamChunk(chunk, true)
  }
  function forwardDownstreamChunk(chunk: Buffer, recordForReplay: boolean): void {
    downstreamFrames?.observe(chunk)
    if (
      recordForReplay &&
      phase === 'probing' &&
      lateProbeMode === 'replay' &&
      !replayStartedFromFrame
    ) {
      options.onProbeDownstreamChunk?.(Buffer.from(chunk))
    }
    replayStartedFromFrame = false
    if (!safeSocketWrite(options.upstreamSocket, chunk)) {
      options.downstreamSocket.destroy()
      settle()
    }
  }
  function onDownstreamClose(): void {
    closeUpstream()
  }
  function onDownstreamEnd(): void {
    closeUpstream()
  }
  function onUpstreamClose(): void {
    options.onLifecycle?.({ type: 'upstream_closed' })
    if (phase === 'retrying' || phase === 'closing' || phase === 'closed') {
      return
    }
    if (phase === 'probing' && !options.writeUpgradeResponse) {
      upstreamBuffer.length = 0
      endDownstreamWithCompletion(options.downstreamSocket)
      options.upstreamSocket.destroy()
      settle()
      return
    }
    for (const chunk of upstreamBuffer.splice(0)) {
      safeSocketWrite(options.downstreamSocket, chunk)
    }
    options.downstreamSocket.end()
    settle()
  }
  function onUpstreamEnd(): void {
    onUpstreamClose()
  }
  options.upstreamSocket.on('error', onUpstreamError)
  options.downstreamSocket.on('error', onDownstreamError)
  options.upstreamSocket.on('data', onUpstreamData)
  options.downstreamSocket.on('data', onDownstreamData)
  options.downstreamSocket.once('close', onDownstreamClose)
  options.upstreamSocket.once('close', onUpstreamClose)
  options.downstreamSocket.once('end', onDownstreamEnd)
  options.upstreamSocket.once('end', onUpstreamEnd)
  options.downstreamSocket.resume()
  options.upstreamSocket.resume()

  if (options.writeUpgradeResponse) {
    const wroteUpgradeResponse = safeSocketWrite(
      options.downstreamSocket,
      formatUpgradeResponse(
        options.upstreamResponse.statusCode ?? 101,
        options.upstreamResponse.headers
      )
    )
    if (!wroteUpgradeResponse) {
      closeUpstream()
      return
    }
  }
  if (options.upstreamHead.byteLength > 0) {
    onUpstreamData(options.upstreamHead)
  }
  if (options.downstreamHead.byteLength > 0) {
    forwardDownstreamChunk(options.downstreamHead, false)
  }
  if (!cleaned && (options.upstreamSocket.destroyed || options.upstreamSocket.readableEnded)) {
    onUpstreamClose()
  }
}

function endDownstreamWithCompletion(socket: Duplex): void {
  safeSocketWrite(socket, createServerTextFrame(JSON.stringify({ type: 'response.completed' })))
  socket.end()
  setTimeout(() => {
    if (!socket.destroyed) {
      socket.destroy()
    }
  }, 250).unref()
}
