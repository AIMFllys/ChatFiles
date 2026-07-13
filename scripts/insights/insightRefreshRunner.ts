import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import {
  distillInsightMessages,
  formatInsightDigest,
  insightNuggetEvidenceKey,
  planInsightDelta,
  reconcileLegacyInsights,
  renderInsightBoard,
  type InsightBoardRecord,
  type CurrentInsightConversation,
  type InsightConversation,
  type InsightMessage,
  type InsightState,
} from './insightRefresh.js'

type RefreshOptions = {
  root: string
  runId: string
  sourceDir?: string
  bundleDir?: string
  databasePath?: string
  minimumGrowth?: number
  aliasMapPath?: string
  activationRename?: (source: string, target: string) => void
}

type AuditOptions = {
  root: string
  bundleDir?: string
  databasePath?: string
}

type DeltaEntry = ReturnType<typeof planInsightDelta>['entries'][number]

type OwnerAliasMap = {
  version: number
  canonicalOwner: string
  aliases: Record<string, string>
  evidence: Array<Record<string, unknown>>
}

const allowedCategories = new Set([
  '技术',
  '哲理',
  '学业',
  '创业',
  '比赛',
  'AI',
  '人物',
  '资源工具',
  '生活',
  '健康',
  '财务',
  '专业',
  '其他',
])

function assertRunId(runId: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(runId)) {
    throw new Error('Run id must contain only safe ASCII filename characters')
  }
}

function resolvePaths(options: RefreshOptions | AuditOptions) {
  const root = path.resolve(options.root)
  return {
    root,
    sourceDir: path.resolve(root, 'sourceDir' in options && options.sourceDir ? options.sourceDir : 'data/insights'),
    bundleDir: path.resolve(root, options.bundleDir ?? 'data/insights.next'),
    databasePath: path.resolve(root, options.databasePath ?? 'data/wechat.current/wechat.db'),
  }
}

function assertContained(base: string, target: string, label: string) {
  const relative = path.relative(base, target)
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    return
  }
  throw new Error(`${label} must stay inside the data root`)
}

function assertDistinctPaths(pathsToCheck: Array<{ label: string; value: string }>) {
  for (let left = 0; left < pathsToCheck.length; left++) {
    for (let right = left + 1; right < pathsToCheck.length; right++) {
      const a = pathsToCheck[left]!
      const b = pathsToCheck[right]!
      const relative = path.relative(a.value, b.value)
      const reverse = path.relative(b.value, a.value)
      if (
        relative === ''
        || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
        || (!reverse.startsWith(`..${path.sep}`) && reverse !== '..' && !path.isAbsolute(reverse))
      ) {
        throw new Error(`${a.label} and ${b.label} must be distinct, non-nested paths`)
      }
    }
  }
}

function assertNoLinkedPath(root: string, target: string, label: string) {
  const relative = path.relative(root, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return
  let current = root
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    if (!fs.existsSync(current)) break
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`${label} must not use a symlink or junction`)
  }
}

function assertDataRoles(paths: ReturnType<typeof resolvePaths>, mode: 'prepare' | 'candidate' | 'audit') {
  const dataRoot = path.join(paths.root, 'data')
  assertContained(dataRoot, paths.sourceDir, 'Insight source')
  assertContained(dataRoot, paths.bundleDir, 'Insight bundle')
  assertContained(dataRoot, paths.databasePath, 'WeChat database')
  assertNoLinkedPath(paths.root, paths.sourceDir, 'Insight source')
  assertNoLinkedPath(paths.root, paths.bundleDir, 'Insight bundle')
  assertNoLinkedPath(paths.root, paths.databasePath, 'WeChat database')
  if (paths.databasePath !== path.join(dataRoot, 'wechat.current', 'wechat.db')) {
    throw new Error('WeChat database must be data/wechat.current/wechat.db')
  }
  if (mode !== 'audit' && paths.bundleDir !== path.join(dataRoot, 'insights.next')) {
    throw new Error('Writable insight bundle must be data/insights.next')
  }
  if (mode === 'prepare') {
    const sourceName = path.basename(paths.sourceDir)
    if (sourceName !== 'insights' && !sourceName.startsWith('insights.previous.')) {
      throw new Error('Insight source must be the current or a retained previous insight directory')
    }
    assertDistinctPaths([
      { label: 'Insight source', value: paths.sourceDir },
      { label: 'Insight bundle', value: paths.bundleDir },
      { label: 'WeChat database', value: paths.databasePath },
    ])
  }
}

function sha256File(file: string) {
  const handle = fs.openSync(file, 'r')
  const hash = createHash('sha256')
  const buffer = Buffer.allocUnsafe(4 * 1024 * 1024)
  try {
    let offset = 0
    while (true) {
      const read = fs.readSync(handle, buffer, 0, buffer.length, offset)
      if (read === 0) break
      hash.update(buffer.subarray(0, read))
      offset += read
    }
  } finally {
    fs.closeSync(handle)
  }
  return hash.digest('hex')
}

function sha256Text(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function databaseFingerprint(databasePath: string) {
  const stats = fs.statSync(databasePath)
  return { sha256: sha256File(databasePath), size: stats.size }
}

function assertDatabaseFingerprint(expected: { sha256: string; size: number }, databasePath: string) {
  const actual = databaseFingerprint(databasePath)
  if (actual.sha256 !== expected.sha256 || actual.size !== expected.size) {
    throw new Error('WeChat database fingerprint changed between insight refresh stages')
  }
}

function loadOwnerAliases(options: RefreshOptions, root: string, canonicalOwners: Set<string>) {
  if (canonicalOwners.size !== 1) throw new Error('Insight refresh requires exactly one canonical owner')
  const canonicalOwner = [...canonicalOwners][0]!
  if (!options.aliasMapPath) return {
    aliases: {} as Record<string, string>,
    evidence: { status: 'not-required', canonicalOwner },
  }
  const aliasMapPath = path.resolve(root, options.aliasMapPath)
  const auditRoot = path.join(root, 'work', 'audits')
  const relative = path.relative(auditRoot, aliasMapPath)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Owner alias map must stay inside work/audits')
  }
  const aliasMap = readJson<OwnerAliasMap>(aliasMapPath)
  if (
    aliasMap.version !== 1
    || aliasMap.canonicalOwner !== canonicalOwner
    || !aliasMap.aliases
    || !Array.isArray(aliasMap.evidence)
    || aliasMap.evidence.length === 0
  ) throw new Error('Owner alias map is incomplete or targets the wrong canonical owner')
  for (const target of Object.values(aliasMap.aliases)) {
    if (target !== canonicalOwner) throw new Error('Owner alias map contains a non-canonical target')
  }
  return {
    aliases: aliasMap.aliases,
    evidence: {
      status: 'validated',
      canonicalOwner,
      path: path.relative(root, aliasMapPath).replaceAll('\\', '/'),
      sha256: sha256File(aliasMapPath),
      entries: Object.keys(aliasMap.aliases).length,
    },
  }
}

function readUtf8(file: string) {
  return new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(file))
}

function readJson<T>(file: string) {
  return JSON.parse(readUtf8(file)) as T
}

function writeJson(file: string, value: unknown, exclusive = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    flag: exclusive ? 'wx' : 'w',
  })
}

function safeInsightId(convId: string) {
  return Array.from(convId.replace(/[<>:"/\\|?*@ -]/gu, '_')).slice(0, 90).join('')
}

function currentConversations(db: DatabaseSync) {
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

function insightFilename(convId: string) {
  return `${safeInsightId(convId)}.json`
}

function loadInsightConversations(directory: string) {
  const filenames = fs.readdirSync(directory).filter((file) => file.endsWith('.json')).sort()
  return filenames.map((file) => readJson<InsightConversation>(path.join(directory, file)))
}

function queryMessages(db: DatabaseSync, entry: DeltaEntry) {
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

function copyBoards(sourceDir: string, targetDir: string) {
  fs.mkdirSync(targetDir)
  const sourceBoards = path.join(sourceDir, 'boards')
  if (!fs.existsSync(sourceBoards)) return 0
  const files = fs.readdirSync(sourceBoards).filter((file) => file.endsWith('.md')).sort()
  for (const file of files) {
    fs.copyFileSync(path.join(sourceBoards, file), path.join(targetDir, file), fs.constants.COPYFILE_EXCL)
  }
  return files.length
}

function copyDirectoryExclusive(source: string, target: string) {
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

export function prepareInsightRefresh(options: RefreshOptions) {
  assertRunId(options.runId)
  const paths = resolvePaths(options)
  assertDataRoles(paths, 'prepare')
  if (fs.existsSync(paths.bundleDir)) throw new Error(`Insight bundle already exists: ${paths.bundleDir}`)
  const stagingDir = path.join(
    path.dirname(paths.bundleDir),
    `.${path.basename(paths.bundleDir)}.${options.runId}.${process.pid}.staging`,
  )
  if (fs.existsSync(stagingDir)) throw new Error(`Insight staging directory already exists: ${stagingDir}`)

  const statePath = path.join(paths.sourceDir, '_state.json')
  const manifestPath = path.join(paths.sourceDir, '_manifest.json')
  const legacy = loadInsightConversations(path.join(paths.sourceDir, 'conv'))
  const states = readJson<InsightState[]>(statePath)
  const previousManifest = readJson<unknown>(manifestPath)
  const database = databaseFingerprint(paths.databasePath)
  const db = new DatabaseSync(paths.databasePath, { readOnly: true })
  try {
    const current = currentConversations(db)
    const canonicalOwners = new Set(current.map((conversation) => conversation.id.split(':')[1]!))
    const ownerAliases = loadOwnerAliases(options, paths.root, canonicalOwners)
    const reconciled = reconcileLegacyInsights({
      current,
      legacy,
      states,
      ownerAliases: ownerAliases.aliases,
    })
    if (reconciled.metrics.legacyConversationKeys !== reconciled.metrics.canonicalConversations) {
      throw new Error('One or more legacy insight conversations do not map uniquely to the current database')
    }
    const planned = planInsightDelta(current, reconciled.states, options.minimumGrowth ?? 8)
    const deltaInputs = new Map<string, { messages: InsightMessage[]; content: string }>()
    let queriedRows = 0
    for (const entry of planned.entries) {
      const messages = queryMessages(db, entry)
      const expectedGrowth = entry.conversation.textCount - entry.previousTextCount
      if (messages.length !== expectedGrowth) {
        throw new Error(
          `Conversation text growth does not close against queried rows: ${entry.conversation.id} `
          + `(growth=${expectedGrowth}, rows=${messages.length})`,
        )
      }
      queriedRows += messages.length
      deltaInputs.set(entry.conversation.id, {
        messages,
        content: formatInsightDigest(entry.conversation, entry.kind, messages),
      })
    }
    const filenames = new Set<string>()
    for (const conversation of current) {
      const filename = insightFilename(conversation.id)
      if (filenames.has(filename)) throw new Error(`Insight filename collision: ${filename}`)
      filenames.add(filename)
    }

    fs.mkdirSync(stagingDir, { recursive: false })
    fs.mkdirSync(path.join(stagingDir, 'conv'))
    fs.mkdirSync(path.join(stagingDir, 'digests'))
    const boards = copyBoards(paths.sourceDir, path.join(stagingDir, 'boards'))
    for (const conversation of reconciled.conversations) {
      writeJson(path.join(stagingDir, 'conv', insightFilename(conversation.convId)), conversation, true)
    }

    const manifest = current.map((conversation) => {
      const entry = planned.entries.find((candidate) => candidate.conversation.id === conversation.id)
      let chars = 0
      const digest = entry ? `digests/${safeInsightId(conversation.id)}.txt` : ''
      if (entry) {
        const content = deltaInputs.get(conversation.id)!.content
        chars = Array.from(content).length
        fs.writeFileSync(path.join(stagingDir, digest), content, { encoding: 'utf8', flag: 'wx' })
      }
      return {
        convId: conversation.id,
        name: conversation.display,
        isGroup: conversation.isGroup,
        textCount: conversation.textCount,
        chars,
        sampled: chars >= 52_000,
        digest,
        first: new Date(conversation.firstTime * 1000).toISOString().slice(0, 10),
        last: new Date(conversation.lastTime * 1000).toISOString().slice(0, 10),
      }
    })
    writeJson(path.join(stagingDir, '_manifest.prev.json'), previousManifest, true)
    writeJson(path.join(stagingDir, '_manifest.json'), manifest, true)
    writeJson(path.join(stagingDir, '_state.json'), reconciled.states, true)
    writeJson(path.join(stagingDir, '_delta.json'), planned.entries, true)
    writeJson(path.join(stagingDir, 'receipt.json'), {
      version: 1,
      runId: options.runId,
      status: 'prepared',
      preparedAt: new Date().toISOString(),
      source: {
        directory: path.relative(paths.root, paths.sourceDir).replaceAll('\\', '/'),
        conversations: legacy.length,
        states: states.length,
        manifestSha256: sha256File(manifestPath),
        stateSha256: sha256File(statePath),
      },
      database,
      ownerAliases: ownerAliases.evidence,
      baselineEvidence: reconciled.conversations.map((conversation) => ({
        convId: conversation.convId,
        nuggetHashes: conversation.nuggets.map((nugget) => sha256Text(insightNuggetEvidenceKey(nugget))),
        summaryHashes: (conversation.legacySummaries ?? []).map((entry) =>
          sha256Text(`${entry.convId}\n${entry.summary}`),
        ),
      })),
      deltaEvidence: {
        conversations: planned.entries.length,
        queriedRows,
        textGrowth: planned.entries.reduce(
          (sum, entry) => sum + entry.conversation.textCount - entry.previousTextCount,
          0,
        ),
      },
      metrics: {
        ...reconciled.metrics,
        currentConversations: current.length,
        boards,
        delta: planned.metrics,
      },
    }, true)
    fs.renameSync(stagingDir, paths.bundleDir)
    return {
      bundleDir: paths.bundleDir,
      metrics: reconciled.metrics,
      delta: planned.metrics,
    }
  } finally {
    db.close()
  }
}

export function distillInsightRefresh(options: RefreshOptions) {
  assertRunId(options.runId)
  const paths = resolvePaths(options)
  assertDataRoles(paths, 'candidate')
  const receiptPath = path.join(paths.bundleDir, 'receipt.json')
  const receipt = readJson<Record<string, unknown> & {
    database?: { sha256: string; size: number }
  }>(receiptPath)
  if (receipt.runId !== options.runId) throw new Error('Insight bundle run id does not match')
  if (!receipt.database) throw new Error('Insight bundle is missing a database fingerprint')
  assertDatabaseFingerprint(receipt.database, paths.databasePath)
  const distillStagingDir = path.join(
    path.dirname(paths.bundleDir),
    `.${path.basename(paths.bundleDir)}.${options.runId}.${process.pid}.distill.staging`,
  )
  const preparedBackupDir = path.join(path.dirname(paths.bundleDir), `insights.prepared.${options.runId}`)
  if (fs.existsSync(distillStagingDir)) throw new Error(`Distill staging directory already exists: ${distillStagingDir}`)
  if (fs.existsSync(preparedBackupDir)) throw new Error(`Prepared insight backup already exists: ${preparedBackupDir}`)
  copyDirectoryExclusive(paths.bundleDir, distillStagingDir)
  const stagingReceiptPath = path.join(distillStagingDir, 'receipt.json')
  const delta = readJson<DeltaEntry[]>(path.join(distillStagingDir, '_delta.json'))
  const states = readJson<InsightState[]>(path.join(distillStagingDir, '_state.json'))
  const stateById = new Map(states.map((state) => [state.convId, state]))
  const db = new DatabaseSync(paths.databasePath, { readOnly: true })
  let addedNuggets = 0
  let inputRows = 0
  let eligibleRows = 0
  let selectedRows = 0
  try {
    for (const entry of delta) {
      const file = path.join(distillStagingDir, 'conv', insightFilename(entry.conversation.id))
      const existing = fs.existsSync(file) ? readJson<InsightConversation>(file) : undefined
      if (entry.kind === 'grown' && !existing) {
        throw new Error(`Grown insight conversation is missing: ${entry.conversation.id}`)
      }
      const messages = queryMessages(db, entry)
      const expectedGrowth = entry.conversation.textCount - entry.previousTextCount
      if (messages.length !== expectedGrowth) {
        throw new Error(`Conversation text growth does not close during distillation: ${entry.conversation.id}`)
      }
      const distilled = distillInsightMessages({
        conversation: entry.conversation,
        kind: entry.kind,
        existing,
        messages,
      })
      writeJson(file, distilled.conversation)
      addedNuggets += distilled.addedNuggets
      inputRows += distilled.metrics.inputRows
      eligibleRows += distilled.metrics.eligibleRows
      selectedRows += distilled.metrics.selectedRows
      const lastMessage = messages.at(-1)!
      stateById.set(entry.conversation.id, {
        convId: entry.conversation.id,
        analyzedTextCount: entry.conversation.textCount,
        analyzedLastTime: lastMessage.time,
        analyzedLastMessageUid: lastMessage.messageUid,
        analyzedAt: new Date().toISOString(),
      })
    }
  } finally {
    db.close()
  }
  const nextStates = [...stateById.values()].sort((a, b) => a.convId.localeCompare(b.convId))
  writeJson(path.join(distillStagingDir, '_state.json'), nextStates)
  writeJson(stagingReceiptPath, {
    ...receipt,
    status: 'complete',
    completedAt: new Date().toISOString(),
    distillation: {
      processed: delta.length,
      inputRows,
      eligibleRows,
      selectedRows,
      addedNuggets,
      states: nextStates.length,
    },
  })
  fs.renameSync(paths.bundleDir, preparedBackupDir)
  try {
    fs.renameSync(distillStagingDir, paths.bundleDir)
  } catch (error) {
    fs.renameSync(preparedBackupDir, paths.bundleDir)
    throw new Error('Distilled insight publication failed and the prepared bundle was restored', { cause: error })
  }
  return {
    processed: delta.length,
    inputRows,
    eligibleRows,
    selectedRows,
    addedNuggets,
    states: nextStates.length,
    preparedBackupDir,
  }
}

export function rebuildInsightBoards(options: RefreshOptions) {
  assertRunId(options.runId)
  const paths = resolvePaths(options)
  assertDataRoles(paths, 'candidate')
  const receiptPath = path.join(paths.bundleDir, 'receipt.json')
  const receipt = readJson<Record<string, unknown> & {
    database?: { sha256: string; size: number }
  }>(receiptPath)
  if (receipt.runId !== options.runId) throw new Error('Insight bundle run id does not match')
  if (receipt.status !== 'complete') throw new Error('Insight distillation must complete before boards are rebuilt')
  if (!receipt.database) throw new Error('Insight bundle is missing a database fingerprint')
  assertDatabaseFingerprint(receipt.database, paths.databasePath)
  const insights = loadInsightConversations(path.join(paths.bundleDir, 'conv'))
  const byCategory = new Map<string, InsightBoardRecord[]>()
  for (const conversation of insights) {
    for (const nugget of conversation.nuggets ?? []) {
      if (!allowedCategories.has(nugget.category)) {
        throw new Error(`Cannot build a board for invalid category: ${nugget.category}`)
      }
      const records = byCategory.get(nugget.category) ?? []
      records.push({
        convId: conversation.convId,
        conversationName: conversation.name,
        nugget,
      })
      byCategory.set(nugget.category, records)
    }
  }
  const boardsDir = path.join(paths.bundleDir, 'boards')
  const boardsStagingDir = path.join(paths.bundleDir, `.boards.${options.runId}.${process.pid}.staging`)
  const previousBoardsDir = path.join(paths.bundleDir, `boards.pre-refresh.${options.runId}`)
  if (!fs.existsSync(boardsDir)) throw new Error('Prepared insight boards are missing')
  if (fs.existsSync(boardsStagingDir)) throw new Error(`Board staging directory already exists: ${boardsStagingDir}`)
  if (fs.existsSync(previousBoardsDir)) throw new Error(`Previous boards directory already exists: ${previousBoardsDir}`)
  fs.mkdirSync(boardsStagingDir)
  for (const [category, records] of [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b, 'zh-CN'))) {
    fs.writeFileSync(
      path.join(boardsStagingDir, `${category}.md`),
      renderInsightBoard(category, records),
      { encoding: 'utf8', flag: 'wx' },
    )
  }
  fs.renameSync(boardsDir, previousBoardsDir)
  try {
    fs.renameSync(boardsStagingDir, boardsDir)
  } catch (error) {
    fs.renameSync(previousBoardsDir, boardsDir)
    throw new Error('Board publication failed and the previous boards were restored', { cause: error })
  }
  const nuggets = [...byCategory.values()].reduce((sum, records) => sum + records.length, 0)
  writeJson(receiptPath, {
    ...receipt,
    boardBuild: {
      status: 'complete',
      generatedAt: new Date().toISOString(),
      boards: byCategory.size,
      nuggets,
    },
  })
  return { boards: byCategory.size, nuggets }
}

function setDifference(left: Set<string>, right: Set<string>) {
  return [...left].filter((value) => !right.has(value))
}

export function auditInsightRefresh(options: AuditOptions) {
  const paths = resolvePaths(options)
  assertDataRoles(paths, 'audit')
  const issues: string[] = []
  const db = new DatabaseSync(paths.databasePath, { readOnly: true })
  let current: CurrentInsightConversation[]
  try {
    current = currentConversations(db)
  } finally {
    db.close()
  }
  const manifest = readJson<Array<{ convId: string; name: string; isGroup: boolean; textCount: number }>>(
    path.join(paths.bundleDir, '_manifest.json'),
  )
  const states = readJson<InsightState[]>(path.join(paths.bundleDir, '_state.json'))
  const receipt = readJson<{
    status?: string
    database?: { sha256: string; size: number }
    boardBuild?: { status?: string; boards?: number; nuggets?: number }
    deltaEvidence?: { conversations?: number; queriedRows?: number; textGrowth?: number }
    distillation?: {
      processed?: number
      inputRows?: number
      eligibleRows?: number
      selectedRows?: number
      addedNuggets?: number
    }
    baselineEvidence?: Array<{
      convId: string
      nuggetHashes: string[]
      summaryHashes: string[]
    }>
  }>(path.join(paths.bundleDir, 'receipt.json'))
  if (!receipt.database) issues.push('receipt is missing the database fingerprint')
  else {
    try {
      assertDatabaseFingerprint(receipt.database, paths.databasePath)
    } catch {
      issues.push('database fingerprint does not match the prepared insight bundle')
    }
  }
  const convDir = path.join(paths.bundleDir, 'conv')
  const files = fs.readdirSync(convDir).filter((file) => file.endsWith('.json')).sort()
  const insights = files.map((file) => ({ file, value: readJson<InsightConversation>(path.join(convDir, file)) }))
  const currentById = new Map(current.map((conversation) => [conversation.id, conversation]))
  const manifestById = new Map(manifest.map((conversation) => [conversation.convId, conversation]))
  const insightById = new Map(insights.map((entry) => [entry.value.convId, entry]))
  const stateById = new Map(states.map((state) => [state.convId, state]))
  const expectedIds = new Set(currentById.keys())

  for (const [label, values] of [
    ['manifest', manifestById],
    ['insight', insightById],
    ['state', stateById],
  ] as const) {
    if (values.size !== expectedIds.size) issues.push(`${label} count does not match current conversations`)
    const missing = setDifference(expectedIds, new Set(values.keys()))
    const extra = setDifference(new Set(values.keys()), expectedIds)
    if (missing.length > 0) issues.push(`${label} is missing ${missing.length} current conversation ids`)
    if (extra.length > 0) issues.push(`${label} contains ${extra.length} unknown conversation ids`)
  }
  if (manifestById.size !== manifest.length) issues.push('manifest contains duplicate conversation ids')
  if (insightById.size !== insights.length) issues.push('insight files contain duplicate conversation ids')
  if (stateById.size !== states.length) issues.push('state contains duplicate conversation ids')
  if (receipt.status !== 'complete') issues.push('receipt is not complete')
  if (receipt.boardBuild?.status !== 'complete') issues.push('board build is not complete')
  const deltaEvidence = receipt.deltaEvidence
  const distillation = receipt.distillation
  if (!deltaEvidence || !distillation) issues.push('receipt is missing delta closure evidence')
  else if (
    deltaEvidence.queriedRows !== deltaEvidence.textGrowth
    || distillation.processed !== deltaEvidence.conversations
    || distillation.inputRows !== deltaEvidence.queriedRows
    || Number(distillation.eligibleRows) > Number(distillation.inputRows)
    || Number(distillation.selectedRows) > Number(distillation.eligibleRows)
    || Number(distillation.addedNuggets) > Number(distillation.selectedRows)
  ) issues.push('delta closure evidence does not reconcile')
  if (!Array.isArray(receipt.baselineEvidence)) issues.push('receipt is missing baseline insight evidence')
  else {
    let missingBaselineNuggets = 0
    let missingBaselineSummaries = 0
    for (const baseline of receipt.baselineEvidence) {
      const insight = insightById.get(baseline.convId)?.value
      if (!insight) {
        missingBaselineNuggets += baseline.nuggetHashes.length
        missingBaselineSummaries += baseline.summaryHashes.length
        continue
      }
      const currentNuggets = new Set(
        (insight.nuggets ?? []).map((nugget) => sha256Text(insightNuggetEvidenceKey(nugget))),
      )
      const currentSummaries = new Set(
        (insight.legacySummaries ?? []).map((entry) => sha256Text(`${entry.convId}\n${entry.summary}`)),
      )
      missingBaselineNuggets += baseline.nuggetHashes.filter((hash) => !currentNuggets.has(hash)).length
      missingBaselineSummaries += baseline.summaryHashes.filter((hash) => !currentSummaries.has(hash)).length
    }
    if (missingBaselineNuggets > 0) {
      issues.push(`baseline insight evidence is missing ${missingBaselineNuggets} nuggets`)
    }
    if (missingBaselineSummaries > 0) {
      issues.push(`baseline insight evidence is missing ${missingBaselineSummaries} summaries`)
    }
  }
  const cursorDb = new DatabaseSync(paths.databasePath, { readOnly: true })
  try {
    const cursorExists = cursorDb.prepare(`
      SELECT count(*) AS count
      FROM messages
      WHERE conv_id = ? AND message_uid = ? AND time = ? AND type = 1 AND length(text) > 0
    `)
    for (const state of states) {
      if (!state.analyzedLastMessageUid) continue
      const match = cursorExists.get(
        state.convId,
        state.analyzedLastMessageUid,
        state.analyzedLastTime,
      ) as { count: number }
      if (Number(match.count) !== 1) issues.push(`state cursor does not resolve for ${state.convId}`)
    }
  } finally {
    cursorDb.close()
  }

  let nuggets = 0
  const insightCategories = new Set<string>()
  for (const conversation of current) {
    const manifestEntry = manifestById.get(conversation.id)
    const insightEntry = insightById.get(conversation.id)
    const state = stateById.get(conversation.id)
    if (manifestEntry && (
      manifestEntry.name !== conversation.display ||
      manifestEntry.isGroup !== conversation.isGroup ||
      Number(manifestEntry.textCount) !== conversation.textCount
    )) issues.push(`manifest metadata mismatch for ${conversation.id}`)
    if (insightEntry) {
      const insight = insightEntry.value
      if (insightEntry.file !== insightFilename(conversation.id)) {
        issues.push(`insight filename mismatch for ${conversation.id}`)
      }
      if (insight.name !== conversation.display || insight.isGroup !== conversation.isGroup) {
        issues.push(`insight metadata mismatch for ${conversation.id}`)
      }
      for (const nugget of insight.nuggets ?? []) {
        nuggets++
        insightCategories.add(nugget.category)
        if (!allowedCategories.has(nugget.category)) issues.push(`invalid nugget category for ${conversation.id}`)
        if (!nugget.title?.trim() || !nugget.content?.trim()) issues.push(`empty nugget content for ${conversation.id}`)
        if (Array.from(nugget.content ?? '').length > 140) issues.push(`oversized nugget content for ${conversation.id}`)
        if (nugget.importance !== undefined && (
          !Number.isInteger(nugget.importance) || nugget.importance < 1 || nugget.importance > 5
        )) issues.push(`invalid nugget importance for ${conversation.id}`)
      }
    }
    if (state && (
      state.analyzedTextCount > conversation.textCount ||
      state.analyzedLastTime > conversation.lastTime
    )) issues.push(`state exceeds current conversation high-water mark for ${conversation.id}`)
  }
  const boardsDir = path.join(paths.bundleDir, 'boards')
  const boards = fs.existsSync(boardsDir)
    ? fs.readdirSync(boardsDir).filter((file) => file.endsWith('.md')).length
    : 0
  const boardCategories = new Set(
    fs.existsSync(boardsDir)
      ? fs.readdirSync(boardsDir).filter((file) => file.endsWith('.md')).map((file) => file.replace(/\.md$/u, ''))
      : [],
  )
  if (setDifference(insightCategories, boardCategories).length > 0) {
    issues.push('boards are missing one or more insight categories')
  }
  if (setDifference(boardCategories, insightCategories).length > 0) {
    issues.push('boards contain one or more stale categories')
  }
  if (receipt.boardBuild?.boards !== boards || receipt.boardBuild?.nuggets !== nuggets) {
    issues.push('board receipt counts do not match insight content')
  }
  if (boardsDir && fs.existsSync(boardsDir)) {
    for (const file of fs.readdirSync(boardsDir).filter((name) => name.endsWith('.md'))) {
      readUtf8(path.join(boardsDir, file))
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    metrics: {
      currentConversations: current.length,
      manifestConversations: manifest.length,
      insightConversations: insights.length,
      stateConversations: states.length,
      nuggets,
      boards,
    },
  }
}

export function activateInsightRefresh(options: RefreshOptions) {
  assertRunId(options.runId)
  const paths = resolvePaths(options)
  assertDataRoles(paths, 'candidate')
  const currentDir = path.resolve(paths.root, 'data', 'insights')
  const previousDir = path.resolve(paths.root, 'data', `insights.previous.${options.runId}`)
  const journalPath = path.resolve(paths.root, 'data', `.insights-activation.${options.runId}.json`)
  const rename = options.activationRename ?? fs.renameSync
  if (fs.existsSync(journalPath)) {
    const previousJournal = readJson<{ status?: string }>(journalPath)
    if (
      previousJournal.status === 'current_moved'
      && !fs.existsSync(currentDir)
      && fs.existsSync(previousDir)
    ) {
      rename(previousDir, currentDir)
      writeJson(journalPath, {
        version: 1,
        runId: options.runId,
        status: 'recovered',
        recoveredAt: new Date().toISOString(),
      })
    }
  }
  if (!fs.existsSync(currentDir)) throw new Error('Current insight directory is missing')
  if (!fs.existsSync(paths.bundleDir)) throw new Error('Next insight directory is missing')
  if (fs.existsSync(previousDir)) throw new Error(`Previous insight directory already exists: ${previousDir}`)
  const audit = auditInsightRefresh({
    root: paths.root,
    bundleDir: paths.bundleDir,
    databasePath: paths.databasePath,
  })
  if (!audit.ok) throw new Error(`Insight bundle audit failed: ${audit.issues.join('; ')}`)

  writeJson(journalPath, {
    version: 1,
    runId: options.runId,
    status: 'validated',
    validatedAt: new Date().toISOString(),
    current: 'data/insights',
    next: 'data/insights.next',
    previous: `data/insights.previous.${options.runId}`,
    audit: audit.metrics,
  })
  rename(currentDir, previousDir)
  writeJson(journalPath, {
    version: 1,
    runId: options.runId,
    status: 'current_moved',
    movedAt: new Date().toISOString(),
  })
  try {
    rename(paths.bundleDir, currentDir)
  } catch (error) {
    let rollbackError: unknown
    try {
      rename(previousDir, currentDir)
    } catch (cause) {
      rollbackError = cause
    }
    if (rollbackError) {
      writeJson(journalPath, {
        version: 1,
        runId: options.runId,
        status: 'rollback_failed',
        failedAt: new Date().toISOString(),
        failure: 'current_restore_failed',
      })
      throw new Error('Insight activation and rollback both failed; recovery journal was retained', {
        cause: error,
      })
    }
    writeJson(journalPath, {
      version: 1,
      runId: options.runId,
      status: 'rolled_back',
      rolledBackAt: new Date().toISOString(),
      failure: 'candidate_publication_failed',
    })
    throw new Error('Insight activation failed and the current directory was restored', { cause: error })
  }
  writeJson(journalPath, {
    version: 1,
    runId: options.runId,
    status: 'activated',
    activatedAt: new Date().toISOString(),
    previous: `data/insights.previous.${options.runId}`,
    audit: audit.metrics,
  })
  return { currentDir, previousDir, journalPath, audit }
}
