import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const requiredSchema = {
  artifacts: [
    'asset_id', 'conv_id', 'message_uid', 'resource_message_id', 'resource_id',
    'category', 'kind', 'name', 'preview', 'url', 'source_relative_path',
    'source_size', 'created_at', 'sender_name', 'text', 'alignment_status',
    'link_status', 'link_reason', 'candidate_message_uids', 'evidence_kind',
    'evidence_signature', 'materialization', 'preview_status', 'failure_reason',
  ],
  asset_runs: [
    'run_id', 'status', 'completed_at', 'resources', 'exact_alignments',
    'partial_alignments', 'missing_alignments', 'conflicting_alignments',
    'confirmed_links', 'unconfirmed_links', 'exported', 'failed', 'voice_attempts',
  ],
} as const

export type OpenedArtifactDatabase = {
  db: DatabaseSync | null
  code: 'ready' | 'unavailable'
}

export function resolveArtifactDatabasePath(projectRoot: string) {
  return path.resolve(projectRoot, 'data', 'chat-assets.current', 'artifacts.db')
}

function hasRequiredSchema(db: DatabaseSync) {
  for (const [table, requiredColumns] of Object.entries(requiredSchema)) {
    const rows = db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all() as Array<{ name: string }>
    const available = new Set(rows.map((row) => row.name))
    if (requiredColumns.some((column) => !available.has(column))) return false
  }
  return true
}

function hasCompleteRun(db: DatabaseSync) {
  const rows = db.prepare('SELECT run_id, status, completed_at FROM asset_runs LIMIT 2').all() as Array<{
    run_id: string
    status: string
    completed_at: string
  }>
  return rows.length === 1
    && rows[0].status === 'complete'
    && Boolean(rows[0].run_id.trim())
    && Boolean(rows[0].completed_at.trim())
}

export function openValidatedArtifactDatabase(projectRoot: string): OpenedArtifactDatabase {
  const databasePath = resolveArtifactDatabasePath(projectRoot)
  let db: DatabaseSync | null = null
  try {
    if (!fs.statSync(databasePath).isFile()) return { db: null, code: 'unavailable' }
    db = new DatabaseSync(databasePath, { readOnly: true })
    if (!hasRequiredSchema(db) || !hasCompleteRun(db)) {
      db.close()
      return { db: null, code: 'unavailable' }
    }
    return { db, code: 'ready' }
  } catch {
    try {
      db?.close()
    } catch {
      // Keep validation failures generic and ensure rejected handles are closed.
    }
    return { db: null, code: 'unavailable' }
  }
}
