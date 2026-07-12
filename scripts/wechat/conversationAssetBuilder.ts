import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import {
  alignResourceMessage,
  isIncludedInAll,
  relativePathWithinRoot,
  type CanonicalMessage,
  type ResourceMessageProbe,
} from './assetEvidence.js'
import {
  createLinkArtifacts,
  createResourceArtifact,
  createVoiceArtifact,
  type AssetCanonicalMessage,
  type ConversationArtifactRecord,
} from './conversationAssetModel.js'
import { normalizeMessageType } from './messageModel.js'
import {
  createResourceFileIndex,
  matchResourceFile,
  type ResourceFileCandidate,
} from './resourceFileMatcher.js'
import { parsePackedInfoEvidence } from './resourcePackedInfo.js'

export type ConversationAssetCounts = {
  all: number
  work: number
  document: number
  skill: number
  link: number
  chatText: number
}

export type ConversationAssetBuildResult = {
  bundleDir: string
  databasePath: string
  indexPath: string
  counts: ConversationAssetCounts
  metrics: {
    resources: number
    exactAlignments: number
    partialAlignments: number
    missingAlignments: number
    conflictingAlignments: number
    confirmedLinks: number
    unconfirmedLinks: number
    exported: number
    failed: number
    voiceAttempts: number
  }
}

type ResourceRow = {
  message_id: bigint
  chat_id: bigint
  message_local_type: bigint
  message_create_time: bigint
  message_local_id: bigint
  message_svr_id: bigint
  message_origin_source: bigint
  message_packed_info: Uint8Array | null
  resource_id: bigint
  resource_type: bigint
  resource_size: bigint
  detail_status: bigint
  data_index: string | null
  detail_packed_info: Uint8Array | null
}

type OutputMessageRow = {
  conv_id: string
  message_uid: string
  source_db: string
  source_table: string
  local_id: number
  server_id: string | null
  time: number
  sender_name: string
  raw_type: number | string
  type: number
  text: string
  username: string
}

const RESOURCE_QUERY = `
  SELECT
    i.message_id,
    i.chat_id,
    i.message_local_type,
    i.message_create_time,
    i.message_local_id,
    i.message_svr_id,
    i.message_origin_source,
    i.packed_info AS message_packed_info,
    d.resource_id,
    d.type AS resource_type,
    d.size AS resource_size,
    d.status AS detail_status,
    d.data_index,
    d.packed_info AS detail_packed_info
  FROM MessageResourceInfo i
  JOIN MessageResourceDetail d ON d.message_id=i.message_id
  ORDER BY i.message_id, d.resource_id
`

const MESSAGE_COLUMNS = `
  m.conv_id, m.message_uid, m.source_db, m.source_table, m.local_id,
  m.server_id, m.time, m.sender_name, m.raw_type, m.type, m.text,
  c.username
`

export const CANONICAL_LOCAL_LOOKUP_PREDICATE = `
  m.conv_id=? AND m.source_db=? AND m.source_table=? AND m.local_id=?
`

export const CANONICAL_SERVER_LOOKUP_PREDICATE = `
  m.conv_id=? AND m.server_id=?
  AND m.server_id IS NOT NULL AND trim(m.server_id)<>'' AND m.server_id<>'0'
`

function safeInteger(value: bigint, label: string) {
  const number = Number(value)
  if (!Number.isSafeInteger(number)) throw new RangeError(`${label} is outside the safe integer range`)
  return number
}

function normalizeServerId(value: string | bigint | number | null | undefined) {
  const normalized = value === null || value === undefined ? '' : String(value).trim()
  return normalized === '' || normalized === '0' ? null : normalized
}

function appendUnique(target: string[], values: readonly string[]) {
  for (const value of values) if (!target.includes(value)) target.push(value)
}

function packedDigest(...values: Array<Uint8Array | null>) {
  const digest = crypto.createHash('sha256')
  for (const value of values) {
    digest.update(Buffer.from([0]))
    if (value) digest.update(value)
  }
  return `sha256:${digest.digest('hex')}`
}

function assertSafeRunId(runId: string) {
  if (!/^[0-9A-Za-z._-]{1,100}$/u.test(runId)) throw new Error('runId contains unsafe characters')
}

function assertInputFile(target: string, label: string) {
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) throw new Error(`${label} is missing`)
}

function walkFiles(root: string, visit: (file: string) => void) {
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) stack.push(target)
      else if (entry.isFile()) visit(target)
    }
  }
}

function discoverResourceFiles(accountRoot: string) {
  const rootRealPath = fs.realpathSync(accountRoot)
  const candidates: ResourceFileCandidate[] = []
  const messageRoot = path.join(rootRealPath, 'msg')
  if (!fs.existsSync(messageRoot) || !fs.statSync(messageRoot).isDirectory()) return candidates
  walkFiles(messageRoot, (filePath) => {
    const targetRealPath = fs.realpathSync(filePath)
    const contained = relativePathWithinRoot(rootRealPath, targetRealPath)
    if (!contained.safe) return
    const stat = fs.statSync(targetRealPath)
    candidates.push({
      relativePath: contained.relative_path,
      name: path.basename(targetRealPath),
      size: stat.size,
    })
  })
  return candidates
}

function quoteMessageTable(table: string) {
  if (!/^Msg_[0-9a-f]{32}$/u.test(table)) throw new Error('Unsafe message table name')
  return `"${table}"`
}

function openSourceDatabases(sourceSnapshotRoot: string) {
  const result = new Map<string, DatabaseSync>()
  const messageRoot = path.join(sourceSnapshotRoot, 'db_storage', 'message')
  for (const filename of ['message_0.db', 'message_1.db']) {
    const target = path.join(messageRoot, filename)
    if (fs.existsSync(target)) result.set(filename, new DatabaseSync(target, { readOnly: true }))
  }
  if (result.size === 0) throw new Error('No source message shards were found')
  return result
}

function sourceOriginReader(databases: ReadonlyMap<string, DatabaseSync>) {
  const statements = new Map<string, StatementSync>()
  return (sourceDb: string, sourceTable: string, localId: number) => {
    const database = databases.get(sourceDb)
    if (!database) throw new Error('Canonical source shard is missing')
    const key = `${sourceDb}\0${sourceTable}`
    let statement = statements.get(key)
    if (!statement) {
      statement = database.prepare(
        `SELECT origin_source FROM ${quoteMessageTable(sourceTable)} WHERE local_id=?`,
      )
      statements.set(key, statement)
    }
    const row = statement.get(localId) as { origin_source?: number } | undefined
    if (!row || !Number.isSafeInteger(Number(row.origin_source))) {
      throw new Error('Canonical source message origin is missing')
    }
    return Number(row.origin_source)
  }
}

function toAssetMessage(
  row: OutputMessageRow,
  messageOriginSource: number,
): AssetCanonicalMessage {
  return {
    conv_id: row.conv_id,
    message_uid: row.message_uid,
    source_db: row.source_db,
    chat_table: row.username,
    message_table: row.source_table,
    local_id: Number(row.local_id),
    normalized_type: Number(row.type),
    raw_type: String(row.raw_type),
    create_time: Number(row.time),
    server_id: normalizeServerId(row.server_id),
    message_origin_source: messageOriginSource,
    conversation_username: row.username,
    sender_name: row.sender_name,
    text: row.text,
  }
}

function createOutputSchema(database: DatabaseSync) {
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

function artifactInserter(database: DatabaseSync) {
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

function artifactCounts(database: DatabaseSync, wechat: DatabaseSync): ConversationAssetCounts {
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
    chatText: Number(wechat.prepare('SELECT count(*) AS count FROM messages WHERE type=1').get()?.count ?? 0),
  }
  for (const row of rows) {
    counts[row.category] = Number(row.count)
    if (isIncludedInAll(row.category)) counts.all += Number(row.count)
  }
  return counts
}

export function runConversationAssetBuilder(options: {
  wechatDbPath: string
  resourceDbPath: string
  sourceSnapshotRoot: string
  accountRoot: string
  bundleDir: string
  runId: string
}): ConversationAssetBuildResult {
  assertSafeRunId(options.runId)
  assertInputFile(options.wechatDbPath, 'wechat database')
  assertInputFile(options.resourceDbPath, 'resource database')
  if (fs.existsSync(options.bundleDir)) throw new Error('Asset bundle already exists')

  const stagingDir = path.join(
    path.dirname(options.bundleDir),
    `.${path.basename(options.bundleDir)}.${options.runId}.${process.pid}.staging`,
  )
  if (fs.existsSync(stagingDir)) throw new Error('Asset staging bundle already exists')
  fs.mkdirSync(path.dirname(options.bundleDir), { recursive: true })
  fs.mkdirSync(stagingDir)
  const databasePath = path.join(stagingDir, 'artifacts.db')
  const indexPath = path.join(stagingDir, 'index.json')
  fs.closeSync(fs.openSync(databasePath, 'wx'))

  const wechat = new DatabaseSync(options.wechatDbPath, { readOnly: true })
  const resources = new DatabaseSync(options.resourceDbPath, { readOnly: true })
  const sourceDatabases = openSourceDatabases(options.sourceSnapshotRoot)
  const output = new DatabaseSync(databasePath)
  const metrics = {
    resources: 0,
    exactAlignments: 0,
    partialAlignments: 0,
    missingAlignments: 0,
    conflictingAlignments: 0,
    confirmedLinks: 0,
    unconfirmedLinks: 0,
    exported: 0,
    failed: 0,
    voiceAttempts: 0,
  }

  try {
    createOutputSchema(output)
    const insertArtifact = artifactInserter(output)
    const fileIndex = createResourceFileIndex(discoverResourceFiles(options.accountRoot))
    const chats = new Map<number, string>()
    for (const row of resources.prepare('SELECT rowid AS id, user_name FROM ChatName2Id').all() as Array<{
      id: number
      user_name: string
    }>) {
      chats.set(Number(row.id), row.user_name)
    }
    const conversationIds = new Map<string, string>()
    for (const row of wechat.prepare('SELECT id, username FROM conversations').all() as Array<{
      id: string
      username: string
    }>) {
      conversationIds.set(row.username, row.id)
    }
    const canonicalLocalStatement = wechat.prepare(`
      SELECT ${MESSAGE_COLUMNS}
      FROM messages m JOIN conversations c ON c.id=m.conv_id
      WHERE ${CANONICAL_LOCAL_LOOKUP_PREDICATE}
      ORDER BY m.source_db, m.message_uid
    `)
    const canonicalServerStatement = wechat.prepare(`
      SELECT ${MESSAGE_COLUMNS}
      FROM messages m JOIN conversations c ON c.id=m.conv_id
      WHERE ${CANONICAL_SERVER_LOOKUP_PREDICATE}
      ORDER BY m.source_db, m.message_uid
    `)
    const readOrigin = sourceOriginReader(sourceDatabases)
    const resourceStatement = resources.prepare(RESOURCE_QUERY)
    resourceStatement.setReadBigInts(true)
    const resourceRows = resourceStatement.all() as ResourceRow[]
    const contextCache = new Map<string, {
      message: AssetCanonicalMessage | null
      candidates: CanonicalMessage[]
      alignment: ReturnType<typeof alignResourceMessage>
      hashes: string[]
      messagePackedInfo: Uint8Array | null
      chatScope: string
    }>()

    output.exec('BEGIN IMMEDIATE')
    try {
      for (const row of resourceRows) {
        const messageId = row.message_id.toString()
        let context = contextCache.get(messageId)
        if (!context) {
          const chatScope = chats.get(safeInteger(row.chat_id, 'chat_id')) ?? ''
          const table = chatScope
            ? `Msg_${crypto.createHash('md5').update(chatScope, 'utf8').digest('hex')}`
            : ''
          const convId = conversationIds.get(chatScope)
          const localId = safeInteger(row.message_local_id, 'message_local_id')
          const serverId = normalizeServerId(row.message_svr_id)
          const outputRowsByUid = new Map<string, OutputMessageRow>()
          if (convId && table) {
            for (const sourceDb of sourceDatabases.keys()) {
              const localRows = canonicalLocalStatement.all(
                convId,
                sourceDb,
                table,
                localId,
              ) as OutputMessageRow[]
              for (const messageRow of localRows) outputRowsByUid.set(messageRow.message_uid, messageRow)
            }
            if (serverId !== null) {
              const serverRows = canonicalServerStatement.all(convId, serverId) as OutputMessageRow[]
              for (const messageRow of serverRows) outputRowsByUid.set(messageRow.message_uid, messageRow)
            }
          }
          const outputRows = [...outputRowsByUid.values()]
            .sort((left, right) => left.source_db < right.source_db ? -1 : left.source_db > right.source_db ? 1 : 0)
          const messages = outputRows.map((messageRow) => toAssetMessage(
            messageRow,
            readOrigin(messageRow.source_db, messageRow.source_table, Number(messageRow.local_id)),
          ))
          const candidates: CanonicalMessage[] = messages.map((item) => ({
            message_uid: item.message_uid,
            source_db: item.source_db,
            chat_table: item.chat_table,
            message_table: item.message_table,
            local_id: item.local_id,
            normalized_type: item.normalized_type,
            raw_type: item.raw_type,
            create_time: item.create_time,
            server_id: item.server_id,
            message_origin_source: item.message_origin_source,
          }))
          const probe: ResourceMessageProbe = {
            message_id: messageId,
            chat_table: chatScope,
            message_table: table,
            local_id: localId,
            normalized_type: normalizeMessageType(row.message_local_type),
            raw_type: row.message_local_type.toString(),
            create_time: safeInteger(row.message_create_time, 'message_create_time'),
            server_id: serverId,
            message_origin_source: safeInteger(row.message_origin_source, 'message_origin_source'),
          }
          const alignment = alignResourceMessage(probe, candidates)
          const message = alignment.message_uid
            ? messages.find((item) => item.message_uid === alignment.message_uid) ?? null
            : null
          const packed = parsePackedInfoEvidence(row.message_packed_info)
          context = {
            message,
            candidates,
            alignment,
            hashes: packed.hashes,
            messagePackedInfo: row.message_packed_info,
            chatScope,
          }
          contextCache.set(messageId, context)
          if (alignment.status === 'exact') metrics.exactAlignments++
          else if (alignment.status === 'partial') metrics.partialAlignments++
          else if (alignment.status === 'missing') metrics.missingAlignments++
          else metrics.conflictingAlignments++
        }

        const detail = parsePackedInfoEvidence(row.detail_packed_info)
        const hashes = [...context.hashes]
        appendUnique(hashes, detail.hashes)
        const filenames = [...detail.filenames]
        const expectedSize = safeInteger(row.resource_size, 'resource_size')
        const fileMatch = matchResourceFile(fileIndex, { hashes, filenames, expectedSize })
        const artifact = createResourceArtifact({
          message: context.message,
          alignment: context.alignment,
          resourceChatScope: context.chatScope,
          resourceMessageId: messageId,
          resourceId: row.resource_id.toString(),
          resourceType: row.resource_type.toString(),
          dataIndex: row.data_index ?? '',
          expectedSize,
          detailStatus: safeInteger(row.detail_status, 'detail_status'),
          messageHashes: hashes,
          filenames,
          packedInfoDigest: packedDigest(context.messagePackedInfo, row.detail_packed_info),
          fileMatch,
        })
        insertArtifact(artifact)
        metrics.resources++
        if (artifact.link_status === 'confirmed') metrics.confirmedLinks++
        else metrics.unconfirmedLinks++
        if (artifact.materialization === 'exported' || artifact.materialization === 'thumbnail_only') {
          metrics.exported++
        } else {
          metrics.failed++
        }
      }

      const textStatement = wechat.prepare(`
        SELECT ${MESSAGE_COLUMNS}
        FROM messages m JOIN conversations c ON c.id=m.conv_id
        WHERE m.text<>''
        ORDER BY m.time, m.message_uid
      `)
      for (const row of textStatement.iterate() as Iterable<OutputMessageRow>) {
        const message = toAssetMessage(row, 0)
        for (const link of createLinkArtifacts(message)) insertArtifact(link)
        if (message.normalized_type === 34) {
          insertArtifact(createVoiceArtifact(message))
          metrics.voiceAttempts++
          metrics.failed++
        }
      }
      output.exec('COMMIT')
    } catch (error) {
      output.exec('ROLLBACK')
      throw error
    }

    const counts = artifactCounts(output, wechat)
    output.prepare('INSERT INTO asset_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      options.runId,
      'complete',
      new Date().toISOString(),
      metrics.resources,
      metrics.exactAlignments,
      metrics.partialAlignments,
      metrics.missingAlignments,
      metrics.conflictingAlignments,
      metrics.confirmedLinks,
      metrics.unconfirmedLinks,
      metrics.exported,
      metrics.failed,
      metrics.voiceAttempts,
    )
    output.exec('PRAGMA journal_mode=DELETE')
    const index = {
      version: 1,
      runId: options.runId,
      completedAt: new Date().toISOString(),
      counts,
      metrics,
    }
    fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
    output.close()
    resources.close()
    wechat.close()
    for (const database of sourceDatabases.values()) database.close()
    fs.renameSync(stagingDir, options.bundleDir)
    return {
      bundleDir: options.bundleDir,
      databasePath: path.join(options.bundleDir, 'artifacts.db'),
      indexPath: path.join(options.bundleDir, 'index.json'),
      counts,
      metrics,
    }
  } catch (error) {
    try { output.close() } catch { /* Preserve the original failure. */ }
    try { resources.close() } catch { /* Preserve the original failure. */ }
    try { wechat.close() } catch { /* Preserve the original failure. */ }
    for (const database of sourceDatabases.values()) {
      try { database.close() } catch { /* Preserve the original failure. */ }
    }
    throw error
  }
}
