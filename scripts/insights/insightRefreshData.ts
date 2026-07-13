import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type {
  CurrentInsightConversation,
  InsightConversation,
  InsightMessage,
} from './insightRefresh.js'
import { readJson, safeInsightId, type DeltaEntry } from './insightRefreshContext.js'

export function currentConversations(db: DatabaseSync) {
  const rows = db.prepare(`
    SELECT id, display, is_group, text_count, first_time, last_time
    FROM conversations
    WHERE text_count >= 20
    ORDER BY id
  `).all() as Array<{
    id: string
    display: string
    is_group: number
    text_count: number
    first_time: number
    last_time: number
  }>
  return rows.map((row): CurrentInsightConversation => ({
    id: row.id,
    display: row.display,
    isGroup: row.is_group === 1,
    textCount: Number(row.text_count),
    firstTime: Number(row.first_time),
    lastTime: Number(row.last_time),
  }))
}

export function insightFilename(convId: string) {
  return `${safeInsightId(convId)}.json`
}

export function loadInsightConversations(directory: string) {
  const filenames = fs.readdirSync(directory).filter((file) => file.endsWith('.json')).sort()
  return filenames.map((file) => readJson<InsightConversation>(path.join(directory, file)))
}

export function queryMessages(db: DatabaseSync, entry: DeltaEntry) {
  const cursor = entry.sinceMessageUid
    ? 'AND (time > ? OR (time = ? AND message_uid > ?))'
    : 'AND time > ?'
  const statement = db.prepare(`
    SELECT message_uid, time, sender_name, text
    FROM messages
    WHERE conv_id = ? AND type = 1 AND length(text) > 0 ${cursor}
    ORDER BY time, message_uid, rowid
  `)
  const rows = entry.sinceMessageUid
    ? statement.all(entry.conversation.id, entry.since, entry.since, entry.sinceMessageUid)
    : statement.all(entry.conversation.id, entry.since)
  return rows.map((row): InsightMessage => {
    const value = row as { message_uid: string; time: number; sender_name: string | null; text: string }
    return {
      messageUid: value.message_uid,
      time: Number(value.time),
      senderName: value.sender_name ?? '某人',
      text: value.text,
    }
  })
}

export function copyBoards(sourceDir: string, targetDir: string) {
  fs.mkdirSync(targetDir)
  const sourceBoards = path.join(sourceDir, 'boards')
  if (!fs.existsSync(sourceBoards)) return 0
  const files = fs.readdirSync(sourceBoards).filter((file) => file.endsWith('.md')).sort()
  for (const file of files) {
    fs.copyFileSync(path.join(sourceBoards, file), path.join(targetDir, file), fs.constants.COPYFILE_EXCL)
  }
  return files.length
}

export function copyDirectoryExclusive(source: string, target: string) {
  const sourceStats = fs.lstatSync(source)
  if (sourceStats.isSymbolicLink()) throw new Error(`Refusing to copy a symlinked directory: ${source}`)
  if (!sourceStats.isDirectory()) throw new Error(`Expected a directory: ${source}`)
  fs.mkdirSync(target, { recursive: false })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name)
    const targetPath = path.join(target, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Refusing to copy a symlinked insight entry: ${sourcePath}`)
    if (entry.isDirectory()) copyDirectoryExclusive(sourcePath, targetPath)
    else if (entry.isFile()) fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL)
    else throw new Error(`Unsupported insight entry type: ${sourcePath}`)
  }
}
