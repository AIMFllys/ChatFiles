import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import {
  resolveWechatDatabase,
  type WechatDatabaseResolution,
  type WechatDatabaseSource,
} from './databaseResolver.js'

export type WechatDatabaseRejectionCode =
  | 'missing'
  | 'not-file'
  | 'unreadable'
  | 'invalid-schema'
  | 'invalid-parse-run'

export type WechatDatabaseRejection = {
  source: Exclude<WechatDatabaseSource, 'missing'>
  path: string
  code: WechatDatabaseRejectionCode
  detail: string
}

export type ValidatedWechatDatabaseResolution = WechatDatabaseResolution & {
  rejections: WechatDatabaseRejection[]
}

export type OpenedWechatDatabase = {
  db: DatabaseSync | null
  resolution: ValidatedWechatDatabaseResolution
}

const currentSchema = {
  contacts: ['account', 'owner', 'username', 'display', 'nick', 'remark', 'alias', 'is_group'],
  conversations: [
    'id', 'account', 'owner', 'username', 'display', 'is_group',
    'msg_count', 'text_count', 'first_time', 'last_time', 'summary',
  ],
  messages: [
    'conv_id', 'message_uid', 'seq', 'source_snapshot', 'source_db', 'source_table',
    'local_id', 'server_id', 'sort_seq', 'time', 'sender', 'sender_name',
    'sender_prefix', 'is_own', 'sender_source', 'sender_audit',
    'raw_type', 'type', 'type_label', 'text',
  ],
  parse_runs: [
    'run_id', 'status', 'completed_at', 'selected_snapshot_count', 'selected_source_count',
    'source_conversation_count', 'source_message_count', 'output_conversation_count',
    'output_message_count', 'output_text_count', 'deduplicated_message_count',
  ],
} as const

const legacySchema = {
  conversations: [
    'id', 'account', 'username', 'display', 'is_group',
    'msg_count', 'text_count', 'first_time', 'last_time', 'summary',
  ],
  messages: ['conv_id', 'seq', 'time', 'sender', 'sender_name', 'type', 'type_label', 'text'],
} as const

function missingColumns(db: DatabaseSync, schema: Record<string, readonly string[]>) {
  const missing: string[] = []
  for (const [table, required] of Object.entries(schema)) {
    const rows = db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all() as Array<{ name: string }>
    const available = new Set(rows.map((row) => row.name))
    for (const column of required) {
      if (!available.has(column)) missing.push(`${table}.${column}`)
    }
  }
  return missing
}

function validateParseRun(db: DatabaseSync) {
  const rows = db.prepare('SELECT * FROM parse_runs LIMIT 2').all() as Array<Record<string, unknown>>
  if (rows.length !== 1) return 'Expected exactly one parse_runs record.'

  const run = rows[0]
  if (
    !String(run.run_id ?? '').trim()
    || String(run.status ?? '') !== 'complete'
    || !String(run.completed_at ?? '').trim()
  ) {
    return 'The parse run is not marked complete with run and completion identifiers.'
  }

  const countNames = [
    'selected_snapshot_count',
    'selected_source_count',
    'source_conversation_count',
    'source_message_count',
    'output_conversation_count',
    'output_message_count',
    'output_text_count',
    'deduplicated_message_count',
  ] as const
  if (countNames.some((name) => typeof run[name] !== 'number' || !Number.isSafeInteger(run[name]))) {
    return 'The parse run contains missing or invalid count metadata.'
  }
  const counts = Object.fromEntries(countNames.map((name) => [name, Number(run[name])])) as Record<
    typeof countNames[number],
    number
  >
  if (
    counts.selected_snapshot_count <= 0
    || counts.selected_source_count <= 0
    || counts.source_conversation_count <= 0
    || counts.source_message_count <= 0
    || counts.output_conversation_count <= 0
    || counts.output_message_count <= 0
    || counts.output_text_count < 0
    || counts.output_text_count > counts.output_message_count
    || counts.deduplicated_message_count < 0
    || counts.source_conversation_count !== counts.output_conversation_count
    || counts.source_message_count !== counts.output_message_count + counts.deduplicated_message_count
  ) {
    return 'The parse run count metadata is empty or does not close.'
  }
  return null
}

function closeQuietly(db: DatabaseSync | null) {
  try {
    db?.close()
  } catch {
    // Rejected candidates must not remain open even when SQLite reports a close error.
  }
}

function errorDetail(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function rejection(
  candidate: { source: 'current' | 'legacy'; path: string },
  code: WechatDatabaseRejectionCode,
  detail: string,
): WechatDatabaseRejection {
  return { source: candidate.source, path: candidate.path, code, detail }
}

export function openValidatedWechatDatabase(projectRoot: string): OpenedWechatDatabase {
  const base = resolveWechatDatabase(projectRoot, fs.existsSync)
  const rejections: WechatDatabaseRejection[] = []
  const candidates = [
    { source: 'current' as const, path: base.currentPath, available: base.currentAvailable },
    { source: 'legacy' as const, path: base.legacyPath, available: base.legacyAvailable },
  ]

  for (const candidate of candidates) {
    if (!candidate.available) {
      rejections.push(rejection(candidate, 'missing', 'Database path does not exist.'))
      continue
    }
    try {
      if (!fs.statSync(candidate.path).isFile()) {
        rejections.push(rejection(candidate, 'not-file', 'Database path is not a regular file.'))
        continue
      }
    } catch (error) {
      rejections.push(rejection(candidate, 'unreadable', errorDetail(error)))
      continue
    }

    let db: DatabaseSync | null = null
    try {
      db = new DatabaseSync(candidate.path, { readOnly: true })
      const missing = missingColumns(db, candidate.source === 'current' ? currentSchema : legacySchema)
      if (missing.length > 0) {
        closeQuietly(db)
        rejections.push(rejection(
          candidate,
          'invalid-schema',
          `Missing required columns: ${missing.join(', ')}`,
        ))
        continue
      }
      if (candidate.source === 'current') {
        const parseRunIssue = validateParseRun(db)
        if (parseRunIssue) {
          closeQuietly(db)
          rejections.push(rejection(candidate, 'invalid-parse-run', parseRunIssue))
          continue
        }
      }
      return {
        db,
        resolution: {
          ...base,
          source: candidate.source,
          selectedPath: candidate.path,
          rejections,
        },
      }
    } catch (error) {
      closeQuietly(db)
      rejections.push(rejection(candidate, 'unreadable', errorDetail(error)))
    }
  }

  return {
    db: null,
    resolution: { ...base, source: 'missing', selectedPath: null, rejections },
  }
}
