import type { DatabaseSync } from 'node:sqlite'
import type { HybridSearchResult } from './hybridSearch.js'

type Input = {
  query: string
  conversationId?: string
  sender?: string
  after?: number
  before?: number
  limit: number
}
type Row = { conv_id: string; message_uid: string; time: number; sender: string; sender_name: string; text: string }

function escapedLike(value: string) {
  return `%${value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
}

export function liveMessageSearch(db: DatabaseSync, input: Input): HybridSearchResult {
  const query = input.query.trim()
  if (!query) return { mode: 'keyword-only', reason: 'not_configured', hits: [] }
  const clauses = ["(text LIKE ? ESCAPE '\\' OR sender_name LIKE ? ESCAPE '\\')"]
  const pattern = escapedLike(query)
  const values: Array<string | number> = [pattern, pattern]
  if (input.conversationId) { clauses.push('conv_id=?'); values.push(input.conversationId) }
  if (input.sender) { clauses.push('sender=?'); values.push(input.sender) }
  if (input.after !== undefined) { clauses.push('time>=?'); values.push(input.after) }
  if (input.before !== undefined) { clauses.push('time<=?'); values.push(input.before) }
  const limit = Math.max(1, Math.min(input.limit, 100))
  const rows = db.prepare(`
    SELECT conv_id,message_uid,time,sender,sender_name,text FROM messages
    WHERE ${clauses.join(' AND ')} ORDER BY time DESC,message_uid LIMIT ?
  `).all(...values, limit) as Row[]
  return {
    mode: 'keyword-only',
    reason: 'not_configured',
    hits: rows.map((row, index) => ({
      chunkId: `live:${row.message_uid}`, conversationId: row.conv_id,
      firstMessageUid: row.message_uid, lastMessageUid: row.message_uid,
      startTime: Number(row.time), endTime: Number(row.time), senderIds: [row.sender].filter(Boolean),
      text: `${row.sender_name || row.sender}: ${row.text}`, ngrams: '', tokenCount: 0,
      rank: index + 1, score: 1, source: 'exact',
    })),
  }
}
