import { DatabaseSync } from 'node:sqlite'
import { isIncludedInAll } from './assetEvidence.js'
import type { ConversationArtifactRecord } from './conversationAssetModel.js'
import type { ConversationAssetCounts } from './conversationAssetBuilderSupport.js'

export function createOutputSchema(database: DatabaseSync) {
  database.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE artifacts(
      asset_id TEXT PRIMARY KEY,
      conv_id TEXT,
      message_uid TEXT,
      resource_message_id TEXT,
      resource_id TEXT,
      category TEXT NOT NULL,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      preview TEXT NOT NULL,
      url TEXT,
      source_relative_path TEXT,
      source_size INTEGER,
      created_at INTEGER NOT NULL,
      sender_name TEXT NOT NULL,
      text TEXT NOT NULL,
      alignment_status TEXT NOT NULL,
      link_status TEXT NOT NULL,
      link_reason TEXT,
      candidate_message_uids TEXT NOT NULL,
      evidence_kind TEXT NOT NULL,
      evidence_signature TEXT NOT NULL,
      materialization TEXT NOT NULL,
      preview_status TEXT NOT NULL,
      failure_reason TEXT
    );
    CREATE TABLE asset_runs(
      run_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      resources INTEGER NOT NULL,
      exact_alignments INTEGER NOT NULL,
      partial_alignments INTEGER NOT NULL,
      missing_alignments INTEGER NOT NULL,
      conflicting_alignments INTEGER NOT NULL,
      confirmed_links INTEGER NOT NULL,
      unconfirmed_links INTEGER NOT NULL,
      exported INTEGER NOT NULL,
      failed INTEGER NOT NULL,
      voice_attempts INTEGER NOT NULL
    );
    CREATE INDEX idx_artifacts_conversation ON artifacts(conv_id, category, created_at DESC, asset_id);
    CREATE INDEX idx_artifacts_category ON artifacts(category, created_at DESC, asset_id);
    CREATE INDEX idx_artifacts_message ON artifacts(message_uid);
    CREATE INDEX idx_artifacts_preview ON artifacts(preview_status, materialization);
  `)
}

export function artifactInserter(database: DatabaseSync) {
  const statement = database.prepare(`
    INSERT INTO artifacts VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `)
  return (artifact: ConversationArtifactRecord) => statement.run(
    artifact.asset_id,
    artifact.conv_id,
    artifact.message_uid,
    artifact.resource_message_id,
    artifact.resource_id,
    artifact.category,
    artifact.kind,
    artifact.name,
    artifact.preview,
    artifact.url,
    artifact.source_relative_path,
    artifact.source_size,
    artifact.created_at,
    artifact.sender_name,
    artifact.text,
    artifact.alignment_status,
    artifact.link_status,
    artifact.link_reason,
    artifact.candidate_message_uids,
    artifact.evidence_kind,
    artifact.evidence_signature,
    artifact.materialization,
    artifact.preview_status,
    artifact.failure_reason,
  )
}

export function artifactCounts(
  database: DatabaseSync,
  wechat: DatabaseSync,
  sourceSnapshot: string,
): ConversationAssetCounts {
  const rows = database.prepare('SELECT category, count(*) AS count FROM artifacts GROUP BY category').all() as Array<{
    category: 'work' | 'document' | 'skill' | 'link'
    count: number
  }>
  const counts: ConversationAssetCounts = {
    all: 0,
    work: 0,
    document: 0,
    skill: 0,
    link: 0,
    chatText: Number(wechat.prepare(`SELECT count(*) AS count FROM messages
      WHERE type=1 AND source_snapshot=?`).get(sourceSnapshot)?.count ?? 0),
  }
  for (const row of rows) {
    counts[row.category] = Number(row.count)
    if (isIncludedInAll(row.category)) counts.all += Number(row.count)
  }
  return counts
}
