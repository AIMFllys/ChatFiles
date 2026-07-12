import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { normalizeMessageType, resolveSenderIdentity } from './messageModel.js'
import { contactDisplayName, decodeContent, extractText } from './messageParsing.js'
import {
  listMessageTables,
  loadMessageName2Id,
  readSourceMessages,
  type SourceMessage,
} from './sourceReader.js'

export type SourceIdentityAuditIssue = {
  code: string
  count: number
  detail: string
  samples: string[]
}

export type SourceIdentityAuditResult = {
  ok: boolean
  metrics: {
    outputConversations: number
    matchedConversationDisplays: number
    outputMessages: number
    matchedMessages: number
    sourceShards: number
    sourceTables: number
    sourceRowsScanned: number
    outputReplacementCharacters: number
    sourceVerifiedReplacementCharacters: number
  }
  issues: SourceIdentityAuditIssue[]
}

type OutputConversation = {
  id: string
  sourceSnapshot: string
  owner: string
  username: string
  display: string
}

type OutputMessage = {
  convId: string
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
  text: string
  conversationSnapshot: string
  owner: string
  peer: string
  isGroup: boolean
}

type OutputMessageWithRawType = OutputMessage & { rawType: string }

type SourceShard = {
  db: DatabaseSync
  tables: ReadonlySet<string>
  idToName: ReadonlyMap<number, string>
  displayNames: ReadonlyMap<string, string>
}

type MutableIssue = {
  count: number
  detail: string
  samples: string[]
}

const requiredConversationColumns = ['id', 'account', 'owner', 'username', 'display', 'is_group']
const requiredMessageColumns = [
  'conv_id',
  'message_uid',
  'source_snapshot',
  'source_db',
  'source_table',
  'local_id',
  'server_id',
  'sort_seq',
  'time',
  'sender',
  'sender_name',
  'sender_prefix',
  'text',
  'raw_type',
]

const issueDetails: Readonly<Record<string, string>> = {
  'source-output-schema-missing-column': 'The output database is missing columns required for source alignment.',
  'source-conversation-missing': 'An output message does not resolve to its conversation metadata.',
  'source-conversation-id-mismatch': 'The output conversation id is not the canonical owner/username identity.',
  'source-conversation-snapshot-mismatch': 'A message source snapshot differs from its conversation snapshot.',
  'source-conversation-display-mismatch': 'The conversation display differs from the source snapshot contact display.',
  'source-contact-unreadable': 'The source snapshot contact database cannot be read for display verification.',
  'source-path-invalid': 'Output provenance contains a snapshot or shard name that is not one path segment.',
  'source-shard-missing': 'The source message database named by output provenance does not exist.',
  'source-shard-unreadable': 'The source message database or its shard-local Name2Id table cannot be read.',
  'source-table-missing': 'The message table named by output provenance is absent from its source shard.',
  'source-message-table-mismatch': 'The output message table is not the UTF-8 username-derived source table.',
  'source-table-unreadable': 'The message table named by output provenance cannot be read as a batch.',
  'source-row-missing': 'No source row has the local_id named by the output message.',
  'source-row-ambiguous': 'More than one source row has the same local_id in one source table.',
  'source-server-id-mismatch': 'The output server_id differs from the exact source value.',
  'source-raw-type-mismatch': 'The output raw_type differs from the exact 64-bit source value.',
  'source-time-mismatch': 'The output time differs from the source create_time.',
  'source-sort-seq-mismatch': 'The output sort_seq differs from the source sort_seq.',
  'source-sender-mismatch': 'The output sender differs from the sender resolved in the same source shard.',
  'source-sender-name-mismatch': 'The output sender_name differs from the source snapshot contact display.',
  'source-group-prefix-mismatch': 'The output group sender_prefix differs from the prefix in the source body.',
  'source-text-mismatch': 'The output text differs from text normalized from the exact source content.',
  'source-content-decode-failed': 'Source message bytes cannot be decoded as strict UTF-8 for prefix verification.',
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}

function columnNames(db: DatabaseSync, table: string) {
  return new Set(
    (db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as Array<{ name: string }>).map(
      (row) => row.name,
    ),
  )
}

function emptyMetrics(): SourceIdentityAuditResult['metrics'] {
  return {
    outputConversations: 0,
    matchedConversationDisplays: 0,
    outputMessages: 0,
    matchedMessages: 0,
    sourceShards: 0,
    sourceTables: 0,
    sourceRowsScanned: 0,
    outputReplacementCharacters: 0,
    sourceVerifiedReplacementCharacters: 0,
  }
}

function addIssue(
  issues: Map<string, MutableIssue>,
  code: string,
  count: number,
  sample?: string,
) {
  if (count <= 0) return
  const issue = issues.get(code) ?? {
    count: 0,
    detail: issueDetails[code] ?? code,
    samples: [],
  }
  issue.count += count
  if (sample && issue.samples.length < 5 && !issue.samples.includes(sample)) issue.samples.push(sample)
  issues.set(code, issue)
}

function finalIssues(issues: ReadonlyMap<string, MutableIssue>): SourceIdentityAuditIssue[] {
  return [...issues].map(([code, issue]) => ({ code, ...issue }))
}

function isSinglePathSegment(value: string) {
  return value !== '' && value !== '.' && value !== '..' && path.basename(value) === value
}

function evidence(message: OutputMessage) {
  return `${message.sourceSnapshot}/${message.sourceDb}/${message.sourceTable}/${message.localId} (${message.messageUid})`
}

function fieldSample(message: OutputMessage, output: string | number, source: string | number) {
  return `${evidence(message)} output=${String(output)} source=${String(source)}`
}

function countReplacementCharacters(value: string) {
  let count = 0
  for (const character of value) {
    if (character === '\uFFFD') count++
  }
  return count
}

function sourceMessageTable(username: string) {
  const digest = crypto.createHash('md5').update(username, 'utf8').digest('hex')
  return `Msg_${digest}`
}

function loadSnapshotDisplayNames(snapshotDir: string) {
  const contactPath = path.join(snapshotDir, 'db_storage', 'contact', 'contact.db')
  if (!fs.existsSync(contactPath)) throw new Error(`Contact database not found: ${contactPath}`)
  const db = new DatabaseSync(contactPath, { readOnly: true })
  try {
    const displayNames = new Map<string, string>()
    const rows = db.prepare('SELECT username, nick_name, remark, alias FROM contact').all() as Array<
      Record<string, unknown>
    >
    for (const row of rows) {
      const username = String(row.username ?? '').trim()
      if (!username) continue
      displayNames.set(username, contactDisplayName(
        username,
        String(row.nick_name ?? ''),
        String(row.remark ?? ''),
        String(row.alias ?? ''),
      ))
    }
    return displayNames
  } finally {
    db.close()
  }
}

function outputConversations(db: DatabaseSync): Iterable<OutputConversation> {
  const rows = db.prepare(`
    SELECT id, COALESCE(account, '') AS account, COALESCE(owner, '') AS owner,
      COALESCE(username, '') AS username, COALESCE(display, '') AS display
    FROM conversations
    ORDER BY id
  `).iterate() as Iterable<Record<string, unknown>>
  return {
    *[Symbol.iterator]() {
      for (const row of rows) {
        yield {
          id: String(row.id ?? ''),
          sourceSnapshot: String(row.account ?? ''),
          owner: String(row.owner ?? ''),
          username: String(row.username ?? ''),
          display: String(row.display ?? ''),
        }
      }
    },
  }
}

function outputMessages(db: DatabaseSync): Iterable<OutputMessageWithRawType> {
  const statement = db.prepare(`
    SELECT
      m.conv_id AS conv_id,
      COALESCE(m.message_uid, '') AS message_uid,
      COALESCE(m.source_snapshot, '') AS source_snapshot,
      COALESCE(m.source_db, '') AS source_db,
      COALESCE(m.source_table, '') AS source_table,
      m.local_id AS local_id,
      CAST(m.server_id AS TEXT) AS server_id,
      m.sort_seq AS sort_seq,
      m.time AS time,
      COALESCE(m.sender, '') AS sender,
      COALESCE(m.sender_name, '') AS sender_name,
      COALESCE(m.sender_prefix, '') AS sender_prefix,
      COALESCE(m.text, '') AS text,
      CAST(m.raw_type AS TEXT) AS raw_type,
      COALESCE(c.account, '') AS conversation_snapshot,
      COALESCE(c.owner, '') AS owner,
      COALESCE(c.username, '') AS peer,
      c.is_group AS is_group
    FROM messages m
    LEFT JOIN conversations c ON c.id=m.conv_id
    ORDER BY m.source_snapshot, m.source_db, m.source_table, m.local_id, m.message_uid
  `)

  const rows = statement.iterate() as Iterable<Record<string, unknown>>
  return {
    *[Symbol.iterator]() {
      for (const row of rows) {
        yield {
          convId: String(row.conv_id ?? ''),
          messageUid: String(row.message_uid ?? ''),
          sourceSnapshot: String(row.source_snapshot ?? ''),
          sourceDb: String(row.source_db ?? ''),
          sourceTable: String(row.source_table ?? ''),
          localId: Number(row.local_id),
          serverId: String(row.server_id ?? ''),
          sortSeq: Number(row.sort_seq),
          time: Number(row.time),
          sender: String(row.sender ?? '').trim(),
          senderName: String(row.sender_name ?? ''),
          senderPrefix: String(row.sender_prefix ?? '').trim(),
          text: String(row.text ?? ''),
          conversationSnapshot: String(row.conversation_snapshot ?? ''),
          owner: String(row.owner ?? ''),
          peer: String(row.peer ?? ''),
          isGroup: Number(row.is_group) === 1,
          rawType: String(row.raw_type ?? ''),
        }
      }
    },
  }
}

function groupKey(message: OutputMessage) {
  return `${message.sourceSnapshot}\u0000${message.sourceDb}\u0000${message.sourceTable}`
}

function compareSourceRow(
  message: OutputMessageWithRawType,
  row: SourceMessage,
  shard: SourceShard,
  issues: Map<string, MutableIssue>,
  metrics: SourceIdentityAuditResult['metrics'],
) {
  if (message.serverId !== row.serverId) {
    addIssue(issues, 'source-server-id-mismatch', 1, fieldSample(message, message.serverId, row.serverId))
  }
  if (message.rawType !== row.rawType) {
    addIssue(issues, 'source-raw-type-mismatch', 1, fieldSample(message, message.rawType, row.rawType))
  }
  if (message.time !== row.createTime) {
    addIssue(issues, 'source-time-mismatch', 1, fieldSample(message, message.time, row.createTime))
  }
  if (message.sortSeq !== row.sortSeq) {
    addIssue(issues, 'source-sort-seq-mismatch', 1, fieldSample(message, message.sortSeq, row.sortSeq))
  }

  const isGroup = message.peer.endsWith('@chatroom')
  let extracted: ReturnType<typeof extractText>
  try {
    const context = evidence(message)
    const primary = decodeContent(row.messageContent, `${context}:message_content`)
    const content = primary || decodeContent(row.compressedContent, `${context}:compress_content`)
    extracted = extractText(normalizeMessageType(row.rawType), content, isGroup)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    addIssue(issues, 'source-content-decode-failed', 1, `${evidence(message)} ${reason}`)
    return
  }

  if (isGroup && message.senderPrefix !== extracted.senderPrefix) {
    addIssue(
      issues,
      'source-group-prefix-mismatch',
      1,
      fieldSample(message, message.senderPrefix, extracted.senderPrefix),
    )
  }
  if (message.text !== extracted.text) {
    addIssue(issues, 'source-text-mismatch', 1, fieldSample(message, message.text, extracted.text))
  } else {
    metrics.sourceVerifiedReplacementCharacters += countReplacementCharacters(message.text)
  }

  const identity = resolveSenderIdentity({
    isGroup,
    conversationUsername: message.peer,
    ownerUsername: message.owner,
    messageName2IdSender: shard.idToName.get(row.realSenderId),
    groupPrefixSender: extracted.senderPrefix,
    privateDirection: 'unknown',
    displayNames: shard.displayNames,
  })
  const senderMatches = message.sender === identity.sender
  if (!senderMatches) {
    addIssue(
      issues,
      'source-sender-mismatch',
      1,
      fieldSample(message, message.sender, identity.sender || '<unknown>'),
    )
  }
  const senderNameMatches = message.senderName === identity.senderName
  if (!senderNameMatches) {
    addIssue(
      issues,
      'source-sender-name-mismatch',
      1,
      fieldSample(message, message.senderName, identity.senderName),
    )
  } else if (senderMatches) {
    metrics.sourceVerifiedReplacementCharacters += countReplacementCharacters(message.senderName)
  }
}

export function auditSourceIdentity(outputDbPath: string, sourceRoot: string): SourceIdentityAuditResult {
  if (!fs.existsSync(outputDbPath)) throw new Error(`WeChat database not found: ${outputDbPath}`)
  if (!fs.existsSync(sourceRoot)) throw new Error(`Decrypted WeChat root not found: ${sourceRoot}`)

  const issues = new Map<string, MutableIssue>()
  const metrics = emptyMetrics()
  const resolvedSourceRoot = path.resolve(sourceRoot)
  const output = new DatabaseSync(outputDbPath, { readOnly: true })
  const shards = new Map<string, SourceShard>()
  const displayNamesBySnapshot = new Map<string, ReadonlyMap<string, string>>()
  const sourceTablesByUsername = new Map<string, string>()
  try {
    const conversationColumns = columnNames(output, 'conversations')
    const messageColumns = columnNames(output, 'messages')
    const missingColumns = [
      ...requiredConversationColumns
        .filter((column) => !conversationColumns.has(column))
        .map((column) => `conversations.${column}`),
      ...requiredMessageColumns
        .filter((column) => !messageColumns.has(column))
        .map((column) => `messages.${column}`),
    ]
    if (missingColumns.length > 0) {
      addIssue(
        issues,
        'source-output-schema-missing-column',
        missingColumns.length,
        missingColumns.join(', '),
      )
      return { ok: false, metrics, issues: finalIssues(issues) }
    }

    for (const conversation of outputConversations(output)) {
      metrics.outputConversations++
      const replacementCharacters = countReplacementCharacters(conversation.display)
      metrics.outputReplacementCharacters += replacementCharacters
      if (conversation.id !== `wx:${conversation.owner}:${conversation.username}`) {
        addIssue(issues, 'source-conversation-id-mismatch', 1)
      }
      if (!isSinglePathSegment(conversation.sourceSnapshot)) {
        addIssue(
          issues,
          'source-path-invalid',
          1,
          `${conversation.sourceSnapshot}/${conversation.id}`,
        )
        continue
      }

      let displayNames = displayNamesBySnapshot.get(conversation.sourceSnapshot)
      if (!displayNames) {
        try {
          displayNames = loadSnapshotDisplayNames(
            path.join(resolvedSourceRoot, conversation.sourceSnapshot),
          )
          displayNamesBySnapshot.set(conversation.sourceSnapshot, displayNames)
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          addIssue(
            issues,
            'source-contact-unreadable',
            1,
            `${conversation.sourceSnapshot}/${conversation.id} ${reason}`,
          )
          continue
        }
      }

      const sourceDisplay = displayNames.get(conversation.username) ?? conversation.username
      if (conversation.display !== sourceDisplay) {
        addIssue(
          issues,
          'source-conversation-display-mismatch',
          1,
          `${conversation.sourceSnapshot}/${conversation.id} output=${conversation.display} source=${sourceDisplay}`,
        )
      } else {
        metrics.matchedConversationDisplays++
        metrics.sourceVerifiedReplacementCharacters += replacementCharacters
      }
    }

    let currentKey = ''
    let group: OutputMessageWithRawType[] = []
    const auditGroup = (messages: readonly OutputMessageWithRawType[]) => {
      if (messages.length === 0) return
      const first = messages[0]
      metrics.sourceTables++

      for (const message of messages) {
        if (!message.owner && !message.peer) {
          addIssue(issues, 'source-conversation-missing', 1, evidence(message))
        }
        if (message.conversationSnapshot !== message.sourceSnapshot) {
          addIssue(
            issues,
            'source-conversation-snapshot-mismatch',
            1,
            fieldSample(message, message.conversationSnapshot, message.sourceSnapshot),
          )
        }
        let expectedSourceTable = sourceTablesByUsername.get(message.peer)
        if (!expectedSourceTable) {
          expectedSourceTable = sourceMessageTable(message.peer)
          sourceTablesByUsername.set(message.peer, expectedSourceTable)
        }
        if (message.sourceTable !== expectedSourceTable) {
          addIssue(issues, 'source-message-table-mismatch', 1)
        }
      }

      if (!isSinglePathSegment(first.sourceSnapshot) || !isSinglePathSegment(first.sourceDb)) {
        addIssue(issues, 'source-path-invalid', messages.length, evidence(first))
        return
      }

      const shardKey = `${first.sourceSnapshot}\u0000${first.sourceDb}`
      let shard = shards.get(shardKey)
      if (!shard) {
        const sourcePath = path.resolve(
          resolvedSourceRoot,
          first.sourceSnapshot,
          'db_storage',
          'message',
          first.sourceDb,
        )
        const relative = path.relative(resolvedSourceRoot, sourcePath)
        if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
          addIssue(issues, 'source-path-invalid', messages.length, evidence(first))
          return
        }
        if (!fs.existsSync(sourcePath)) {
          addIssue(issues, 'source-shard-missing', messages.length, sourcePath)
          return
        }
        try {
          let displayNames = displayNamesBySnapshot.get(first.sourceSnapshot)
          if (!displayNames) {
            displayNames = loadSnapshotDisplayNames(path.join(resolvedSourceRoot, first.sourceSnapshot))
            displayNamesBySnapshot.set(first.sourceSnapshot, displayNames)
          }
          const db = new DatabaseSync(sourcePath, { readOnly: true })
          try {
            shard = {
              db,
              tables: listMessageTables(db),
              idToName: loadMessageName2Id(db),
              displayNames,
            }
          } catch (error) {
            db.close()
            throw error
          }
          shards.set(shardKey, shard)
          metrics.sourceShards++
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          addIssue(issues, 'source-shard-unreadable', messages.length, `${sourcePath}: ${reason}`)
          return
        }
      }

      if (!shard.tables.has(first.sourceTable)) {
        addIssue(issues, 'source-table-missing', messages.length, evidence(first))
        return
      }

      let sourceRows: SourceMessage[]
      try {
        sourceRows = readSourceMessages(shard.db, first.sourceTable, shard.tables)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        addIssue(issues, 'source-table-unreadable', messages.length, `${evidence(first)} ${reason}`)
        return
      }
      metrics.sourceRowsScanned += sourceRows.length
      const rowsByLocalId = new Map<number, SourceMessage[]>()
      for (const row of sourceRows) {
        const rows = rowsByLocalId.get(row.localId) ?? []
        rows.push(row)
        rowsByLocalId.set(row.localId, rows)
      }

      for (const message of messages) {
        const matches = rowsByLocalId.get(message.localId) ?? []
        if (matches.length === 0) {
          addIssue(issues, 'source-row-missing', 1, evidence(message))
          continue
        }
        if (matches.length > 1) {
          addIssue(issues, 'source-row-ambiguous', 1, evidence(message))
          continue
        }
        metrics.matchedMessages++
        compareSourceRow(message, matches[0], shard, issues, metrics)
      }
    }

    for (const message of outputMessages(output)) {
      metrics.outputMessages++
      metrics.outputReplacementCharacters += countReplacementCharacters(message.text)
        + countReplacementCharacters(message.senderName)
      const key = groupKey(message)
      if (currentKey && key !== currentKey) {
        auditGroup(group)
        group = []
      }
      currentKey = key
      group.push(message)
    }
    auditGroup(group)

    const completedIssues = finalIssues(issues)
    return { ok: completedIssues.length === 0, metrics, issues: completedIssues }
  } finally {
    for (const shard of shards.values()) shard.db.close()
    output.close()
  }
}
