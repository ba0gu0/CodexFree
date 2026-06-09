import {
  arrayField,
  decodeBodyBuffer,
  isRecord,
  numberField,
  parseJsonRecord,
  recordField,
  stringField,
  truncateForLog
} from './json-utils'
import type { ProtocolMessageInput, TurnSummaryInput } from './ledger-types'
import { shouldPersistProtocolSummary } from './protocol-summary'

export interface SseSummaryInput {
  accountId?: string
  conversationKey?: string
  path: string
  requestBody: Buffer
  requestBodyEncoding?: string
  requestId: string
  responseBody: Buffer | undefined
}

export interface SseSummaryResult {
  messages: ProtocolMessageInput[]
  turnSummary?: TurnSummaryInput
}

export function summarizeServerSentEvents(input: SseSummaryInput): SseSummaryResult {
  const request = parseJsonRecord(
    decodeBodyBuffer(input.requestBody, input.requestBodyEncoding).toString('utf8')
  )
  const messages: ProtocolMessageInput[] = []
  const turnKey = [input.conversationKey, input.requestId].filter(Boolean).join(':')
  const userText = extractUserText(request)
  const previousResponseId = stringField(request, 'previous_response_id')
  const model = stringField(request, 'model')
  let assistantText: string | undefined
  let responseId: string | undefined
  let status: string | undefined
  let usage: UsageFields = {}
  let toolCallCount = 0
  let toolResultCount = 0

  for (const event of parseSseEvents(input.responseBody?.toString('utf8') ?? '')) {
    const payload = parseJsonRecord(event.data)
    if (!payload) {
      continue
    }
    const summary = summarizeSsePayload({
      accountId: input.accountId,
      conversationKey: input.conversationKey,
      event: event.event,
      path: input.path,
      payload,
      requestId: input.requestId
    })
    if (!summary) {
      continue
    }
    if (shouldPersistProtocolSummary(summary)) {
      messages.push(summary)
    }
    responseId = summary.responseId ?? responseId
    if (summary.kind === 'assistant') {
      assistantText = stripPrefix(summary.text, 'AI 回复: ') || assistantText
    } else if (summary.kind === 'usage') {
      status = stringField(recordField(payload, 'response'), 'status') ?? status ?? 'completed'
      if (summary.text.startsWith('AI 回复: ')) {
        assistantText = stripPrefix(summary.text, 'AI 回复: ') || assistantText
      }
      usage = {
        cachedInputTokens: summary.cachedInputTokens,
        inputTokens: summary.inputTokens,
        outputTokens: summary.outputTokens,
        reasoningTokens: summary.reasoningTokens,
        totalTokens: summary.totalTokens
      }
    } else if (
      summary.kind === 'tool_call' &&
      summary.protocolType === 'response.output_item.added'
    ) {
      toolCallCount += 1
    } else if (summary.kind === 'tool_result') {
      toolResultCount += 1
    } else if (summary.kind === 'error') {
      status = 'error'
    }
  }

  return {
    messages,
    turnSummary: {
      accountId: input.accountId,
      assistantText,
      conversationKey: input.conversationKey,
      parentResponseId: previousResponseId,
      requestId: input.requestId,
      responseId,
      status,
      summaryJson: safeSummaryJson({ model, responseId, status, toolCallCount, toolResultCount }),
      toolCallDelta: toolCallCount,
      toolResultDelta: toolResultCount,
      turnKey,
      userText,
      ...usage
    }
  }
}

interface ParsedSseEvent {
  data: string
  event?: string
}

interface SsePayloadInput {
  accountId?: string
  conversationKey?: string
  event?: string
  path: string
  payload: Record<string, unknown>
  requestId: string
}

interface UsageFields {
  cachedInputTokens?: number
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  totalTokens?: number
}

function summarizeSsePayload(input: SsePayloadInput): ProtocolMessageInput | undefined {
  const type = stringField(input.payload, 'type') ?? input.event ?? 'message'
  const base = {
    accountId: input.accountId,
    conversationKey: input.conversationKey,
    direction: 'upstream-to-codex',
    path: input.path,
    protocolType: type,
    requestId: input.requestId,
    responseId: stringField(input.payload, 'response_id'),
    sequenceNumber: numberField(input.payload, 'sequence_number'),
    summaryJson: safeSummaryJson({ event: input.event, type })
  }
  if (type === 'response.created' || type === 'response.create') {
    const response = recordField(input.payload, 'response')
    return {
      ...base,
      kind: 'response_started',
      model: stringField(response, 'model'),
      responseId: stringField(response, 'id') ?? base.responseId,
      text: `AI 开始响应: ${stringField(response, 'id') ?? 'unknown'}`
    }
  }
  if (type === 'response.completed') {
    const response = recordField(input.payload, 'response')
    const usage = recordField(response, 'usage')
    const outputText = responseOutputText(response)
    return {
      ...base,
      cachedInputTokens: numberField(recordField(usage, 'input_tokens_details'), 'cached_tokens'),
      inputTokens: numberField(usage, 'input_tokens'),
      kind: 'usage',
      model: stringField(response, 'model'),
      outputTokens: numberField(usage, 'output_tokens'),
      reasoningTokens: numberField(recordField(usage, 'output_tokens_details'), 'reasoning_tokens'),
      responseId: stringField(response, 'id') ?? base.responseId,
      text: outputText
        ? truncateForLog(`AI 回复: ${outputText}`)
        : tokenUsageText(stringField(response, 'status'), usage),
      totalTokens: numberField(usage, 'total_tokens')
    }
  }
  if (type === 'response.output_text.done') {
    const text = stringField(input.payload, 'text') ?? ''
    return {
      ...base,
      itemId: stringField(input.payload, 'item_id') ?? stringField(input.payload, 'output_index'),
      kind: 'assistant',
      text: truncateForLog(`AI 回复: ${text}`)
    }
  }
  const item = recordField(input.payload, 'item')
  const itemType = stringField(item, 'type')
  const itemId = stringField(item, 'id') ?? stringField(input.payload, 'item_id')
  if (type === 'item.completed' && itemType === 'agent_message') {
    return {
      ...base,
      itemId,
      kind: 'assistant',
      text: truncateForLog(`AI 回复: ${stringField(item, 'text') ?? ''}`)
    }
  }
  if (type === 'response.output_item.added' && itemType?.includes('call')) {
    return toolMessage(input, 'tool_call', '工具调用', item, 'started')
  }
  if (type.endsWith('function_call_arguments.done')) {
    return toolMessage(input, 'tool_call', '工具参数', undefined, 'arguments')
  }
  if (type.endsWith('custom_tool_call_input.done')) {
    return toolMessage(input, 'tool_call', '工具参数', undefined, 'arguments')
  }
  if (
    (type === 'response.output_item.done' || type === 'response.output_item.completed') &&
    itemType?.includes('call')
  ) {
    return toolMessage(input, 'tool_result', '工具结果', item, 'completed')
  }
  if (type === 'error') {
    const error = recordField(input.payload, 'error')
    const errorType = stringField(error, 'type') ?? 'error'
    const message = stringField(error, 'message') ?? stringField(input.payload, 'message')
    return {
      ...base,
      kind: 'error',
      text: truncateForLog(`错误: ${errorType}${message ? ` ${message}` : ''}`)
    }
  }
  return undefined
}

function toolMessage(
  input: SsePayloadInput,
  kind: 'tool_call' | 'tool_result',
  label: string,
  item: Record<string, unknown> | undefined,
  phase: string
): ProtocolMessageInput {
  const itemId = stringField(item, 'id') ?? stringField(input.payload, 'item_id')
  const callId = stringField(item, 'call_id') ?? stringField(input.payload, 'call_id') ?? itemId
  const name =
    stringField(item, 'name') ??
    stringField(item, 'tool_name') ??
    stringField(input.payload, 'name') ??
    'unknown_tool'
  const args = describeArguments(
    stringField(input.payload, 'arguments') ??
      stringField(input.payload, 'input') ??
      stringField(item, 'arguments')
  )
  return {
    accountId: input.accountId,
    callId,
    conversationKey: input.conversationKey,
    direction: 'upstream-to-codex',
    itemId,
    kind,
    path: input.path,
    protocolType: stringField(input.payload, 'type') ?? input.event,
    requestId: input.requestId,
    responseId: stringField(input.payload, 'response_id') ?? stringField(item, 'response_id'),
    summaryJson: safeSummaryJson({ callId, itemId, name, phase }),
    text: truncateForLog(`${label}: ${name}${args ? ` 参数: ${args}` : ''}`)
  }
}

function parseSseEvents(text: string): ParsedSseEvent[] {
  const events: ParsedSseEvent[] = []
  let event: string | undefined
  const data: string[] = []
  const flush = (): void => {
    if (data.length > 0) {
      const joined = data.join('\n')
      if (joined !== '[DONE]') {
        events.push({ data: joined, event })
      }
    }
    event = undefined
    data.length = 0
  }
  for (const line of text.split(/\r?\n/)) {
    if (line === '') {
      flush()
    } else if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim()
    } else if (line.startsWith('data:')) {
      data.push(line.slice('data:'.length).trim())
    }
  }
  flush()
  return events
}

function tokenUsageText(
  status: string | undefined,
  usage: Record<string, unknown> | undefined
): string {
  return [
    `Token统计: status=${status ?? 'unknown'}`,
    `input=${numberField(usage, 'input_tokens') ?? 'unknown'}`,
    `cached=${numberField(recordField(usage, 'input_tokens_details'), 'cached_tokens') ?? 'unknown'}`,
    `output=${numberField(usage, 'output_tokens') ?? 'unknown'}`,
    `reasoning=${
      numberField(recordField(usage, 'output_tokens_details'), 'reasoning_tokens') ?? 'unknown'
    }`,
    `total=${numberField(usage, 'total_tokens') ?? 'unknown'}`
  ].join(' ')
}

function responseOutputText(response: Record<string, unknown> | undefined): string | undefined {
  return arrayField(response, 'output')
    ?.flatMap((item) => collectTextValues(item))
    .join('\n')
}

function extractUserText(payload: Record<string, unknown> | undefined): string | undefined {
  const input = payload?.input
  if (typeof input === 'string') {
    return input
  }
  if (!Array.isArray(input)) {
    return undefined
  }
  const userItems = input.filter((item) => isRecord(item) && stringField(item, 'role') === 'user')
  const source = userItems.length > 0 ? userItems : input
  return source.flatMap((item) => collectTextValues(item)).at(-1)
}

function collectTextValues(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value]
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectTextValues(item))
  }
  if (!isRecord(value)) {
    return []
  }
  return Object.entries(value).flatMap(([key, child]) =>
    key === 'text' || key === 'content' || key === 'output' ? collectTextValues(child) : []
  )
}

function describeArguments(value: string | undefined): string | undefined {
  if (!value) {
    return undefined
  }
  const parsed = parseJsonRecord(value)
  if (!parsed) {
    return value
  }
  return (
    stringField(parsed, 'cmd') ??
    stringField(parsed, 'command') ??
    stringField(parsed, 'query') ??
    Object.entries(parsed)
      .slice(0, 3)
      .map(([key, child]) => `${key}=${typeof child === 'string' ? child : JSON.stringify(child)}`)
      .join(' ')
  )
}

function stripPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value
}

function safeSummaryJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return JSON.stringify({ text: String(value) })
  }
}
