import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export function wechatSourceFingerprint(
  db: DatabaseSync,
  fileIdentity?: { size: number; mtimeMs: number },
) {
  const hash = createHash('sha256')
  try {
    const row = db.prepare('SELECT * FROM parse_runs LIMIT 1').get() as Record<string, unknown> | undefined
    if (row) {
      const stable = Object.keys(row).sort().map((key) => [key, row[key]])
      hash.update(JSON.stringify(stable), 'utf8')
      if (fileIdentity) hash.update(`|${fileIdentity.size}|${Math.trunc(fileIdentity.mtimeMs)}`, 'utf8')
      return hash.digest('hex')
    }
  } catch {
    // Legacy databases have no parse run, so hash their canonical public rows below.
  }
  const columns = db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>
  const identity = columns.some((column) => column.name === 'message_uid')
    ? 'message_uid'
    : 'CAST(seq AS TEXT)'
  const rows = db.prepare(`
    SELECT conv_id,${identity} AS uid,time,sender,sender_name,text
    FROM messages ORDER BY conv_id,time,uid
  `).iterate() as Iterable<Record<string, unknown>>
  for (const row of rows) {
    hash.update(JSON.stringify([
      row.conv_id, row.uid, row.time, row.sender, row.sender_name, row.text,
    ]), 'utf8')
    hash.update('\n', 'utf8')
  }
  return hash.digest('hex')
}
