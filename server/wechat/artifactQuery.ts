import type { DatabaseSync } from 'node:sqlite'

import type {
  ChatArtifactAvailability,
  ChatArtifactCounts,
  ChatArtifactItem,
  ChatArtifactPage,
  ChatArtifactTab,
  ChatTextItem,
} from '../../src/types/chat.js'

export type ArtifactQueryInput = {
  collection?: 'outputs' | 'library'
  conversationId?: string
  tab: ChatArtifactTab
  query: string
  limit: number
  offset: number
}

type CountRow = { category: string; count: number }

type ArtifactRow = {
  asset_id: string
  conv_id: string | null
  category: ChatArtifactItem['category']
  kind: string
  name: string
  preview: string
  url: string | null
  source_size: number | null
  created_at: number
  sender_name: string
  materialization: string
  preview_status: string
}

type ChatTextRow = {
  message_uid: string
  conv_id: string
  time: number
  sender_name: string
  text: string
}

const matchingFailureStates = new Set<ChatArtifactAvailability>([
  'missing_source',
  'decrypt_failed',
  'source_ambiguous',
  'hash_mismatch',
])

function availabilityFor(materialization: string, previewStatus: string): ChatArtifactAvailability {
  if (materialization === 'exported' && previewStatus === 'ready') return 'ready'
  if (materialization === 'exported' && previewStatus === 'unsupported_codec') return 'unsupported_codec'
  if (materialization === 'exported' && previewStatus === 'unavailable') return 'source_unavailable'
  if (materialization === 'thumbnail_only' && previewStatus === 'thumbnail_only') return 'thumbnail_only'
  if (
    materialization === previewStatus
    && matchingFailureStates.has(previewStatus as ChatArtifactAvailability)
  ) {
    return previewStatus as ChatArtifactAvailability
  }
  return 'source_unavailable'
}

function escapedLike(value: string) {
  return `%${value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
}

function scopeClause(conversationId: string | undefined) {
  return conversationId === undefined ? '' : ' AND conv_id=?'
}

function scopeParams(conversationId: string | undefined) {
  return conversationId === undefined ? [] : [conversationId]
}

function readCounts(
  assetDb: DatabaseSync,
  wechatDb: DatabaseSync,
  input: Pick<ArtifactQueryInput, 'collection' | 'conversationId'>,
) {
  const libraryOnly = input.collection === 'library'
    ? " AND materialization='exported' AND preview_status='ready'"
    : ''
  const scoped = scopeClause(input.conversationId)
  const params = scopeParams(input.conversationId)
  const rows = assetDb.prepare(`
    SELECT category, count(*) AS count
    FROM artifacts
    WHERE category IN ('work', 'document', 'skill', 'link')${libraryOnly}${scoped}
    GROUP BY category
  `).all(...params) as CountRow[]
  const counts: ChatArtifactCounts = { all: 0, work: 0, document: 0, skill: 0, link: 0, chatText: 0 }
  for (const row of rows) {
    if (row.category === 'work' || row.category === 'document' || row.category === 'skill' || row.category === 'link') {
      counts[row.category] = Number(row.count)
      counts.all += Number(row.count)
    }
  }
  if (!libraryOnly) {
    const textRow = wechatDb.prepare(`
      SELECT count(*) AS count FROM messages WHERE type=1${scoped}
    `).get(...params) as { count: number } | undefined
    counts.chatText = Number(textRow?.count ?? 0)
  }
  return counts
}

function artifactWhere(input: ArtifactQueryInput) {
  const clauses = ["category IN ('work', 'document', 'skill', 'link')"]
  const params: Array<string | number> = []
  if (input.collection === 'library') {
    clauses.push("materialization='exported'", "preview_status='ready'")
  }
  if (input.tab !== 'all' && input.tab !== 'chatText') {
    clauses.push('category=?')
    params.push(input.tab)
  }
  if (input.conversationId !== undefined) {
    clauses.push('conv_id=?')
    params.push(input.conversationId)
  }
  if (input.query) {
    clauses.push("(name LIKE ? ESCAPE '\\' OR sender_name LIKE ? ESCAPE '\\' OR text LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\')")
    const pattern = escapedLike(input.query)
    params.push(pattern, pattern, pattern, pattern)
  }
  return { sql: clauses.join(' AND '), params }
}

function queryArtifactItems(assetDb: DatabaseSync, input: ArtifactQueryInput) {
  const where = artifactWhere(input)
  const matching = assetDb.prepare(`SELECT count(*) AS count FROM artifacts WHERE ${where.sql}`)
    .get(...where.params) as { count: number } | undefined
  const rows = assetDb.prepare(`
    SELECT asset_id, conv_id, category, kind, name, preview, url, source_size, created_at,
           sender_name, materialization, preview_status
    FROM artifacts
    WHERE ${where.sql}
    ORDER BY created_at DESC, asset_id ASC
    LIMIT ? OFFSET ?
  `).all(...where.params, input.limit, input.offset) as ArtifactRow[]
  const items: ChatArtifactItem[] = rows.map((row) => ({
    id: row.asset_id,
    itemType: 'artifact',
    conversationId: row.conv_id,
    category: row.category,
    kind: row.kind,
    name: row.name,
    preview: row.preview,
    url: row.url,
    createdAt: Number(row.created_at),
    senderName: row.sender_name,
    size: row.source_size === null ? null : Number(row.source_size),
    availability: availabilityFor(row.materialization, row.preview_status),
    metadataUrl: `/api/wechat/artifact/${row.asset_id}/metadata`,
  }))
  return { matchingTotal: Number(matching?.count ?? 0), items }
}

function queryChatTextItems(wechatDb: DatabaseSync, input: ArtifactQueryInput) {
  const clauses = ['type=1']
  const params: string[] = []
  if (input.conversationId !== undefined) {
    clauses.push('conv_id=?')
    params.push(input.conversationId)
  }
  if (input.query) {
    clauses.push("(text LIKE ? ESCAPE '\\' OR sender_name LIKE ? ESCAPE '\\')")
    const pattern = escapedLike(input.query)
    params.push(pattern, pattern)
  }
  const where = clauses.join(' AND ')
  const matching = wechatDb.prepare(`SELECT count(*) AS count FROM messages WHERE ${where}`)
    .get(...params) as { count: number } | undefined
  const rows = wechatDb.prepare(`
    SELECT message_uid, conv_id, time, sender_name, text
    FROM messages
    WHERE ${where}
    ORDER BY time DESC, message_uid ASC
    LIMIT ? OFFSET ?
  `).all(...params, input.limit, input.offset) as ChatTextRow[]
  const items: ChatTextItem[] = rows.map((row) => ({
    id: `chat:${row.message_uid}`,
    itemType: 'chatText',
    conversationId: row.conv_id,
    messageUid: row.message_uid,
    createdAt: Number(row.time),
    senderName: row.sender_name,
    content: row.text,
  }))
  return { matchingTotal: Number(matching?.count ?? 0), items }
}

export function queryArtifacts(
  assetDb: DatabaseSync,
  wechatDb: DatabaseSync,
  input: ArtifactQueryInput,
): ChatArtifactPage {
  const counts = readCounts(assetDb, wechatDb, input)
  const result = input.tab === 'chatText'
    ? input.collection === 'library'
      ? { matchingTotal: 0, items: [] }
      : queryChatTextItems(wechatDb, input)
    : queryArtifactItems(assetDb, input)
  return {
    tab: input.tab,
    counts,
    total: counts[input.tab],
    matchingTotal: result.matchingTotal,
    offset: input.offset,
    limit: input.limit,
    items: result.items,
  }
}
