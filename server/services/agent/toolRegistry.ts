import type { DatabaseSync } from 'node:sqlite'
import type { LinkPreview } from '../../../shared/contracts/chat.js'
import { queryTimeline, encodeTimelineCursor } from '../chatTimeline.js'
import type { DocumentReadResult } from '../documents/documentTypes.js'
import type { HybridSearchResult } from '../search/hybridSearch.js'
import { queryArtifacts } from '../../wechat/artifactQuery.js'
import { AGENT_TOOL_SCHEMAS, type AgentToolName } from './toolSchemas.js'

export type ToolRegistryDependencies = {
  wechatDb: DatabaseSync
  artifactDb: DatabaseSync
  searchMessages: (input: {
    query: string
    conversationId?: string
    sender?: string
    after?: number
    before?: number
    limit: number
  }) => Promise<HybridSearchResult>
  readDocument: (assetId: string, maxCharacters: number) => Promise<DocumentReadResult>
  resolveLinkPreview: (assetId: string, url: string) => Promise<LinkPreview>
}

export class ToolExecutionError extends Error {
  constructor(public readonly code: 'unknown_tool' | 'invalid_arguments' | 'not_found' | 'tool_failed') {
    super(code)
    this.name = 'ToolExecutionError'
  }
}

function objectArgs(value: unknown, allowed: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ToolExecutionError('invalid_arguments')
  const result = value as Record<string, unknown>
  if (Object.keys(result).some((key) => !allowed.includes(key))) throw new ToolExecutionError('invalid_arguments')
  return result
}

function textArg(args: Record<string, unknown>, key: string, maximum: number, required = false) {
  const value = args[key]
  if (value === undefined && !required) return undefined
  if (typeof value !== 'string' || value.length > maximum || (required && !value.trim())) {
    throw new ToolExecutionError('invalid_arguments')
  }
  return value.trim()
}

function integerArg(args: Record<string, unknown>, key: string, fallback: number, minimum: number, maximum: number) {
  const value = args[key]
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new ToolExecutionError('invalid_arguments')
  }
  return Number(value)
}

function citation(kind: '消息' | '文件', id: string) {
  return `[${kind}:${id}]`
}

function unique(values: string[]) {
  return [...new Set(values)]
}

function boundedText(value: string, maximum = 4_000) {
  const points = [...value]
  return points.length <= maximum ? value : points.slice(0, maximum).join('')
}

function escapedLike(value: string) {
  return `%${value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
}

function listConversations(deps: ToolRegistryDependencies, raw: unknown) {
  const args = objectArgs(raw, ['query', 'limit'])
  const query = textArg(args, 'query', 120) ?? ''
  const limit = integerArg(args, 'limit', 20, 1, 100)
  const where = query ? "WHERE display LIKE ? ESCAPE '\\'" : ''
  const rows = deps.wechatDb.prepare(`
    SELECT id,display,is_group,msg_count,text_count,first_time,last_time
    FROM conversations ${where} ORDER BY last_time DESC,id LIMIT ?
  `).all(...(query ? [escapedLike(query)] : []), limit) as Array<Record<string, unknown>>
  return { conversations: rows.map((row) => ({
    id: String(row.id), display: String(row.display), isGroup: Boolean(row.is_group),
    messageCount: Number(row.msg_count), textCount: Number(row.text_count),
    firstTime: Number(row.first_time), lastTime: Number(row.last_time),
  })) }
}

async function searchMessages(deps: ToolRegistryDependencies, raw: unknown) {
  const args = objectArgs(raw, ['query', 'conversationId', 'sender', 'after', 'before', 'limit'])
  const query = textArg(args, 'query', 500, true)!
  const limit = integerArg(args, 'limit', 20, 1, 100)
  const result = await deps.searchMessages({
    query, limit,
    ...(textArg(args, 'conversationId', 512) ? { conversationId: textArg(args, 'conversationId', 512) } : {}),
    ...(textArg(args, 'sender', 512) ? { sender: textArg(args, 'sender', 512) } : {}),
    ...(args.after !== undefined ? { after: integerArg(args, 'after', 0, 0, Number.MAX_SAFE_INTEGER) } : {}),
    ...(args.before !== undefined ? { before: integerArg(args, 'before', 0, 0, Number.MAX_SAFE_INTEGER) } : {}),
  })
  const hits = result.hits.slice(0, limit).map((hit) => ({
    conversationId: hit.conversationId, firstMessageUid: hit.firstMessageUid,
    lastMessageUid: hit.lastMessageUid, startTime: hit.startTime, endTime: hit.endTime,
    senders: hit.senderIds, text: boundedText(hit.text), citation: citation('消息', hit.firstMessageUid),
  }))
  return { mode: result.mode, reason: result.reason, hits, citations: unique(hits.map((hit) => hit.citation)) }
}

type MessageRow = { conv_id: string; message_uid: string; time: number; sender: string; sender_name: string; type_label: string; text: string }

function publicMessage(row: MessageRow) {
  return {
    conversationId: row.conv_id, messageUid: row.message_uid, time: Number(row.time),
    sender: row.sender, senderName: row.sender_name, typeLabel: row.type_label,
    text: boundedText(row.text ?? ''), citation: citation('消息', row.message_uid),
  }
}

function messageContext(deps: ToolRegistryDependencies, raw: unknown) {
  const args = objectArgs(raw, ['messageUid', 'radius'])
  const messageUid = textArg(args, 'messageUid', 512, true)!
  const radius = integerArg(args, 'radius', 5, 0, 20)
  const target = deps.wechatDb.prepare(`
    SELECT conv_id,message_uid,time,sender,sender_name,type_label,text FROM messages WHERE message_uid=?
  `).get(messageUid) as MessageRow | undefined
  if (!target) throw new ToolExecutionError('not_found')
  const projection = 'conv_id,message_uid,time,sender,sender_name,type_label,text'
  const before = deps.wechatDb.prepare(`SELECT ${projection} FROM messages WHERE conv_id=? AND
    (time<? OR (time=? AND message_uid<?)) ORDER BY time DESC,message_uid DESC LIMIT ?`)
    .all(target.conv_id, target.time, target.time, target.message_uid, radius) as MessageRow[]
  const after = deps.wechatDb.prepare(`SELECT ${projection} FROM messages WHERE conv_id=? AND
    (time>? OR (time=? AND message_uid>?)) ORDER BY time,message_uid LIMIT ?`)
    .all(target.conv_id, target.time, target.time, target.message_uid, radius) as MessageRow[]
  const messages = [...before.reverse(), target, ...after].map(publicMessage)
  return { conversationId: target.conv_id, messages, citations: messages.map((message) => message.citation) }
}

function searchArtifacts(deps: ToolRegistryDependencies, raw: unknown) {
  const args = objectArgs(raw, ['query', 'conversationId', 'category', 'limit'])
  const category = textArg(args, 'category', 20) ?? 'all'
  if (!['all', 'work', 'document', 'skill', 'link'].includes(category)) throw new ToolExecutionError('invalid_arguments')
  const page = queryArtifacts(deps.artifactDb, deps.wechatDb, {
    collection: 'outputs', tab: category as 'all' | 'work' | 'document' | 'skill' | 'link',
    query: textArg(args, 'query', 200) ?? '', limit: integerArg(args, 'limit', 20, 1, 100), offset: 0,
    ...(textArg(args, 'conversationId', 512) ? { conversationId: textArg(args, 'conversationId', 512) } : {}),
  })
  const artifacts = page.items.flatMap((item) => item.itemType === 'artifact' ? [{
    assetId: item.id, conversationId: item.conversationId, category: item.category,
    name: item.name, preview: item.preview, senderName: item.senderName,
    createdAt: item.createdAt, availability: item.availability, citation: citation('文件', item.id),
  }] : [])
  return { artifacts, citations: artifacts.map((item) => item.citation) }
}

async function readDocumentTool(deps: ToolRegistryDependencies, raw: unknown) {
  const args = objectArgs(raw, ['assetId', 'maxCharacters'])
  const assetId = textArg(args, 'assetId', 64, true)!
  if (!/^[0-9a-f]{64}$/u.test(assetId)) throw new ToolExecutionError('invalid_arguments')
  return deps.readDocument(assetId, integerArg(args, 'maxCharacters', 24_000, 1, 50_000))
}

function timelineSlice(deps: ToolRegistryDependencies, raw: unknown) {
  const args = objectArgs(raw, ['conversationId', 'aroundMessageUid', 'sender', 'query', 'limit'])
  const conversationId = textArg(args, 'conversationId', 512, true)!
  const aroundUid = textArg(args, 'aroundMessageUid', 512)
  let around: string | undefined
  if (aroundUid) {
    const anchor = deps.wechatDb.prepare('SELECT time,message_uid FROM messages WHERE conv_id=? AND message_uid=?')
      .get(conversationId, aroundUid) as { time: number; message_uid: string } | undefined
    if (!anchor) throw new ToolExecutionError('not_found')
    around = encodeTimelineCursor({ time: Number(anchor.time), messageUid: anchor.message_uid })
  }
  const page = queryTimeline(deps.wechatDb, {
    conversationId, limit: integerArg(args, 'limit', 40, 1, 100),
    ...(around ? { around } : {}), ...(textArg(args, 'sender', 512) ? { sender: textArg(args, 'sender', 512) } : {}),
    ...(textArg(args, 'query', 200) ? { query: textArg(args, 'query', 200) } : {}),
  })
  const messages = page.messages.map((message) => publicMessage({ ...message, conv_id: conversationId }))
  return { conversationId, messages, pageInfo: page.pageInfo, citations: messages.map((message) => message.citation) }
}

async function linkPreview(deps: ToolRegistryDependencies, raw: unknown) {
  const args = objectArgs(raw, ['assetId'])
  const assetId = textArg(args, 'assetId', 64, true)!
  if (!/^[0-9a-f]{64}$/u.test(assetId)) throw new ToolExecutionError('invalid_arguments')
  const row = deps.artifactDb.prepare('SELECT category,url FROM artifacts WHERE asset_id=?').get(assetId) as { category: string; url: string | null } | undefined
  if (!row || row.category !== 'link' || !row.url) throw new ToolExecutionError('not_found')
  const preview = await deps.resolveLinkPreview(assetId, row.url)
  return {
    status: preview.status, url: preview.url, domain: preview.domain, title: preview.title,
    description: preview.description, siteName: preview.siteName, updatedAt: preview.updatedAt,
    citation: citation('文件', assetId),
  }
}

export function createToolRegistry(deps: ToolRegistryDependencies) {
  return {
    schemas: AGENT_TOOL_SCHEMAS,
    async execute(name: string, args: unknown): Promise<unknown> {
      try {
        if (name === 'list_conversations') return listConversations(deps, args)
        if (name === 'search_messages') return await searchMessages(deps, args)
        if (name === 'get_message_context') return messageContext(deps, args)
        if (name === 'search_artifacts') return searchArtifacts(deps, args)
        if (name === 'read_document') return await readDocumentTool(deps, args)
        if (name === 'get_timeline_slice') return timelineSlice(deps, args)
        if (name === 'get_link_preview') return await linkPreview(deps, args)
        throw new ToolExecutionError('unknown_tool')
      } catch (error) {
        if (error instanceof ToolExecutionError) throw error
        throw new ToolExecutionError('tool_failed')
      }
    },
  } satisfies { schemas: typeof AGENT_TOOL_SCHEMAS; execute: (name: AgentToolName | string, args: unknown) => Promise<unknown> }
}
