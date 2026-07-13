import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  createMessageSemanticFingerprint,
  normalizeMessageType,
  resolveSenderIdentity,
} from './messageModel.js'
import { decodeContent, extractText, typeLabel } from './messageParsing.js'
import { readSourceMessages } from './sourceReader.js'
import { truncateCodePoints } from './unicodeText.js'
import {
  compareText,
  hasServerId,
  md5,
  sha256,
} from './parserSnapshotDiscovery.js'
import type { MessageSource, ParsedMessage, ParserPaths, SnapshotDescriptor } from './parserTypes.js'

export function safeFile(name: string) {
  const unsafeCharacters = new Set('<>:"/\\|?*')
  const sanitized = [...name]
    .map((character) => character.charCodeAt(0) <= 0x1f || unsafeCharacters.has(character) ? '_' : character)
    .join('')
  return truncateCodePoints(sanitized, 80)
}

function createMessageUid(owner: string, username: string, sourceDb: string, table: string, localId: number, serverId: string) {
  const identity = hasServerId(serverId)
    ? `server:${serverId}`
    : `evidence:${sourceDb}:${table}:${localId}`
  return `wxm:${sha256(`${owner}\u0000${username}\u0000${identity}`)}`
}

function stableMessageSort(left: ParsedMessage, right: ParsedMessage) {
  return left.time - right.time
    || left.sortSeq - right.sortSeq
    || compareText(left.sourceDb, right.sourceDb)
    || left.localId - right.localId
}

function deduplicateMessages(messages: readonly ParsedMessage[]) {
  const result: ParsedMessage[] = []
  const serverIds = new Map<string, ParsedMessage>()
  const evidenceKeys = new Map<string, ParsedMessage>()
  const messageUids = new Map<string, ParsedMessage>()
  let deduplicatedCount = 0
  for (const message of messages) {
    const evidenceKey = `${message.sourceDb}\u0000${message.sourceTable}\u0000${message.localId}`
    if (evidenceKeys.has(evidenceKey)) {
      throw new Error(
        `Duplicate exact evidence key in ${message.sourceTable}: source_db=${message.sourceDb}, local_id=${message.localId}`,
      )
    }
    evidenceKeys.set(evidenceKey, message)
    const duplicates = [
      hasServerId(message.serverId) ? serverIds.get(message.serverId) : undefined,
      messageUids.get(message.messageUid),
    ].filter((candidate): candidate is ParsedMessage => Boolean(candidate))
    const semanticFingerprint = createMessageSemanticFingerprint(message)
    for (const duplicate of new Set(duplicates)) {
      if (createMessageSemanticFingerprint(duplicate) !== semanticFingerprint) {
        throw new Error(
          `Conflicting duplicate message in ${message.sourceTable}: server_id=${message.serverId}, local_id=${message.localId}`,
        )
      }
    }
    if (duplicates.length > 0) {
      deduplicatedCount++
      continue
    }
    if (hasServerId(message.serverId)) serverIds.set(message.serverId, message)
    messageUids.set(message.messageUid, message)
    result.push(message)
  }
  return { messages: result, deduplicatedCount }
}

export function parseConversationMessages(snapshot: SnapshotDescriptor, username: string, sources: readonly MessageSource[]) {
  const table = `Msg_${md5(username)}`
  const isGroup = username.endsWith('@chatroom')
  const displayNames = new Map([...snapshot.contactMap].map(([id, contact]) => [id, contact.display]))
  const collected: ParsedMessage[] = []

  for (const source of sources) {
    if (!source.tables.has(table)) continue
    for (const row of readSourceMessages(source.db, table, source.tables)) {
      const context = `${snapshot.name}/${source.filename}/${table}/${row.localId}`
      const primary = decodeContent(row.messageContent, `${context}:message_content`)
      const content = primary || decodeContent(row.compressedContent, `${context}:compress_content`)
      const type = normalizeMessageType(row.rawType)
      const extracted = extractText(type, content, isGroup)
      const identity = resolveSenderIdentity({
        isGroup,
        conversationUsername: username,
        ownerUsername: snapshot.owner,
        messageName2IdSender: source.idToName.get(row.realSenderId),
        groupPrefixSender: extracted.senderPrefix,
        privateDirection: 'unknown',
        displayNames,
      })
      collected.push({
        messageUid: createMessageUid(snapshot.owner, username, source.filename, table, row.localId, row.serverId),
        sourceSnapshot: snapshot.name,
        sourceDb: source.filename,
        sourceTable: table,
        localId: row.localId,
        serverId: row.serverId,
        sortSeq: row.sortSeq,
        time: row.createTime,
        sender: identity.sender,
        senderName: identity.senderName,
        senderPrefix: extracted.senderPrefix,
        isOwn: identity.sender === snapshot.owner ? 1 : 0,
        senderSource: identity.source,
        senderAudit: identity.auditReason ?? '',
        rawType: row.rawType,
        type,
        typeLabel: typeLabel(type),
        text: extracted.text,
      })
    }
  }

  const deduplicated = deduplicateMessages(collected.sort(stableMessageSort))
  return {
    ...deduplicated,
    sourceMessageCount: collected.length,
  }
}

export function createSchema(out: DatabaseSync) {
  out.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE contacts(
      account TEXT, owner TEXT, username TEXT, display TEXT, nick TEXT, remark TEXT, alias TEXT, is_group INTEGER
    );
    CREATE TABLE conversations(
      id TEXT PRIMARY KEY, account TEXT, owner TEXT, username TEXT, display TEXT, is_group INTEGER,
      msg_count INTEGER, text_count INTEGER, first_time INTEGER, last_time INTEGER, summary TEXT
    );
    CREATE TABLE messages(
      conv_id TEXT, message_uid TEXT, seq INTEGER, source_snapshot TEXT, source_db TEXT, source_table TEXT,
      local_id INTEGER, server_id TEXT, sort_seq INTEGER, time INTEGER, sender TEXT, sender_name TEXT,
      sender_prefix TEXT, is_own INTEGER, sender_source TEXT, sender_audit TEXT,
      raw_type INTEGER, type INTEGER, type_label TEXT, text TEXT
    );
    CREATE TABLE parse_runs(
      run_id TEXT PRIMARY KEY, status TEXT, completed_at TEXT,
      selected_snapshot_count INTEGER, selected_source_count INTEGER,
      source_conversation_count INTEGER, source_message_count INTEGER,
      output_conversation_count INTEGER, output_message_count INTEGER, output_text_count INTEGER,
      deduplicated_message_count INTEGER
    );
    CREATE INDEX idx_msg_conv_order ON messages(conv_id, time, sort_seq, source_db, local_id);
    CREATE UNIQUE INDEX idx_msg_uid ON messages(message_uid);
    CREATE UNIQUE INDEX idx_msg_evidence ON messages(conv_id, source_db, source_table, local_id);
    CREATE UNIQUE INDEX idx_msg_server ON messages(conv_id, server_id)
      WHERE server_id IS NOT NULL AND trim(server_id)<>'' AND server_id<>'0';
  `)
}

function buildRunId() {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return `${timestamp}-${process.pid}`
}

export function parserPaths(root: string): ParserPaths {
  const configuredRunId = process.env.CHATFILES_RUN_ID?.trim()
  const runId = configuredRunId || buildRunId()
  if (!/^[0-9A-Za-z._-]+$/.test(runId)) throw new Error('CHATFILES_RUN_ID contains unsafe path characters')
  const bundleDir = path.join(root, 'data', 'wechat.next')
  return {
    root,
    decryptRoot: path.join(root, 'work', 'decrypted', 'wechat'),
    bundleDir,
    outDbPath: path.join(bundleDir, 'wechat.db'),
    indexPath: path.join(bundleDir, 'index.json'),
    transcriptDir: path.join(bundleDir, 'transcripts'),
    runId,
  }
}

export function assertFreshOutputs(paths: ParserPaths) {
  const protectedPaths = [
    paths.bundleDir,
    paths.outDbPath,
    `${paths.outDbPath}-wal`,
    `${paths.outDbPath}-shm`,
    paths.indexPath,
    paths.transcriptDir,
  ]
  const existing = protectedPaths.find((target) => fs.existsSync(target))
  if (existing) throw new Error(`Output already exists: ${existing}`)
}

export function stagingPaths(finalPaths: ParserPaths): ParserPaths {
  const token = `${finalPaths.runId}-${process.pid}`
  const bundleDir = path.join(path.dirname(finalPaths.bundleDir), `.wechat.next.${token}.staging`)
  return {
    ...finalPaths,
    bundleDir,
    outDbPath: path.join(bundleDir, 'wechat.db'),
    indexPath: path.join(bundleDir, 'index.json'),
    transcriptDir: path.join(bundleDir, 'transcripts'),
  }
}

export function promoteArtifacts(staging: ParserPaths, finalPaths: ParserPaths) {
  assertFreshOutputs(finalPaths)
  try {
    fs.renameSync(staging.bundleDir, finalPaths.bundleDir)
  } catch (error) {
    throw new Error('Unable to publish completed parse bundle', { cause: error })
  }
}
