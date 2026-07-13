import type { DatabaseSync } from 'node:sqlite'
import type {
  TimelineBucket,
  TimelineCursor,
  TimelineMessage,
  TimelinePage,
  TimelineParticipant,
} from '../../shared/contracts/chat.js'

export type TimelineQueryInput = {
  conversationId: string
  limit: number
  before?: string
  after?: string
  around?: string
  sender?: string
  query?: string
}

type TimelineRow = TimelineMessage
type ParticipantRow = { id: string; name: string; message_count: number; last_time: number }
type BucketRow = { key: string; start_time: number; end_time: number; message_count: number }

const projection = `message_uid, seq, time, sender, sender_name,
  type, type_label, text`

export function encodeTimelineCursor(cursor: TimelineCursor) {
  return Buffer.from(JSON.stringify([cursor.time, cursor.messageUid]), 'utf8').toString('base64url')
}

export function decodeTimelineCursor(value: string | undefined): TimelineCursor | null {
  if (!value || value.length > 760 || !/^[A-Za-z0-9_-]+$/u.test(value)) return null
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown
    if (!Array.isArray(decoded) || decoded.length !== 2) return null
    const [time, messageUid] = decoded
    if (!Number.isSafeInteger(time) || time < 0 || typeof messageUid !== 'string') return null
    if (!messageUid || messageUid.length > 512 || messageUid.includes('\u0000')) return null
    return { time, messageUid }
  } catch {
    return null
  }
}

function escapedLike(value: string) {
  return `%${value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
}

function scopedWhere(input: TimelineQueryInput, includeSender = true) {
  const clauses = ['conv_id=?']
  const params: Array<string | number> = [input.conversationId]
  if (includeSender && input.sender) {
    clauses.push('sender=?')
    params.push(input.sender)
  }
  const query = input.query?.trim()
  if (includeSender && query) {
    clauses.push("(text LIKE ? ESCAPE '\\' OR sender_name LIKE ? ESCAPE '\\')")
    const pattern = escapedLike(query)
    params.push(pattern, pattern)
  }
  return { sql: clauses.join(' AND '), params }
}

function tupleClause(direction: 'before' | 'after', cursor: TimelineCursor) {
  const operator = direction === 'before' ? '<' : '>'
  return {
    sql: `(time ${operator} ? OR (time=? AND message_uid ${operator} ?))`,
    params: [cursor.time, cursor.time, cursor.messageUid] as Array<string | number>,
  }
}

function readDirectional(
  db: DatabaseSync,
  input: TimelineQueryInput,
  direction: 'before' | 'after',
  cursor: TimelineCursor | null,
  limit: number,
) {
  const scoped = scopedWhere(input)
  const tuple = cursor ? tupleClause(direction, cursor) : null
  const where = tuple ? `${scoped.sql} AND ${tuple.sql}` : scoped.sql
  const params = tuple ? [...scoped.params, ...tuple.params] : scoped.params
  const order = direction === 'before' ? 'DESC' : 'ASC'
  const rows = db.prepare(`
    SELECT ${projection} FROM messages WHERE ${where}
    ORDER BY time ${order}, message_uid ${order} LIMIT ?
  `).all(...params, limit) as TimelineRow[]
  return direction === 'before' ? rows.reverse() : rows
}

function readMessages(db: DatabaseSync, input: TimelineQueryInput, limit: number) {
  if (input.before) return readDirectional(db, input, 'before', decodeTimelineCursor(input.before), limit)
  if (input.after) return readDirectional(db, input, 'after', decodeTimelineCursor(input.after), limit)
  if (!input.around) return readDirectional(db, input, 'before', null, limit)
  const anchor = decodeTimelineCursor(input.around)
  if (!anchor) return []
  const earlierCount = Math.floor((limit - 1) / 2)
  const earlier = readDirectional(db, input, 'before', anchor, earlierCount)
  const scoped = scopedWhere(input)
  const atOrAfterSql = '(time > ? OR (time=? AND message_uid>=?))'
  const later = db.prepare(`
    SELECT ${projection} FROM messages WHERE ${scoped.sql} AND ${atOrAfterSql}
    ORDER BY time ASC, message_uid ASC LIMIT ?
  `).all(...scoped.params, anchor.time, anchor.time, anchor.messageUid, limit - earlier.length) as TimelineRow[]
  return [...earlier, ...later]
}

function readParticipants(db: DatabaseSync, input: TimelineQueryInput): TimelineParticipant[] {
  const rows = db.prepare(`
    SELECT COALESCE(NULLIF(sender,''), sender_name, '?') AS id,
      COALESCE(NULLIF(max(sender_name),''), NULLIF(sender,''), '?') AS name,
      count(*) AS message_count, max(time) AS last_time
    FROM messages WHERE conv_id=? GROUP BY id ORDER BY message_count DESC, name ASC
  `).all(input.conversationId) as ParticipantRow[]
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    messageCount: Number(row.message_count),
    lastTime: Number(row.last_time),
  }))
}

function bucketLabel(key: string) {
  const [year, month] = key.split('-')
  return `${year}年${Number(month)}月`
}

function readBuckets(db: DatabaseSync, input: TimelineQueryInput): TimelineBucket[] {
  const scoped = scopedWhere(input)
  const rows = db.prepare(`
    SELECT strftime('%Y-%m', time, 'unixepoch', 'localtime') AS key,
      min(time) AS start_time, max(time) AS end_time, count(*) AS message_count
    FROM messages WHERE ${scoped.sql} GROUP BY key ORDER BY start_time ASC
  `).all(...scoped.params) as BucketRow[]
  return rows.filter((row) => Boolean(row.key)).map((row) => ({
    key: row.key,
    label: bucketLabel(row.key),
    startTime: Number(row.start_time),
    endTime: Number(row.end_time),
    messageCount: Number(row.message_count),
    cursor: encodeTimelineCursor({ time: Number(row.start_time), messageUid: '\u0001' }),
  }))
}

function hasBeyond(
  db: DatabaseSync,
  input: TimelineQueryInput,
  direction: 'before' | 'after',
  cursor: TimelineCursor,
) {
  const scoped = scopedWhere(input)
  const tuple = tupleClause(direction, cursor)
  return Boolean(db.prepare(`SELECT 1 FROM messages WHERE ${scoped.sql} AND ${tuple.sql} LIMIT 1`)
    .get(...scoped.params, ...tuple.params))
}

export function queryTimeline(db: DatabaseSync, input: TimelineQueryInput): TimelinePage {
  const limit = Math.min(240, Math.max(1, Number.isSafeInteger(input.limit) ? input.limit : 120))
  const messages = readMessages(db, input, limit).map((row) => ({ ...row }))
  const first = messages[0]
  const last = messages[messages.length - 1]
  const firstCursor = first ? { time: Number(first.time), messageUid: first.message_uid } : null
  const lastCursor = last ? { time: Number(last.time), messageUid: last.message_uid } : null
  return {
    conversationId: input.conversationId,
    limit,
    messages,
    participants: readParticipants(db, input),
    buckets: readBuckets(db, input),
    pageInfo: {
      olderCursor: firstCursor ? encodeTimelineCursor(firstCursor) : null,
      newerCursor: lastCursor ? encodeTimelineCursor(lastCursor) : null,
      hasOlder: firstCursor ? hasBeyond(db, input, 'before', firstCursor) : false,
      hasNewer: lastCursor ? hasBeyond(db, input, 'after', lastCursor) : false,
    },
  }
}
