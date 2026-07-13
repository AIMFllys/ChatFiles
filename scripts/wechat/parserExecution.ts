import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { chooseAccountSnapshots } from './messageModel.js'
import { truncateCodePoints } from './unicodeText.js'
import {
  closeMessageSources,
  compareText,
  discoverSnapshots,
  md5,
  openMessageSources,
  readOwnerFragment,
} from './parserSnapshotDiscovery.js'
import {
  assertFreshOutputs,
  createSchema,
  parseConversationMessages,
  parserPaths,
  promoteArtifacts,
  safeFile,
  stagingPaths,
} from './parserMessageProcessing.js'
import type { ParserResult } from './parserTypes.js'

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
            summary: truncateCodePoints(summary, 120),
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
