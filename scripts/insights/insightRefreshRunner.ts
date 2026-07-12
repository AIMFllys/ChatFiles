import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  distillInsightMessages,
  formatInsightDigest,
  planInsightDelta,
  reconcileLegacyInsights,
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
}

type AuditOptions = {
  root: string
  bundleDir?: string
  databasePath?: string
}

type DeltaEntry = ReturnType<typeof planInsightDelta>['entries'][number]

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
  return convId.replace(/[<>:"/\\|?*@ -]/gu, '_').slice(0, 90)
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
  return db.prepare(`
    SELECT time, sender_name, text
    FROM messages
    WHERE conv_id = ? AND type = 1 AND length(text) > 0 AND time > ?
    ORDER BY time, rowid
  `).all(entry.conversation.id, entry.since).map((row): InsightMessage => {
    const value = row as { time: number; sender_name: string | null; text: string }
    return {
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

export function prepareInsightRefresh(options: RefreshOptions) {
  assertRunId(options.runId)
  const paths = resolvePaths(options)
  if (fs.existsSync(paths.bundleDir)) throw new Error(`Insight bundle already exists: ${paths.bundleDir}`)
  const stagingDir = path.join(
    path.dirname(paths.bundleDir),
    `.${path.basename(paths.bundleDir)}.${options.runId}.${process.pid}.staging`,
  )
  if (fs.existsSync(stagingDir)) throw new Error(`Insight staging directory already exists: ${stagingDir}`)

  const legacy = loadInsightConversations(path.join(paths.sourceDir, 'conv'))
  const states = readJson<InsightState[]>(path.join(paths.sourceDir, '_state.json'))
  const previousManifest = readJson<unknown>(path.join(paths.sourceDir, '_manifest.json'))
  const db = new DatabaseSync(paths.databasePath, { readOnly: true })
  try {
    const current = currentConversations(db)
    const reconciled = reconcileLegacyInsights({ current, legacy, states })
    if (reconciled.metrics.legacyConversationKeys !== reconciled.metrics.canonicalConversations) {
      throw new Error('One or more legacy insight conversations do not map uniquely to the current database')
    }
    const planned = planInsightDelta(current, reconciled.states, options.minimumGrowth ?? 8)
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
        const messages = queryMessages(db, entry)
        const content = formatInsightDigest(conversation, entry.kind, messages)
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
        conversations: legacy.length,
        states: states.length,
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
  const receiptPath = path.join(paths.bundleDir, 'receipt.json')
  const receipt = readJson<Record<string, unknown>>(receiptPath)
  if (receipt.runId !== options.runId) throw new Error('Insight bundle run id does not match')
  const delta = readJson<DeltaEntry[]>(path.join(paths.bundleDir, '_delta.json'))
  const states = readJson<InsightState[]>(path.join(paths.bundleDir, '_state.json'))
  const stateById = new Map(states.map((state) => [state.convId, state]))
  const db = new DatabaseSync(paths.databasePath, { readOnly: true })
  let addedNuggets = 0
  try {
    for (const entry of delta) {
      const file = path.join(paths.bundleDir, 'conv', insightFilename(entry.conversation.id))
      const existing = fs.existsSync(file) ? readJson<InsightConversation>(file) : undefined
      if (entry.kind === 'grown' && !existing) {
        throw new Error(`Grown insight conversation is missing: ${entry.conversation.id}`)
      }
      const messages = queryMessages(db, entry)
      const distilled = distillInsightMessages({
        conversation: entry.conversation,
        kind: entry.kind,
        existing,
        messages,
      })
      writeJson(file, distilled.conversation)
      addedNuggets += distilled.addedNuggets
      stateById.set(entry.conversation.id, {
        convId: entry.conversation.id,
        analyzedTextCount: entry.conversation.textCount,
        analyzedLastTime: entry.conversation.lastTime,
        analyzedAt: new Date().toISOString(),
      })
    }
  } finally {
    db.close()
  }
  const nextStates = [...stateById.values()].sort((a, b) => a.convId.localeCompare(b.convId))
  writeJson(path.join(paths.bundleDir, '_state.json'), nextStates)
  writeJson(receiptPath, {
    ...receipt,
    status: 'complete',
    completedAt: new Date().toISOString(),
    distillation: {
      processed: delta.length,
      addedNuggets,
      states: nextStates.length,
    },
  })
  return { processed: delta.length, addedNuggets, states: nextStates.length }
}

function setDifference(left: Set<string>, right: Set<string>) {
  return [...left].filter((value) => !right.has(value))
}

export function auditInsightRefresh(options: AuditOptions) {
  const paths = resolvePaths(options)
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
  const receipt = readJson<{ status?: string }>(path.join(paths.bundleDir, 'receipt.json'))
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

  let nuggets = 0
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
  const currentDir = path.resolve(paths.root, 'data', 'insights')
  const previousDir = path.resolve(paths.root, 'data', `insights.previous.${options.runId}`)
  if (!fs.existsSync(currentDir)) throw new Error('Current insight directory is missing')
  if (!fs.existsSync(paths.bundleDir)) throw new Error('Next insight directory is missing')
  if (fs.existsSync(previousDir)) throw new Error(`Previous insight directory already exists: ${previousDir}`)
  const audit = auditInsightRefresh({
    root: paths.root,
    bundleDir: paths.bundleDir,
    databasePath: paths.databasePath,
  })
  if (!audit.ok) throw new Error(`Insight bundle audit failed: ${audit.issues.join('; ')}`)

  fs.renameSync(currentDir, previousDir)
  try {
    fs.renameSync(paths.bundleDir, currentDir)
  } catch (error) {
    fs.renameSync(previousDir, currentDir)
    throw new Error('Insight activation failed and the current directory was restored', { cause: error })
  }
  return { currentDir, previousDir, audit }
}
