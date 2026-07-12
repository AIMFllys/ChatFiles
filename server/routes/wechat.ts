import fs from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

import { Router, type Response } from 'express'
import mime from 'mime'

import type {
  ChatArtifactAvailability,
  ChatArtifactCapability,
  ChatArtifactMetadata,
  ChatArtifactTab,
} from '../../src/types/chat.js'
import { root } from '../utils/helpers.js'
import { imageThumb, videoPoster } from '../utils/thumbs.js'
import { openValidatedArtifactDatabase } from '../wechat/artifactDatabase.js'
import { queryArtifacts } from '../wechat/artifactQuery.js'
import {
  createArtifactAccountRootProvider,
  createArtifactSourceResolver,
  type ArtifactSourceAsset,
  type ArtifactSourceResolution,
} from '../wechat/artifactSourceResolver.js'
import { openValidatedWechatDatabase } from '../wechat/databaseOpener.js'
import { readConversationMessages } from '../wechat/messageQuery.js'

export type DatabaseLease = {
  db: DatabaseSync | null
  release: () => void
}

export type WechatRouterDependencies = {
  openWechatDatabase: () => DatabaseLease
  openArtifactDatabase: () => DatabaseLease
  accountRootProvider: (assetDb: DatabaseSync) => string | null
  imageThumbnail: (target: string, width: number) => string
  videoThumbnail: (target: string, width: number) => string
}

const tabs = new Set<ChatArtifactTab>(['all', 'work', 'document', 'skill', 'link', 'chatText'])

function defaultWechatLease(projectRoot: string): DatabaseLease {
  const opened = openValidatedWechatDatabase(projectRoot)
  return { db: opened.db, release: () => opened.db?.close() }
}

function defaultArtifactLease(projectRoot: string): DatabaseLease {
  const opened = openValidatedArtifactDatabase(projectRoot)
  return { db: opened.db, release: () => opened.db?.close() }
}

function defaultDependencies(projectRoot: string): WechatRouterDependencies {
  return {
    openWechatDatabase: () => defaultWechatLease(projectRoot),
    openArtifactDatabase: () => defaultArtifactLease(projectRoot),
    accountRootProvider: createArtifactAccountRootProvider({ projectRoot }),
    imageThumbnail: imageThumb,
    videoThumbnail: videoPoster,
  }
}

function sendError(
  response: Response,
  status: number,
  code: string,
  state?: ChatArtifactAvailability,
) {
  return response.status(status).json({
    error: 'Request failed',
    code,
    ...(state ? { state } : {}),
  })
}

function singleQueryValue(value: unknown, fallback: string) {
  return value === undefined ? fallback : typeof value === 'string' ? value : null
}

function parseCollectionQuery(query: Record<string, unknown>) {
  const tabValue = singleQueryValue(query.tab, 'all')
  const queryValue = singleQueryValue(query.q, '')
  const limitValue = singleQueryValue(query.limit, '60')
  const offsetValue = singleQueryValue(query.offset, '0')
  if (
    tabValue === null
    || queryValue === null
    || limitValue === null
    || offsetValue === null
    || !tabs.has(tabValue as ChatArtifactTab)
    || queryValue.length > 200
    || !/^[1-9][0-9]*$/u.test(limitValue)
    || !/^(?:0|[1-9][0-9]*)$/u.test(offsetValue)
  ) return null
  const limit = Number(limitValue)
  const offset = Number(offsetValue)
  if (!Number.isSafeInteger(limit) || limit > 200 || !Number.isSafeInteger(offset)) return null
  return { tab: tabValue as ChatArtifactTab, query: queryValue.trim(), limit, offset }
}

function canonicalWechatDatabase(db: DatabaseSync) {
  try {
    const columns = db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>
    return columns.some((column) => column.name === 'message_uid')
  } catch {
    return false
  }
}

function validConversationId(id: string) {
  return id.length > 0 && id.length <= 512 && !id.includes('\u0000')
}

function publicMetadata(
  asset: ArtifactSourceAsset,
  availability: ChatArtifactAvailability,
  capabilities: ChatArtifactCapability,
): ChatArtifactMetadata {
  return {
    id: asset.id,
    itemType: 'artifact',
    conversationId: asset.conversationId,
    category: asset.category,
    kind: asset.kind,
    name: asset.name,
    preview: asset.preview,
    url: asset.url,
    createdAt: asset.createdAt,
    senderName: asset.senderName,
    availability,
    metadataUrl: capabilities.metadata,
    capabilities,
  }
}

function assetResultError(response: Response, result: ArtifactSourceResolution) {
  if (result.status === 'malformed') return sendError(response, 400, 'invalid_asset_id')
  if (result.status === 'unknown') return sendError(response, 404, 'not_found')
  if (result.status === 'configuration_unavailable') {
    return sendError(response, 503, 'configuration_unavailable')
  }
  if (result.status === 'unsupported') return sendError(response, 415, 'operation_unsupported', result.state)
  if (result.status === 'unavailable') return sendError(response, 409, 'source_unavailable', result.state)
  return null
}

function setPrivateFileHeaders(response: Response) {
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.setHeader('Cache-Control', 'private, no-store')
}

function clearFileRepresentationHeaders(response: Response) {
  for (const header of [
    'Content-Type',
    'Content-Length',
    'Content-Disposition',
    'Content-Security-Policy',
    'Last-Modified',
    'ETag',
    'Accept-Ranges',
  ]) response.removeHeader(header)
}

function byteRangeSatisfiable(range: string | undefined, target: string) {
  if (range === undefined) return { ok: true, size: null }
  const size = fs.statSync(target).size
  const match = range.match(/^bytes=([0-9]*)-([0-9]*)$/u)
  if (!match || (!match[1] && !match[2]) || size === 0) return { ok: false, size }
  if (!match[1]) {
    const suffix = Number(match[2])
    return { ok: Number.isSafeInteger(suffix) && suffix > 0, size }
  }
  const start = Number(match[1])
  const end = match[2] ? Number(match[2]) : size - 1
  const ok = Number.isSafeInteger(start)
    && Number.isSafeInteger(end)
    && start < size
    && end >= start
  return { ok, size }
}

function safeFilename(value: string) {
  const sanitized = value.replaceAll('\r', '').replaceAll('\n', '').replaceAll('\u0000', '')
  const basename = path.win32.basename(path.posix.basename(sanitized))
  return basename || 'download'
}

function rfc5987(value: string) {
  return [...Buffer.from(value, 'utf8')]
    .map((byte) => (
      (byte >= 0x30 && byte <= 0x39)
      || (byte >= 0x41 && byte <= 0x5a)
      || (byte >= 0x61 && byte <= 0x7a)
      || [0x21, 0x23, 0x24, 0x26, 0x2b, 0x2d, 0x2e, 0x5e, 0x5f, 0x60, 0x7c, 0x7e].includes(byte)
        ? String.fromCharCode(byte)
        : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
    ))
    .join('')
}

function contentDisposition(disposition: 'inline' | 'attachment', filename: string) {
  const safe = safeFilename(filename)
  const fallback = safe
    .replace(/[^\x20-\x7e]/gu, '_')
    .replace(/["\\]/gu, '_')
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${rfc5987(safe)}`
}

function inlineMime(mimeType: string) {
  return mimeType === 'application/pdf'
    || mimeType === 'text/html'
    || mimeType === 'text/plain'
    || mimeType === 'text/markdown'
    || (/^image\//u.test(mimeType) && mimeType !== 'image/svg+xml')
    || /^audio\//u.test(mimeType)
    || /^video\//u.test(mimeType)
}

function sendResolvedFile(response: Response, result: Extract<ArtifactSourceResolution, { status: 'available' }>) {
  const mimeType = mime.getType(result.target) ?? mime.getType(result.asset.name) ?? 'application/octet-stream'
  const disposition = inlineMime(mimeType) ? 'inline' : 'attachment'
  setPrivateFileHeaders(response)
  const contentType = mimeType === 'text/html' || mimeType === 'text/plain' || mimeType === 'text/markdown'
    ? `${mimeType}; charset=utf-8`
    : mimeType
  response.setHeader('Content-Type', contentType)
  response.setHeader('Content-Disposition', contentDisposition(disposition, result.asset.name))
  if (mimeType === 'text/html') {
    response.setHeader(
      'Content-Security-Policy',
      "sandbox; default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; media-src data: blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
    )
  }
  response.sendFile(result.target, (error) => {
    if (!error) return
    const status = (error as Error & { status?: number }).status === 416 ? 416 : 409
    if (response.headersSent) {
      if (!response.writableEnded) response.end()
      return
    }
    clearFileRepresentationHeaders(response)
    sendError(response, status, status === 416 ? 'range_not_satisfiable' : 'source_unavailable')
  })
}

function parseThumbnailWidth(value: unknown) {
  const raw = singleQueryValue(value, '360')
  if (raw === null || !/^[1-9][0-9]*$/u.test(raw)) return null
  const width = Number(raw)
  if (!Number.isSafeInteger(width) || width < 96 || width > 512) return null
  return Math.max(96, Math.min(512, Math.round(width / 16) * 16))
}

export function wechatDatabaseResolution(projectRoot = root) {
  const opened = openValidatedWechatDatabase(projectRoot)
  opened.db?.close()
  return opened.resolution
}

export function wechatDb(projectRoot = root) {
  return openValidatedWechatDatabase(projectRoot).db
}

export function createWechatRouter(
  dependencies: Partial<WechatRouterDependencies> = {},
  projectRoot = root,
) {
  const deps = { ...defaultDependencies(projectRoot), ...dependencies }
  const router = Router()

  router.use((_request, response, next) => {
    setPrivateFileHeaders(response)
    next()
  })

  router.get('/api/wechat/conversations', (_request, response) => {
    const lease = deps.openWechatDatabase()
    if (!lease.db) return response.json({ conversations: [], totals: { conversations: 0, messages: 0 } })
    try {
      const conversations = lease.db
        .prepare(`SELECT id, account, username, display, is_group, msg_count, text_count, first_time, last_time, summary FROM conversations ORDER BY last_time DESC`)
        .all()
      const totals = lease.db.prepare(`SELECT count(*) AS conversations, sum(msg_count) AS messages, sum(text_count) AS textMessages FROM conversations`).get()
      return response.json({ conversations, totals })
    } finally {
      lease.release()
    }
  })

  router.get('/api/wechat/conversation/:id/messages', (request, response) => {
    const lease = deps.openWechatDatabase()
    if (!lease.db) return sendError(response, 404, 'not_found')
    try {
      const id = request.params.id
      const limit = Math.min(Number(request.query.limit ?? 400), 2000)
      const offset = Math.max(Number(request.query.offset ?? 0), 0)
      const query = String(request.query.q ?? '').trim()
      const meta = lease.db.prepare(`SELECT * FROM conversations WHERE id=?`).get(id)
      if (!meta) return sendError(response, 404, 'not_found')
      const { messages } = readConversationMessages(lease.db, {
        conversationId: id,
        query,
        limit,
        offset,
      })
      return response.json({ meta, messages, offset, limit })
    } finally {
      lease.release()
    }
  })

  const collection = (conversationId: string | undefined, requestQuery: Record<string, unknown>, response: Response) => {
    if (conversationId !== undefined && !validConversationId(conversationId)) {
      return sendError(response, 400, 'invalid_conversation_id')
    }
    const input = parseCollectionQuery(requestQuery)
    if (!input) return sendError(response, 400, 'invalid_query')
    const wechatLease = deps.openWechatDatabase()
    const artifactLease = deps.openArtifactDatabase()
    try {
      if (!wechatLease.db || !artifactLease.db || !canonicalWechatDatabase(wechatLease.db)) {
        return sendError(response, 503, 'database_unavailable')
      }
      if (conversationId !== undefined) {
        const exists = wechatLease.db.prepare('SELECT 1 FROM conversations WHERE id=?').get(conversationId)
        if (!exists) return sendError(response, 404, 'not_found')
      }
      const page = queryArtifacts(artifactLease.db, wechatLease.db, { ...input, conversationId })
      if (page.offset > page.matchingTotal) return sendError(response, 416, 'offset_not_satisfiable')
      return response.json(page)
    } catch {
      return sendError(response, 503, 'database_unavailable')
    } finally {
      artifactLease.release()
      wechatLease.release()
    }
  }

  router.get('/api/wechat/artifacts', (request, response) => (
    collection(undefined, request.query as Record<string, unknown>, response)
  ))

  router.get('/api/wechat/conversation/:id/artifacts', (request, response) => (
    collection(request.params.id, request.query as Record<string, unknown>, response)
  ))

  router.get('/api/wechat/artifact/:id/metadata', (request, response) => {
    const lease = deps.openArtifactDatabase()
    if (!lease.db) return sendError(response, 503, 'database_unavailable')
    try {
      const resolver = createArtifactSourceResolver({
        assetDb: lease.db,
        accountRootProvider: deps.accountRootProvider,
      })
      const content = resolver.resolve(request.params.id, 'content')
      if (content.status === 'malformed' || content.status === 'unknown') {
        return assetResultError(response, content)
      }
      let availability = content.state
      const capabilities: ChatArtifactCapability = {
        metadata: `/api/wechat/artifact/${content.asset.id}/metadata`,
      }
      if (content.status === 'available') {
        capabilities.content = `/api/wechat/artifact/${content.asset.id}/content`
      }
      if (content.asset.preview === 'image' || content.asset.preview === 'video') {
        const thumbnail = resolver.resolve(request.params.id, 'thumbnail')
        if (thumbnail.status === 'available') {
          capabilities.thumbnail = `/api/wechat/artifact/${content.asset.id}/thumbnail`
          if (content.status !== 'available') availability = thumbnail.state
        } else if (content.status === 'available' && thumbnail.status === 'unavailable') {
          availability = thumbnail.state
          delete capabilities.content
        }
      }
      return response.json(publicMetadata(content.asset, availability, capabilities))
    } catch {
      return sendError(response, 503, 'database_unavailable')
    } finally {
      lease.release()
    }
  })

  router.get('/api/wechat/artifact/:id/content', (request, response) => {
    const lease = deps.openArtifactDatabase()
    if (!lease.db) return sendError(response, 503, 'database_unavailable')
    let result: ArtifactSourceResolution
    try {
      const resolver = createArtifactSourceResolver({
        assetDb: lease.db,
        accountRootProvider: deps.accountRootProvider,
      })
      result = resolver.resolve(request.params.id, 'content')
    } catch {
      return sendError(response, 503, 'database_unavailable')
    } finally {
      lease.release()
    }
    if (result.status !== 'available') return assetResultError(response, result)
    try {
      const range = byteRangeSatisfiable(request.headers.range, result.target)
      if (!range.ok) {
        setPrivateFileHeaders(response)
        response.setHeader('Content-Range', `bytes */${range.size}`)
        return sendError(response, 416, 'range_not_satisfiable')
      }
    } catch {
      return sendError(response, 409, 'source_unavailable', 'source_unavailable')
    }
    return sendResolvedFile(response, result)
  })

  router.get('/api/wechat/artifact/:id/thumbnail', (request, response) => {
    const width = parseThumbnailWidth(request.query.w)
    if (width === null) return sendError(response, 400, 'invalid_thumbnail_width')
    const lease = deps.openArtifactDatabase()
    if (!lease.db) return sendError(response, 503, 'database_unavailable')
    let result: ArtifactSourceResolution
    try {
      const resolver = createArtifactSourceResolver({
        assetDb: lease.db,
        accountRootProvider: deps.accountRootProvider,
      })
      result = resolver.resolve(request.params.id, 'thumbnail')
    } catch {
      return sendError(response, 503, 'database_unavailable')
    } finally {
      lease.release()
    }
    if (result.status !== 'available') return assetResultError(response, result)
    let target: string
    try {
      target = result.asset.preview === 'video'
        ? deps.videoThumbnail(result.target, width)
        : deps.imageThumbnail(result.target, width)
    } catch {
      return sendError(response, 415, 'thumbnail_unavailable', 'unsupported_codec')
    }
    try {
      if (!fs.statSync(target).isFile()) return sendError(response, 409, 'source_unavailable', 'source_unavailable')
      setPrivateFileHeaders(response)
      response.type('image/webp')
      return response.sendFile(target, (error) => {
        if (!error) return
        if (response.headersSent) {
          if (!response.writableEnded) response.end()
          return
        }
        clearFileRepresentationHeaders(response)
        sendError(response, 409, 'source_unavailable', 'source_unavailable')
      })
    } catch {
      return sendError(response, 409, 'source_unavailable', 'source_unavailable')
    }
  })

  return router
}

export default createWechatRouter()
