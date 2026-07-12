import type { DatabaseSync } from 'node:sqlite'

export type WechatMessageQueryMode = 'canonical' | 'legacy'

export type ConversationMessageQuery = {
  conversationId: string
  query?: string
  limit: number
  offset: number
}

export type ConversationMessageResult = {
  mode: WechatMessageQueryMode
  messages: Array<Record<string, unknown>>
}

const canonicalColumns = [
  'message_uid',
  'seq',
  'time',
  'sort_seq',
  'source_db',
  'local_id',
  'sender',
  'sender_name',
  'is_own',
  'sender_source',
  'sender_audit',
  'raw_type',
  'type',
  'type_label',
  'text',
] as const

function messageQueryMode(db: DatabaseSync): WechatMessageQueryMode {
  const rows = db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>
  const available = new Set(rows.map((row) => row.name))
  return canonicalColumns.every((column) => available.has(column)) ? 'canonical' : 'legacy'
}

function buildQuery(mode: WechatMessageQueryMode, hasSearch: boolean) {
  const projection = mode === 'canonical'
    ? `message_uid, seq, time, sort_seq, source_db, local_id,
       sender, sender_name, is_own, sender_source, sender_audit,
       CAST(raw_type AS TEXT) AS raw_type, type, type_label, text`
    : 'seq, time, sender, sender_name, type, type_label, text'
  const order = mode === 'canonical'
    ? 'time, sort_seq, source_db, local_id, message_uid'
    : 'time'
  const search = hasSearch ? ' AND text LIKE ?' : ''
  return `SELECT ${projection} FROM messages WHERE conv_id=?${search} ORDER BY ${order} LIMIT ? OFFSET ?`
}

export function readConversationMessages(
  db: DatabaseSync,
  input: ConversationMessageQuery,
): ConversationMessageResult {
  const mode = messageQueryMode(db)
  const query = input.query?.trim() ?? ''
  const statement = db.prepare(buildQuery(mode, Boolean(query)))
  const rows = query
    ? statement.all(input.conversationId, `%${query}%`, input.limit, input.offset)
    : statement.all(input.conversationId, input.limit, input.offset)
  const messages = rows.map((row) => ({ ...row })) as Array<Record<string, unknown>>

  return { mode, messages }
}
