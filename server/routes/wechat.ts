import { Router, type Response } from 'express'
import { root } from '../utils/helpers.js'
import { queryArtifacts } from '../wechat/artifactQuery.js'
import { openValidatedWechatDatabase } from '../wechat/databaseOpener.js'
import { readConversationMessages } from '../wechat/messageQuery.js'
import { registerWechatArtifactRoutes } from './wechatArtifactRoutes.js'
import { registerWechatTimelineRoutes } from './wechatTimelineRoutes.js'
import {
  canonicalWechatDatabase,
  defaultDependencies,
  parseCollectionQuery,
  sendError,
  setPrivateFileHeaders,
  validConversationId,
  type WechatRouterDependencies,
} from './wechatRouteHelpers.js'

export type { DatabaseLease, WechatRouterDependencies } from './wechatRouteHelpers.js'

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
        .prepare('SELECT id, account, username, display, is_group, msg_count, text_count, first_time, last_time, summary FROM conversations ORDER BY last_time DESC')
        .all()
      const totals = lease.db.prepare('SELECT count(*) AS conversations, sum(msg_count) AS messages, sum(text_count) AS textMessages FROM conversations').get()
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
      const meta = lease.db.prepare('SELECT * FROM conversations WHERE id=?').get(id)
      if (!meta) return sendError(response, 404, 'not_found')
      const { messages } = readConversationMessages(lease.db, { conversationId: id, query, limit, offset })
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

  registerWechatTimelineRoutes(router, deps)
  registerWechatArtifactRoutes(router, deps)
  return router
}

export default createWechatRouter()
