import type {
  ProtocolMessage,
  ProxyLogEvent,
  RecentRequest,
  TurnSummary
} from '@renderer/data/proxy-console'

export interface RequestTimelineIndex {
  eventsByConversation: Map<string, ProxyLogEvent[]>
  eventsByRequest: Map<string, ProxyLogEvent[]>
  messageIdsInTurns: Set<string>
  messagesByConversation: Map<string, ProtocolMessage[]>
  messagesByRequest: Map<string, ProtocolMessage[]>
  messagesByTurnId: Map<string, ProtocolMessage[]>
  requestConversations: Set<string>
  requestIds: Set<string>
  turnRequestIds: Set<string>
  turnsByConversation: Map<string, TurnSummary[]>
  turnsByRequest: Map<string, TurnSummary[]>
}

export function createRequestTimelineIndex(
  requests: RecentRequest[],
  events: ProxyLogEvent[],
  messages: ProtocolMessage[],
  turns: TurnSummary[]
): RequestTimelineIndex {
  const messageTurnIndex = indexMessagesByTurn(messages, turns)
  return {
    eventsByConversation: groupByConversationKey(events),
    eventsByRequest: groupByRequestId(events),
    messageIdsInTurns: messageTurnIndex.messageIds,
    messagesByConversation: groupByConversationKey(messages),
    messagesByRequest: groupByRequestId(messages),
    messagesByTurnId: messageTurnIndex.byTurnId,
    requestConversations: stringSet(requests.map((request) => request.conversationKey)),
    requestIds: new Set(requests.map((request) => request.id)),
    turnRequestIds: stringSet(turns.map((turn) => turn.requestId)),
    turnsByConversation: groupByConversationKey(turns),
    turnsByRequest: groupByRequestId(turns)
  }
}

export function relatedToRequest<T extends { conversationKey: string | null; id: string }>(
  byRequestId: Map<string, T[]>,
  byConversationKey: Map<string, T[]>,
  request: RecentRequest
): T[] {
  return uniqueById([
    ...(byRequestId.get(request.id) ?? []),
    ...(request.conversationKey ? (byConversationKey.get(request.conversationKey) ?? []) : [])
  ])
}

export function stringSet(values: Array<string | null>): Set<string> {
  return new Set(values.filter((value): value is string => Boolean(value)))
}

export function matchesIndexedRequest(
  item: ProtocolMessage | ProxyLogEvent,
  requestIds: Set<string>,
  requestConversations: Set<string>
): boolean {
  return (
    Boolean(item.requestId && requestIds.has(item.requestId)) ||
    Boolean(item.conversationKey && requestConversations.has(item.conversationKey))
  )
}

function groupByRequestId<T extends { requestId: string | null }>(items: T[]): Map<string, T[]> {
  return groupByString(items, (item) => item.requestId)
}

function groupByConversationKey<T extends { conversationKey: string | null }>(
  items: T[]
): Map<string, T[]> {
  return groupByString(items, (item) => item.conversationKey)
}

function groupByString<T>(items: T[], keyFor: (item: T) => string | null): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = keyFor(item)
    if (!key) {
      continue
    }
    const group = groups.get(key)
    if (group) {
      group.push(item)
    } else {
      groups.set(key, [item])
    }
  }
  return groups
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const unique: T[] = []
  for (const item of items) {
    if (seen.has(item.id)) {
      continue
    }
    seen.add(item.id)
    unique.push(item)
  }
  return unique
}

function indexMessagesByTurn(
  messages: ProtocolMessage[],
  turns: TurnSummary[]
): {
  byTurnId: Map<string, ProtocolMessage[]>
  messageIds: Set<string>
} {
  const byTurnId = new Map<string, ProtocolMessage[]>()
  const messageIds = new Set<string>()
  const turnsByRequest = groupByRequestId(turns)
  const turnsByResponse = groupByString(turns, (turn) => turn.responseId)
  const turnsByParent = groupByString(turns, (turn) => turn.parentResponseId)
  const turnsByConversation = groupByConversationKey(turns)

  for (const message of messages) {
    const matches = uniqueById([
      ...(turnsByRequest.get(message.requestId) ?? []),
      ...(message.responseId ? (turnsByResponse.get(message.responseId) ?? []) : []),
      ...(message.previousResponseId
        ? (turnsByResponse.get(message.previousResponseId) ?? [])
        : []),
      ...(message.responseId ? (turnsByParent.get(message.responseId) ?? []) : []),
      ...(message.conversationKey ? (turnsByConversation.get(message.conversationKey) ?? []) : [])
    ])
    for (const turn of matches) {
      const group = byTurnId.get(turn.id)
      if (group) {
        group.push(message)
      } else {
        byTurnId.set(turn.id, [message])
      }
      messageIds.add(message.id)
    }
  }
  return { byTurnId, messageIds }
}
