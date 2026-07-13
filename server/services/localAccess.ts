import { ToolExecutionError } from './agent/toolRegistry.js'

export type LocalStatus = {
  name: string
  wechat: 'ready' | 'unavailable'
  artifacts: 'ready' | 'unavailable'
  version?: number
}

export type LocalAccessBackend = {
  status: () => Promise<LocalStatus>
  execute: (name: string, input: Record<string, unknown>) => Promise<unknown>
}

export type LocalAccessService = {
  status: () => Promise<LocalStatus>
  conversations: (input?: { query?: string; limit?: number }) => Promise<unknown>
  search: (input: { query: string; conversationId?: string; sender?: string; after?: number; before?: number; limit?: number }) => Promise<unknown>
  artifacts: (input: { query?: string; conversationId?: string; category?: 'all' | 'work' | 'document' | 'skill' | 'link'; limit?: number }) => Promise<unknown>
  readDocument: (input: { assetId: string; maxCharacters?: number }) => Promise<unknown>
  messageContext: (input: { messageUid: string; radius?: number }) => Promise<unknown>
}

export class LocalAccessError extends Error {
  constructor(public readonly code: 'invalid_input' | 'not_found' | 'database_unavailable' | 'operation_failed') {
    super(code)
    this.name = 'LocalAccessError'
  }
}

function boundedText(value: string | undefined, maximum: number, required = false) {
  const normalized = value?.trim() ?? ''
  if ((required && !normalized) || [...normalized].length > maximum) throw new LocalAccessError('invalid_input')
  return normalized || undefined
}

function integer(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  if (value === undefined) return fallback
  if (!Number.isFinite(value)) throw new LocalAccessError('invalid_input')
  return Math.max(minimum, Math.min(maximum, Math.round(value)))
}

function optionalTime(value: number | undefined) {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || value < 0) throw new LocalAccessError('invalid_input')
  return value
}

async function execute(backend: LocalAccessBackend, name: string, input: Record<string, unknown>) {
  try {
    return await backend.execute(name, input)
  } catch (error) {
    if (error instanceof LocalAccessError) throw error
    if (error instanceof ToolExecutionError) {
      if (error.code === 'invalid_arguments') throw new LocalAccessError('invalid_input')
      if (error.code === 'not_found') throw new LocalAccessError('not_found')
    }
    throw new LocalAccessError('operation_failed')
  }
}

export function createLocalAccessService(backend: LocalAccessBackend): LocalAccessService {
  return {
    status: backend.status,
    async conversations(input = {}) {
      return await execute(backend, 'list_conversations', {
        ...(boundedText(input.query, 120) ? { query: boundedText(input.query, 120) } : {}),
        limit: integer(input.limit, 20, 1, 100),
      })
    },
    async search(input) {
      const query = boundedText(input.query, 500, true)!
      const conversationId = boundedText(input.conversationId, 512)
      const sender = boundedText(input.sender, 512)
      return await execute(backend, 'search_messages', {
        query, limit: integer(input.limit, 20, 1, 100),
        ...(conversationId ? { conversationId } : {}), ...(sender ? { sender } : {}),
        ...(optionalTime(input.after) === undefined ? {} : { after: optionalTime(input.after) }),
        ...(optionalTime(input.before) === undefined ? {} : { before: optionalTime(input.before) }),
      })
    },
    async artifacts(input) {
      const category = input.category ?? 'all'
      if (!['all', 'work', 'document', 'skill', 'link'].includes(category)) throw new LocalAccessError('invalid_input')
      const query = boundedText(input.query, 200)
      const conversationId = boundedText(input.conversationId, 512)
      return await execute(backend, 'search_artifacts', {
        category, limit: integer(input.limit, 20, 1, 100),
        ...(query ? { query } : {}), ...(conversationId ? { conversationId } : {}),
      })
    },
    async readDocument(input) {
      if (!/^[0-9a-f]{64}$/u.test(input.assetId)) throw new LocalAccessError('invalid_input')
      return await execute(backend, 'read_document', {
        assetId: input.assetId,
        maxCharacters: integer(input.maxCharacters, 12_000, 1, 50_000),
      })
    },
    async messageContext(input) {
      const messageUid = boundedText(input.messageUid, 512, true)!
      return await execute(backend, 'get_message_context', {
        messageUid, radius: integer(input.radius, 8, 0, 20),
      })
    },
  }
}
