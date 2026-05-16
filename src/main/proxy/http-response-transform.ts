import type { IncomingMessage } from 'node:http'
import { arrayField, isRecord, parseJsonRecord, stringField } from './json-utils'
import { isCodexModelsPath, isWhamUsagePath } from './path-utils'
import type { ForwardResult } from './transport-http'

export function shouldRewriteClientJsonResponse(path: string | undefined): boolean {
  return isWhamUsagePath(path) || isCodexModelsPath(path)
}

export function transformHttpResponseForClient(
  path: string | undefined,
  incomingAccountId: string | undefined,
  result: ForwardResult
): ForwardResult {
  if (!result.deferredBody || result.streaming || result.statusCode !== 200) {
    return result
  }
  const body = parseJsonRecord(result.deferredBody.toString('utf8'))
  if (!body) {
    return result
  }
  let transformed: Record<string, unknown> | undefined
  if (isWhamUsagePath(path)) {
    transformed = rewriteUsageResponse(body, incomingAccountId)
  } else if (isCodexModelsPath(path)) {
    transformed = rewriteModelsResponse(body)
  }
  if (!transformed) {
    return result
  }
  const deferredBody = Buffer.from(JSON.stringify(transformed))
  return {
    ...result,
    deferredBody,
    responseBytes: deferredBody.byteLength,
    responseHeaders: rewriteJsonHeaders(result.responseHeaders, deferredBody.byteLength),
    responseSample: deferredBody
  }
}

function rewriteUsageResponse(
  body: Record<string, unknown>,
  incomingAccountId: string | undefined
): Record<string, unknown> {
  const accountId =
    incomingAccountId ?? stringField(body, 'account_id') ?? stringField(body, 'user_id')
  return {
    ...body,
    user_id: accountId,
    account_id: accountId
  }
}

function rewriteModelsResponse(body: Record<string, unknown>): Record<string, unknown> | undefined {
  const models = arrayField(body, 'models')
  if (!models) {
    return undefined
  }
  return {
    ...body,
    models: models.map((model) => {
      if (!isRecord(model)) {
        return model
      }
      const slug = stringField(model, 'slug')
      const withDefaults = {
        ...model,
        service_tiers: [],
        additional_speed_tiers: []
      }
      if (slug !== 'gpt-5.5' && slug !== 'gpt-5.4') {
        return withDefaults
      }
      return {
        ...withDefaults,
        service_tiers: [
          {
            id: 'priority',
            name: 'Fast',
            description: '1.5x speed, increased usage'
          }
        ],
        additional_speed_tiers: ['fast']
      }
    })
  }
}

function rewriteJsonHeaders(
  headers: IncomingMessage['headers'] | undefined,
  contentLength: number
): IncomingMessage['headers'] {
  const rewritten = { ...(headers ?? {}) }
  delete rewritten['content-encoding']
  delete rewritten['transfer-encoding']
  rewritten['content-type'] = 'application/json'
  rewritten['content-length'] = String(contentLength)
  return rewritten
}
