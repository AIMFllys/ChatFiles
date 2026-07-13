import type { DatabaseSync } from 'node:sqlite'

export type ArtifactStorageShape = {
  version: 1 | 2
  verifiedPredicate: string
  associationStatus: string
  associationEvidence: string
  sourcePresence: string
  sourceContentSha256: string
}

export function inspectArtifactStorage(database: DatabaseSync): ArtifactStorageShape {
  const columns = new Set((database.prepare("PRAGMA table_info('artifacts')").all() as Array<{
    name: string
  }>).map((row) => row.name))
  const version = columns.has('association_status')
    && columns.has('confirmation_status')
    && columns.has('source_presence') ? 2 : 1
  return {
    version,
    verifiedPredicate: version === 2
      ? "association_status='exact' AND confirmation_status='confirmed'"
      : columns.has('link_status') ? "link_status='confirmed'" : '1=1',
    associationStatus: columns.has('association_status')
      ? 'association_status'
      : columns.has('alignment_status') ? 'alignment_status' : "'legacy'",
    associationEvidence: columns.has('association_evidence')
      ? 'association_evidence'
      : columns.has('evidence_kind') ? 'evidence_kind' : "'legacy'",
    sourcePresence: columns.has('source_presence')
      ? 'source_presence'
      : "CASE WHEN source_size IS NULL THEN 'missing' ELSE 'present' END",
    sourceContentSha256: columns.has('source_content_sha256') ? 'source_content_sha256' : 'NULL',
  }
}
