import http, { type IncomingMessage, type RequestOptions } from 'node:http'
import https from 'node:https'
import { appendSample, type createRawCapture } from './raw-capture'
import { firstHeaderValue } from './redaction'
import { safeResponseWrite } from './transport-utils'

export interface ForwardResult {
  statusCode?: number
  deferredBody?: Buffer
  responseHeaders?: IncomingMessage['headers']
  responseSample?: Buffer
  responseBytes: number
  streaming: boolean
  errorMessage?: string
}

type RawCapture = ReturnType<typeof createRawCapture>

export function forwardHttpRequest(
  options: RequestOptions,
  requestBody: Buffer,
  response: http.ServerResponse,
  rawCapture: RawCapture,
  maxPayloadBytes: number,
  deferResponse = false
): Promise<ForwardResult> {
  return new Promise((resolve) => {
    const client = options.protocol === 'http:' ? http : https
    let resolved = false
    const finish = (result: ForwardResult) => {
      if (resolved) {
        return
      }
      resolved = true
      resolve(result)
    }
    const upstreamRequest = client.request(options, (upstreamResponse) => {
      const headers = upstreamResponse.headers
      const contentType = firstHeaderValue(headers['content-type'])
      const streaming = contentType?.includes('text/event-stream') ?? false
      let responseBytes = 0
      const responseChunks: Buffer[] = []
      let responseSample: Buffer<ArrayBufferLike> = Buffer.alloc(0)

      if (!deferResponse || streaming) {
        response.writeHead(upstreamResponse.statusCode ?? 502, headers)
      }
      upstreamResponse.on('data', (chunk: Buffer) => {
        responseBytes += chunk.byteLength
        responseSample = appendSample(responseSample, chunk, maxPayloadBytes)
        if (deferResponse && !streaming) {
          responseChunks.push(Buffer.from(chunk))
          return
        }
        if (!safeResponseWrite(response, chunk)) {
          upstreamRequest.destroy()
        }
      })
      upstreamResponse.on('end', () => {
        const deferredBody = deferResponse && !streaming ? Buffer.concat(responseChunks) : undefined
        rawCapture?.writeResponse(
          upstreamResponse.statusCode ?? 502,
          headers,
          deferredBody ?? responseSample
        )
        if (!deferredBody) {
          response.end()
        }
        finish({
          statusCode: upstreamResponse.statusCode,
          deferredBody,
          responseHeaders: headers,
          responseSample,
          responseBytes,
          streaming
        })
      })
    })

    upstreamRequest.on('socket', (upstreamSocket) => {
      upstreamSocket.on('error', () => undefined)
    })
    upstreamRequest.on('error', (error: Error) => {
      const body = Buffer.from(JSON.stringify({ error: 'proxy_forward_failed' }))
      if (!response.headersSent) {
        response.writeHead(502, { 'content-type': 'application/json' })
      }
      if (!response.destroyed && response.writable) {
        response.end(body)
      }
      finish({
        statusCode: 502,
        responseSample: body,
        responseHeaders: { 'content-type': 'application/json' },
        responseBytes: body.byteLength,
        streaming: false,
        errorMessage: error.message
      })
    })
    upstreamRequest.end(requestBody)
  })
}
