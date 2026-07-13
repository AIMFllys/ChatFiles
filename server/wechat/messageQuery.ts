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

const identityColumns = [
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

const canonicalV2Columns = [
  ...identityColumns,
  'canonical_seq',
  'occurred_at_epoch_s',
  'time_precision',
  'archive_day',
  'source_adapter',
  'source_sort_seq',
  'person_id',
  'sender_name_snapshot',
  'content_kind',
  'structured_content_json',
] as const

type MessageQueryShape = 'canonical-v2' | 'identity-legacy' | 'legacy'

function messageQueryShape(db: DatabaseSync): MessageQueryShape {
  const rows = db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>
  const available = new Set(rows.map((row) => row.name))
  if (canonicalV2Columns.every((column) => available.has(column))) return 'canonical-v2'
  return identityColumns.every((column) => available.has(column)) ? 'identity-legacy' : 'legacy'
}

function buildQuery(shape: MessageQueryShape, hasSearch: boolean) {
  const projection = shape === 'canonical-v2'
    ? `message_uid, seq, canonical_seq, time, occurred_at_epoch_s, time_precision, archive_day,
       source_adapter, source_sort_seq, sort_seq, source_db, local_id,
       sender, person_id, sender_name, sender_name_snapshot, is_own, sender_source, sender_audit,
       CAST(raw_type AS TEXT) AS raw_type, type, type_label, content_kind, structured_content_json, text`
    : shape === 'identity-legacy'
      ? `message_uid, seq, time, sort_seq, source_db, local_id,
       sender, sender_name, is_own, sender_source, sender_audit,
       CAST(raw_type AS TEXT) AS raw_type, type, type_label, text`
      : 'seq, time, sender, sender_name, type, type_label, text'
  const order = shape === 'canonical-v2'
    ? 'canonical_seq'
    : shape === 'identity-legacy'
      ? 'time, sort_seq, source_db, local_id, message_uid'
      : 'time'
  const search = hasSearch ? ' AND text LIKE ?' : ''
  return `SELECT ${projection} FROM messages WHERE conv_id=?${search} ORDER BY ${order} LIMIT ? OFFSET ?`
}

export function readConversationMessages(
  db: DatabaseSync,
  input: ConversationMessageQuery,
): ConversationMessageResult {
  const shape = messageQueryShape(db)
  const mode: WechatMessageQueryMode = shape === 'canonical-v2' ? 'canonical' : 'legacy'
  const query = input.query?.trim() ?? ''
  const statement = db.prepare(buildQuery(shape, Boolean(query)))
  const rows = query
    ? statement.all(input.conversationId, `%${query}%`, input.limit, input.offset)
    : statement.all(input.conversationId, input.limit, input.offset)
  const messages = rows.map((row) => ({ ...row })) as Array<Record<string, unknown>>

  return { mode, messages }
}
