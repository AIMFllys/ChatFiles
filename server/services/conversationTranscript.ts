import type { DatabaseSync } from 'node:sqlite'

import {
  DEFAULT_ARCHIVE_TIME_ZONE,
  formatArchiveTimestamp,
  resolveArchiveTimeZone,
} from '../../shared/time/archiveTime.js'

type TranscriptRow = {
  time: number
  sender_name: string
  sender: string
  type_label: string
  text: string
}

export type ConversationTranscript = {
  meta: { display: string; is_group: number; msg_count: number }
  text: string
  chars: number
  lines: number
  truncated: boolean
  timeZone: string
}

function columns(db: DatabaseSync, table: string) {
  return new Set(
    (db.prepare(`PRAGMA table_info("${table.replaceAll('"', '""')}")`).all() as Array<{ name: string }>)
      .map((row) => row.name),
  )
}

function archiveTimeZone(db: DatabaseSync) {
  const runColumns = columns(db, 'parse_runs')
  if (!runColumns.has('time_zone')) return DEFAULT_ARCHIVE_TIME_ZONE
  const row = db.prepare('SELECT time_zone FROM parse_runs LIMIT 1').get() as { time_zone?: string } | undefined
  return resolveArchiveTimeZone(row?.time_zone)
}

export function readConversationTranscript(
  db: DatabaseSync,
  input: { conversationId: string; maxCharacters: number },
): ConversationTranscript | null {
  const meta = db.prepare('SELECT display,is_group,msg_count FROM conversations WHERE id=?')
    .get(input.conversationId) as ConversationTranscript['meta'] | undefined
  if (!meta) return null
  const maximum = Math.min(Math.max(1, Math.trunc(input.maxCharacters)), 4_000_000)
  const rowCap = Math.ceil(maximum / 6) + 2_000
  const messageColumns = columns(db, 'messages')
  const canonical = messageColumns.has('canonical_seq') && messageColumns.has('occurred_at_epoch_s')
  const timeProjection = canonical ? 'occurred_at_epoch_s AS time' : 'time'
  const order = canonical ? 'canonical_seq' : 'time,seq'
  const rows = db.prepare(`SELECT ${timeProjection},sender_name,sender,type_label,text
    FROM messages WHERE conv_id=? ORDER BY ${order} LIMIT ?`).all(input.conversationId, rowCap) as TranscriptRow[]
  const timeZone = archiveTimeZone(db)
  const lines: string[] = []
  let chars = 0
  let truncated = rows.length >= rowCap
  for (const message of rows) {
    const who = message.sender_name || message.sender || '?'
    const body = message.text?.trim() || `[${message.type_label || '消息'}]`
    const timestamp = formatArchiveTimestamp(Number(message.time), timeZone)
    const line = `[${timestamp}] ${who}: ${body}`
    if (chars + line.length > maximum) {
      truncated = true
      break
    }
    lines.push(line)
    chars += line.length + 1
  }
  return { meta, text: lines.join('\n'), chars, lines: lines.length, truncated, timeZone }
}
