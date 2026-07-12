import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import {
  chooseAccountSnapshots,
  createMessageCoverageKey,
  createMessageSemanticFingerprint,
  normalizeMessageType,
  resolveSenderIdentity,
  type AccountSnapshot,
} from './messageModel.js'
import {
  contactDisplayName,
  decodeContent,
  extractText,
  strictUtf8,
  typeLabel,
} from './messageParsing.js'
import {
  listMessageTables,
  loadMessageName2Id,
  readSourceMessages,
} from './sourceReader.js'

type Contact = {
  username: string
  display: string
  nick: string
  remark: string
  alias: string
  isGroup: boolean
}

type Session = { summary: string; lastTime: number }

type SnapshotDescriptor = {
  dir: string
  name: string
  owner: string
  contactMap: Map<string, Contact>
  sessionMap: Map<string, Session>
  selection: AccountSnapshot
  sourceCount: number
  sourceMessageCount: number
}

type MessageSource = {
  db: DatabaseSync
  filename: string
  tables: Set<string>
  idToName: Map<number, string>
}

type ParsedMessage = {
  messageUid: string
  sourceSnapshot: string
  sourceDb: string
  sourceTable: string
  localId: number
  serverId: string
  sortSeq: number
  time: number
  sender: string
  senderName: string
  senderPrefix: string
  isOwn: number
  senderSource: string
  senderAudit: string
  rawType: string
  type: number
  typeLabel: string
  text: string
}

export type ParserPaths = {
  root: string
  decryptRoot: string
  bundleDir: string
  outDbPath: string
  indexPath: string
  transcriptDir: string
  runId: string
}

export type ParserResult = {
  paths: ParserPaths
  conversations: number
  messages: number
  selectedSnapshots: string[]
  excludedSnapshots: string[]
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

function md5(value: string) {
  return crypto.createHash('md5').update(value, 'utf8').digest('hex')
}

function sha256(value: string) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex')
}

function rawBytes(value: unknown): Buffer {
  if (value == null) return Buffer.alloc(0)
  if (typeof value === 'string') return Buffer.from(value, 'utf8')
  if (value instanceof Uint8Array) return Buffer.from(value)
  return Buffer.from(String(value), 'utf8')
}

function rawContentHash(messageContent: unknown, compressedContent: unknown) {
  const messageBytes = rawBytes(messageContent)
  const useCompressed = messageBytes.length === 0 && compressedContent != null
  const bytes = useCompressed ? rawBytes(compressedContent) : messageBytes
  const source = useCompressed ? 'compress_content' : 'message_content'
  return crypto.createHash('sha256').update(source, 'utf8').update('\u0000').update(bytes).digest('hex')
}

function parseEnvValue(raw: string) {
  const value = raw.trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value.replace(/\s+#.*$/, '').trim()
}

function readOwnerFragment(root: string) {
  const envPath = path.join(root, '.env.local')
  if (!fs.existsSync(envPath)) throw new Error(`Owner configuration not found: ${envPath}`)
  const envText = strictUtf8(fs.readFileSync(envPath), envPath)
  const line = envText.split(/\r?\n/).find((item) => /^\s*VITE_OWNER_WXID\s*=/.test(item))
  if (!line) throw new Error('VITE_OWNER_WXID is required in .env.local')
  const fragment = parseEnvValue(line.slice(line.indexOf('=') + 1))
  if (!fragment) throw new Error('VITE_OWNER_WXID must contain a non-empty owner id fragment')
  return fragment
}

function readContacts(snapshotDir: string) {
  const contactPath = path.join(snapshotDir, 'db_storage', 'contact', 'contact.db')
  if (!fs.existsSync(contactPath)) throw new Error(`Contact database not found: ${contactPath}`)
  const db = new DatabaseSync(contactPath, { readOnly: true })
  try {
    const map = new Map<string, Contact>()
    const rows = db.prepare('SELECT username, nick_name, remark, alias FROM contact').all() as Array<Record<string, unknown>>
    for (const row of rows) {
      const username = String(row.username ?? '').trim()
      if (!username) continue
      const nick = String(row.nick_name ?? '').trim()
      const remark = String(row.remark ?? '').trim()
      const alias = String(row.alias ?? '').trim()
      map.set(username, {
        username,
        display: contactDisplayName(username, nick, remark, alias),
        nick,
        remark,
        alias,
        isGroup: username.endsWith('@chatroom'),
      })
    }
    try {
      const rooms = db.prepare('SELECT username FROM chat_room').all() as Array<{ username: string }>
      for (const row of rooms) {
        const username = String(row.username ?? '').trim()
        if (username && !map.has(username)) {
          map.set(username, {
            username,
            display: username,
            nick: '',
            remark: '',
            alias: '',
            isGroup: true,
          })
        }
      }
    } catch {
      // Some WeChat snapshots do not have chat_room.
    }
    return map
  } finally {
    db.close()
  }
}

function resolveOwner(contactMap: ReadonlyMap<string, Contact>, fragment: string, snapshotName: string) {
  const matches = [...contactMap.keys()].filter(
    (username) => !username.endsWith('@chatroom') && username.includes(fragment),
  )
  if (matches.length !== 1) {
    throw new Error(
      `Snapshot ${snapshotName} must resolve exactly one canonical owner from VITE_OWNER_WXID; found ${matches.length}`,
    )
  }
  return matches[0]
}

function readSessions(snapshotDir: string) {
  const sessionPath = path.join(snapshotDir, 'db_storage', 'session', 'session.db')
  const map = new Map<string, Session>()
  if (!fs.existsSync(sessionPath)) return map
  const db = new DatabaseSync(sessionPath, { readOnly: true })
  try {
    try {
      const rows = db.prepare('SELECT username, summary, last_timestamp FROM SessionTable').all() as Array<Record<string, unknown>>
      for (const row of rows) {
        const username = String(row.username ?? '').trim()
        if (!username) continue
        map.set(username, {
          summary: decodeContent(row.summary, `${sessionPath}:SessionTable:${username}`),
          lastTime: Number(row.last_timestamp ?? 0),
        })
      }
    } catch (error) {
      if (error instanceof Error && /no such table/i.test(error.message)) return map
      throw error
    }
    return map
  } finally {
    db.close()
  }
}

function openMessageSources(snapshotDir: string): MessageSource[] {
  const sourceDir = path.join(snapshotDir, 'db_storage', 'message')
  const sources: MessageSource[] = []
  try {
    for (const filename of ['message_0.db', 'message_1.db']) {
      const sourcePath = path.join(sourceDir, filename)
      if (!fs.existsSync(sourcePath)) continue
      const db = new DatabaseSync(sourcePath, { readOnly: true })
      sources.push({
        db,
        filename,
        tables: listMessageTables(db),
        idToName: loadMessageName2Id(db),
      })
    }
    if (sources.length === 0) throw new Error(`No message shards found under ${sourceDir}`)
    return sources
  } catch (error) {
    for (const source of sources) source.db.close()
    throw error
  }
}

function closeMessageSources(sources: readonly MessageSource[]) {
  for (const source of sources) source.db.close()
}

function hasServerId(serverId: string) {
  const value = serverId.trim()
  return value !== '' && value !== '0'
}

function loadSnapshot(snapshotDir: string, snapshotName: string, ownerFragment: string): SnapshotDescriptor {
  const contactMap = readContacts(snapshotDir)
  const owner = resolveOwner(contactMap, ownerFragment, snapshotName)
  const sessionMap = readSessions(snapshotDir)
  const usernames = [...new Set([...contactMap.keys(), ...sessionMap.keys()])].sort(compareText)
  const sources = openMessageSources(snapshotDir)
  try {
    const conversations: Array<AccountSnapshot['conversations'][number]> = []
    let sourceMessageCount = 0
    for (const username of usernames) {
      const table = `Msg_${md5(username)}`
      const messageKeys = new Set<string>()
      let firstMessageTime = Number.POSITIVE_INFINITY
      for (const source of sources) {
        if (!source.tables.has(table)) continue
        for (const message of readSourceMessages(source.db, table, source.tables)) {
          sourceMessageCount++
          messageKeys.add(createMessageCoverageKey({
            sourceDb: source.filename,
            sourceTable: table,
            localId: message.localId,
            serverId: message.serverId,
            rawType: message.rawType,
            time: message.createTime,
            realSender: source.idToName.get(message.realSenderId) ?? '',
            contentHash: rawContentHash(message.messageContent, message.compressedContent),
          }))
          firstMessageTime = Math.min(firstMessageTime, message.createTime)
        }
      }
      if (messageKeys.size > 0) {
        conversations.push({
          conversationId: username,
          firstMessageTime,
          messageKeys: [...messageKeys].sort(compareText),
        })
      }
    }
    const updatedAt = Math.max(
      ...sources.map((source) => fs.statSync(path.join(snapshotDir, 'db_storage', 'message', source.filename)).mtimeMs),
    )
    return {
      dir: snapshotDir,
      name: snapshotName,
      owner,
      contactMap,
      sessionMap,
      sourceCount: sources.length,
      sourceMessageCount,
      selection: {
        snapshotId: snapshotName,
        ownerIdentity: owner,
        updatedAt,
        conversations,
      },
    }
  } finally {
    closeMessageSources(sources)
  }
}

function discoverSnapshots(decryptRoot: string, ownerFragment: string) {
  if (!fs.existsSync(decryptRoot)) throw new Error(`Decrypted WeChat root not found: ${decryptRoot}`)
  const directories = fs.readdirSync(decryptRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(decryptRoot, entry.name, 'db_storage')))
    .sort((left, right) => compareText(left.name, right.name))
  if (directories.length === 0) throw new Error(`No decrypted account snapshots found under ${decryptRoot}`)
  return directories.map((entry) => loadSnapshot(path.join(decryptRoot, entry.name), entry.name, ownerFragment))
}

function safeFile(name: string) {
  const unsafeCharacters = new Set('<>:"/\\|?*')
  return [...name]
    .map((character) => character.charCodeAt(0) <= 0x1f || unsafeCharacters.has(character) ? '_' : character)
    .join('')
    .slice(0, 80)
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

function parseConversationMessages(snapshot: SnapshotDescriptor, username: string, sources: readonly MessageSource[]) {
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

function createSchema(out: DatabaseSync) {
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

function parserPaths(root: string): ParserPaths {
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

function assertFreshOutputs(paths: ParserPaths) {
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

function stagingPaths(finalPaths: ParserPaths): ParserPaths {
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

function promoteArtifacts(staging: ParserPaths, finalPaths: ParserPaths) {
  assertFreshOutputs(finalPaths)
  try {
    fs.renameSync(staging.bundleDir, finalPaths.bundleDir)
  } catch (error) {
    throw new Error('Unable to publish completed parse bundle', { cause: error })
  }
}

export function runWeChatParser(root = path.resolve(process.cwd())): ParserResult {
  const paths = parserPaths(root)
  const staging = stagingPaths(paths)
  assertFreshOutputs(paths)
  assertFreshOutputs(staging)
  const ownerFragment = readOwnerFragment(root)
  const discovered = discoverSnapshots(paths.decryptRoot, ownerFragment)
  const selection = chooseAccountSnapshots(discovered.map((snapshot) => snapshot.selection))
  if (selection.warnings.length > 0) {
    const detail = selection.warnings
      .map((warning) => `${warning.ownerIdentity || '<unknown>'}: ${warning.snapshotIds.join(', ')}`)
      .join('; ')
    throw new Error(`Ambiguous account snapshots; refusing to merge: ${detail}`)
  }

  const selectedIds = new Set(selection.selected.map((snapshot) => snapshot.snapshotId))
  const selected = discovered.filter((snapshot) => selectedIds.has(snapshot.name))
  fs.mkdirSync(path.dirname(staging.bundleDir), { recursive: true })
  fs.mkdirSync(staging.bundleDir)
  fs.mkdirSync(staging.transcriptDir)
  const outputHandle = fs.openSync(staging.outDbPath, 'wx')
  fs.closeSync(outputHandle)

  const out = new DatabaseSync(staging.outDbPath)
  const indexRows: Array<Record<string, unknown>> = []
  let totalMessages = 0
  let totalTextMessages = 0
  let processedSourceConversations = 0
  let processedSourceMessages = 0
  let deduplicatedMessages = 0
  const selectedSourceCount = selected.reduce((total, snapshot) => total + snapshot.sourceCount, 0)
  const expectedSourceConversations = selected.reduce(
    (total, snapshot) => total + snapshot.selection.conversations.length,
    0,
  )
  const expectedSourceMessages = selected.reduce((total, snapshot) => total + snapshot.sourceMessageCount, 0)
  try {
    createSchema(out)
    const insertContact = out.prepare('INSERT INTO contacts VALUES (?,?,?,?,?,?,?,?)')
    const insertConversation = out.prepare('INSERT INTO conversations VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    const insertMessage = out.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')

    for (const snapshot of selected) {
      const sources = openMessageSources(snapshot.dir)
      let transactionOpen = false
      try {
        out.exec('BEGIN')
        transactionOpen = true
        for (const contact of snapshot.contactMap.values()) {
          insertContact.run(
            snapshot.name,
            snapshot.owner,
            contact.username,
            contact.display,
            contact.nick,
            contact.remark,
            contact.alias,
            contact.isGroup ? 1 : 0,
          )
        }

        const usernames = [...new Set([...snapshot.contactMap.keys(), ...snapshot.sessionMap.keys()])].sort(compareText)
        for (const username of usernames) {
          const parsed = parseConversationMessages(snapshot, username, sources)
          const { messages } = parsed
          if (messages.length === 0) continue
          processedSourceConversations++
          processedSourceMessages += parsed.sourceMessageCount
          deduplicatedMessages += parsed.deduplicatedCount
          const contact = snapshot.contactMap.get(username)
          const isGroup = username.endsWith('@chatroom')
          const display = contact?.display || username
          const conversationId = `wx:${snapshot.owner}:${username}`
          let textCount = 0
          messages.forEach((message, seq) => {
            insertMessage.run(
              conversationId,
              message.messageUid,
              seq,
              message.sourceSnapshot,
              message.sourceDb,
              message.sourceTable,
              message.localId,
              message.serverId,
              message.sortSeq,
              message.time,
              message.sender,
              message.senderName,
              message.senderPrefix,
              message.isOwn,
              message.senderSource,
              message.senderAudit,
              BigInt(message.rawType),
              message.type,
              message.typeLabel,
              message.text,
            )
            if (message.type === 1 && message.text) textCount++
          })

          const firstTime = messages[0].time
          const lastTime = messages[messages.length - 1].time
          const summary = snapshot.sessionMap.get(username)?.summary ?? ''
          insertConversation.run(
            conversationId,
            snapshot.name,
            snapshot.owner,
            username,
            display,
            isGroup ? 1 : 0,
            messages.length,
            textCount,
            firstTime,
            lastTime,
            summary,
          )
          indexRows.push({
            id: conversationId,
            account: snapshot.name,
            owner: snapshot.owner,
            username,
            display,
            isGroup,
            msgCount: messages.length,
            textCount,
            firstTime,
            lastTime,
            summary: summary.slice(0, 120),
          })
          totalMessages += messages.length
          totalTextMessages += textCount

          if (textCount > 0) {
            const lines = messages.filter((message) => message.text).map((message) => {
              const timestamp = new Date(message.time * 1000).toISOString().slice(0, 16).replace('T', ' ')
              const who = message.senderName || message.sender || (isGroup ? '未知群成员' : '未知发送人')
              return `[${timestamp}] ${who}: ${message.text}`
            })
            const header = [
              `# ${display}${isGroup ? '（群聊）' : ''}`,
              `owner: ${snapshot.owner}`,
              `username: ${username}`,
              `messages: ${messages.length} (text ${textCount})`,
              '',
              '',
            ].join('\n')
            const transcriptName = `${safeFile(`${display}__${username}`)}__${md5(username).slice(0, 8)}.txt`
            fs.writeFileSync(
              path.join(staging.transcriptDir, transcriptName),
              header + lines.join('\n'),
              { encoding: 'utf8', flag: 'wx' },
            )
          }
        }
        out.exec('COMMIT')
        transactionOpen = false
      } catch (error) {
        if (transactionOpen) out.exec('ROLLBACK')
        throw error
      } finally {
        closeMessageSources(sources)
      }
    }

    if (indexRows.length === 0 || totalMessages === 0) {
      throw new Error('Refusing to complete an empty WeChat parse')
    }
    if (
      processedSourceConversations !== expectedSourceConversations
      || processedSourceMessages !== expectedSourceMessages
      || processedSourceMessages !== totalMessages + deduplicatedMessages
    ) {
      throw new Error(
        `Parse source/output counts do not close: source conversations ${processedSourceConversations}/${expectedSourceConversations}, source messages ${processedSourceMessages}/${expectedSourceMessages}, output ${totalMessages}, deduplicated ${deduplicatedMessages}`,
      )
    }
    out.prepare('INSERT INTO parse_runs VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
      paths.runId,
      'complete',
      new Date().toISOString(),
      selected.length,
      selectedSourceCount,
      processedSourceConversations,
      processedSourceMessages,
      indexRows.length,
      totalMessages,
      totalTextMessages,
      deduplicatedMessages,
    )
    out.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  } finally {
    out.close()
  }

  indexRows.sort((left, right) => (
    Number(right.lastTime) - Number(left.lastTime)
    || compareText(String(left.id), String(right.id))
  ))
  const index = {
    generatedAt: new Date().toISOString(),
    runId: paths.runId,
    selectedSnapshots: selected.map((snapshot) => ({ account: snapshot.name, owner: snapshot.owner })),
    excludedSnapshots: selection.excluded,
    totalConversations: indexRows.length,
    totalMessages,
    conversations: indexRows,
  }
  fs.writeFileSync(staging.indexPath, JSON.stringify(index, null, 2), { encoding: 'utf8', flag: 'wx' })
  promoteArtifacts(staging, paths)

  return {
    paths,
    conversations: indexRows.length,
    messages: totalMessages,
    selectedSnapshots: selected.map((snapshot) => snapshot.name),
    excludedSnapshots: selection.excluded.map((snapshot) => snapshot.snapshotId),
  }
}
