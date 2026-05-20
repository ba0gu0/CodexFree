import {
  arrayField,
  isRecord,
  numberField,
  parseJsonRecord,
  recordField,
  stringField,
  truncateForLog
} from './json-utils'
import type { CapturedWebSocketFrame } from './websocket-capture'

export interface WebSocketSummary {
  cachedInputTokens?: number
  callId?: string
  inputItemCount?: number
  inputTokens?: number
  itemId?: string
  kind: string
  model?: string
  outputTokens?: number
  parentResponseId?: string
  payloadBytes?: number
  previousResponseId?: string
  protocolType?: string
  reasoningTokens?: number
  responseId?: string
  sequenceNumber?: number
  summaryJson?: string
  text: string
  tool?: WebSocketToolUpdate
  toolCount?: number
  totalTokens?: number
  truncated?: boolean
}

export interface WebSocketToolUpdate {
  arguments?: string
  name?: string
  phase: 'started' | 'arguments' | 'completed'
  result?: string
  resultCount?: number
}

export interface ToolCallState {
  arguments?: string
  name?: string
  result?: string
  resultCount?: number
}

export function summarizeWebSocketFrame(
  frame: CapturedWebSocketFrame
): WebSocketSummary | undefined {
  if (frame.opcode === 'ping') {
    return { kind: 'heartbeat', text: '上游发送 ping 保活' }
  }
  if (frame.opcode === 'pong') {
    return { kind: 'heartbeat', text: '上游返回 pong 保活' }
  }
  if (frame.opcode !== 'text' || !frame.payloadText) {
    return undefined
  }

  const payload = parseJsonRecord(frame.payloadText)
  if (!payload) {
    return undefined
  }

  const type = stringField(payload, 'type') ?? 'message'
  const base = summaryBase(frame, payload, type)
  if (frame.direction === 'upstream-to-codex' && type === 'response.created') {
    const response = recordField(payload, 'response')
    const responseId = stringField(response, 'id') ?? stringField(payload, 'response_id')
    return {
      ...base,
      kind: 'response_started',
      model: stringField(response, 'model'),
      responseId,
      summaryJson: safeSummaryJson({ responseId, type }),
      text: `AI 开始响应: ${responseId ?? 'unknown'}`
    }
  }
  if (type.endsWith('.delta') || type.endsWith('.in_progress')) {
    return undefined
  }
  if (frame.direction === 'codex-to-upstream' && type === 'response.create') {
    const message = extractUserText(payload)
    const model = stringField(payload, 'model')
    const input = arrayField(payload, 'input')
    const previousResponseId = stringField(payload, 'previous_response_id')
    const toolCount = arrayField(payload, 'tools')?.length
    const reasoning = recordField(payload, 'reasoning')
    const effort = stringField(reasoning, 'effort')
    const text = message ? `用户请求: ${message}` : `发起模型请求: ${model ?? 'unknown'}`
    return {
      ...base,
      inputItemCount: input?.length,
      kind: 'user',
      model,
      previousResponseId,
      parentResponseId: previousResponseId,
      text: truncateForLog(text),
      toolCount,
      summaryJson: safeSummaryJson({
        inputItemCount: input?.length,
        model,
        previousResponseId,
        toolCount,
        userText: message
      }),
      ...(effort ? { protocolType: `${type}:reasoning=${effort}` } : {})
    }
  }

  if (type === 'response.completed') {
    const response = recordField(payload, 'response')
    const usage = recordField(response, 'usage')
    const responseId = stringField(response, 'id')
    const parentResponseId =
      stringField(response, 'previous_response_id') ?? stringField(payload, 'previous_response_id')
    const status = stringField(response, 'status')
    const model = stringField(response, 'model')
    return {
      ...base,
      cachedInputTokens: numberField(recordField(usage, 'input_tokens_details'), 'cached_tokens'),
      inputTokens: numberField(usage, 'input_tokens'),
      kind: 'usage',
      model,
      outputTokens: numberField(usage, 'output_tokens'),
      parentResponseId,
      reasoningTokens: numberField(recordField(usage, 'output_tokens_details'), 'reasoning_tokens'),
      responseId,
      summaryJson: safeSummaryJson({ model, responseId, status, usage }),
      text: tokenUsageText(status, usage),
      totalTokens: numberField(usage, 'total_tokens')
    }
  }

  if (type === 'codex.rate_limits') {
    const plan = stringField(payload, 'plan_type') ?? 'unknown'
    const credits = recordField(payload, 'credits')
    const balance = stringField(credits, 'balance') ?? numberField(credits, 'balance')
    return {
      ...base,
      kind: 'rate_limit',
      text: truncateForLog(`额度状态: plan=${plan} credits=${balance ?? 'unknown'}`)
    }
  }

  const item = recordField(payload, 'item')
  const itemType = item ? stringField(item, 'type') : undefined
  const itemId = item ? stringField(item, 'id') : stringField(payload, 'item_id')
  if (type === 'item.completed' && itemType === 'agent_message') {
    return {
      ...base,
      itemId,
      kind: 'assistant',
      responseId: stringField(item, 'response_id') ?? stringField(payload, 'response_id'),
      parentResponseId: stringField(item, 'parent_response_id'),
      summaryJson: safeSummaryJson({ itemId, text: stringField(item, 'text') }),
      text: truncateForLog(`AI 回复: ${stringField(item, 'text') ?? ''}`)
    }
  }
  if (type === 'response.output_text.done') {
    return {
      ...base,
      itemId: stringField(payload, 'output_index') ?? itemId,
      kind: 'assistant',
      responseId: stringField(payload, 'response_id'),
      summaryJson: safeSummaryJson({ itemId, text: stringField(payload, 'text') }),
      text: truncateForLog(`AI 回复: ${stringField(payload, 'text') ?? ''}`)
    }
  }
  if (type === 'response.output_item.added' && itemType?.includes('call')) {
    return {
      ...base,
      callId: callIdFromPayload(payload, item),
      itemId,
      kind: 'tool_call',
      responseId: stringField(payload, 'response_id') ?? stringField(item, 'response_id'),
      summaryJson: safeSummaryJson({ itemId, itemType, phase: 'started' }),
      text: '',
      tool: toolUpdateFromItem('started', item, itemType)
    }
  }
  if (type.endsWith('function_call_arguments.done')) {
    return {
      ...base,
      callId: callIdFromPayload(payload, undefined),
      itemId,
      kind: 'tool_call',
      responseId: stringField(payload, 'response_id'),
      summaryJson: safeSummaryJson({ itemId, phase: 'arguments' }),
      text: '',
      tool: { arguments: describeArguments(stringField(payload, 'arguments')), phase: 'arguments' }
    }
  }
  if (type.endsWith('custom_tool_call_input.done')) {
    return {
      ...base,
      callId: callIdFromPayload(payload, undefined),
      itemId,
      kind: 'tool_call',
      responseId: stringField(payload, 'response_id'),
      summaryJson: safeSummaryJson({ itemId, phase: 'arguments' }),
      text: '',
      tool: { arguments: describeArguments(stringField(payload, 'input')), phase: 'arguments' }
    }
  }
  if (
    (type === 'response.output_item.done' || type === 'response.output_item.completed') &&
    itemType?.includes('call')
  ) {
    return {
      ...base,
      callId: callIdFromPayload(payload, item),
      itemId,
      kind: 'tool_result',
      responseId: stringField(payload, 'response_id') ?? stringField(item, 'response_id'),
      summaryJson: safeSummaryJson({ itemId, itemType, phase: 'completed' }),
      text: '',
      tool: toolUpdateFromItem('completed', item, itemType)
    }
  }
  if (type === 'error') {
    const error = recordField(payload, 'error')
    const errorType = stringField(error, 'type') ?? type
    const message = stringField(error, 'message') ?? stringField(payload, 'message')
    return {
      ...base,
      kind: 'error',
      text: truncateForLog(`错误: ${errorType}${message ? ` ${message}` : ''}`)
    }
  }

  return undefined
}

function summaryBase(
  frame: CapturedWebSocketFrame,
  payload: Record<string, unknown>,
  type: string
): Partial<WebSocketSummary> {
  return {
    payloadBytes: frame.payloadBytes,
    protocolType: type,
    parentResponseId: stringField(payload, 'parent_response_id'),
    responseId: stringField(payload, 'response_id'),
    sequenceNumber: numberField(payload, 'sequence_number'),
    truncated: frame.truncated
  }
}

function tokenUsageText(
  status: string | undefined,
  usage: Record<string, unknown> | undefined
): string {
  const inputTokens = numberField(usage, 'input_tokens')
  const cachedTokens = numberField(recordField(usage, 'input_tokens_details'), 'cached_tokens')
  const outputTokens = numberField(usage, 'output_tokens')
  const reasoningTokens = numberField(
    recordField(usage, 'output_tokens_details'),
    'reasoning_tokens'
  )
  const totalTokens = numberField(usage, 'total_tokens')
  return [
    `Token统计: status=${status ?? 'unknown'}`,
    `input=${inputTokens ?? 'unknown'}`,
    `cached=${cachedTokens ?? 'unknown'}`,
    `output=${outputTokens ?? 'unknown'}`,
    `reasoning=${reasoningTokens ?? 'unknown'}`,
    `total=${totalTokens ?? 'unknown'}`
  ].join(' ')
}

function toolUpdateFromItem(
  phase: WebSocketToolUpdate['phase'],
  item: Record<string, unknown> | undefined,
  fallback: string
): WebSocketToolUpdate {
  return {
    arguments: describeToolArguments(item),
    name: toolNameFromItem(item, fallback),
    phase,
    result: describeToolResult(item),
    resultCount: countToolResults(item)
  }
}

function extractUserText(payload: Record<string, unknown>): string | undefined {
  const input = payload.input
  if (typeof input === 'string') {
    return input
  }
  if (Array.isArray(input)) {
    const userItems = input.filter((item) => isRecord(item) && stringField(item, 'role') === 'user')
    const source = userItems.length > 0 ? userItems : input
    return source.flatMap((item) => collectTextValues(item)).at(-1)
  }
  return undefined
}

function toolNameFromItem(item: Record<string, unknown> | undefined, fallback: string): string {
  return (
    stringField(item, 'name') ??
    stringField(item, 'tool_name') ??
    stringField(item, 'type') ??
    stringField(item, 'call_id') ??
    fallback
  )
}

function describeToolArguments(item: Record<string, unknown> | undefined): string | undefined {
  if (!item) {
    return undefined
  }
  const action = recordField(item, 'action')
  const query =
    stringField(action, 'query') ??
    stringField(item, 'query') ??
    stringField(item, 'input') ??
    stringField(item, 'arguments')
  return query ? describeArguments(query) : undefined
}

function describeToolResult(item: Record<string, unknown> | undefined): string | undefined {
  return (
    stringField(item, 'output') ??
    stringField(item, 'result') ??
    stringField(item, 'status') ??
    stringField(recordField(item, 'result'), 'status')
  )
}

function countToolResults(item: Record<string, unknown> | undefined): number | undefined {
  const results =
    arrayField(item, 'results') ??
    arrayField(item, 'search_results') ??
    arrayField(recordField(item, 'result'), 'results')
  return results?.length
}

function callIdFromPayload(
  payload: Record<string, unknown>,
  item: Record<string, unknown> | undefined
): string | undefined {
  return (
    stringField(payload, 'call_id') ??
    stringField(payload, 'item_id') ??
    stringField(item, 'call_id') ??
    stringField(item, 'id')
  )
}

function safeSummaryJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return JSON.stringify({ text: String(value) })
  }
}

function describeArguments(argumentsText: string | undefined): string {
  if (!argumentsText) {
    return '无参数'
  }

  const parsed = parseJsonRecord(argumentsText)
  if (!parsed) {
    return argumentsText
  }

  const command =
    stringField(parsed, 'cmd') ??
    stringField(parsed, 'command') ??
    stringField(parsed, 'shell_command') ??
    stringField(parsed, 'input')
  if (command) {
    return command
  }

  const path =
    stringField(parsed, 'path') ?? stringField(parsed, 'file') ?? stringField(parsed, 'cwd')
  if (path) {
    return path
  }

  return Object.entries(parsed)
    .slice(0, 3)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' ')
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
    key === 'text' || key === 'content' ? collectTextValues(child) : []
  )
}
