import type { Router } from 'express'
import { decodeTimelineCursor, queryTimeline } from '../services/chatTimeline.js'
import {
  canonicalWechatDatabase,
  sendError,
  validConversationId,
  type WechatRouterDependencies,
} from './wechatRouteHelpers.js'

function single(value: unknown, fallback = '') {
  return value === undefined ? fallback : typeof value === 'string' ? value : null
}

function parseTimelineQuery(query: Record<string, unknown>) {
  const limitValue = single(query.limit, '120')
  const before = single(query.before)
  const after = single(query.after)
  const around = single(query.around)
  const sender = single(query.sender)
  const text = single(query.q)
  if ([limitValue, before, after, around, sender, text].some((value) => value === null)) return null
  if (!/^[1-9][0-9]*$/u.test(limitValue!)) return null
  const limit = Number(limitValue)
  if (!Number.isSafeInteger(limit) || limit > 240 || sender!.length > 512 || text!.length > 200) return null
  const cursors = [before, after, around].filter(Boolean) as string[]
  if (cursors.length > 1 || cursors.some((cursor) => !decodeTimelineCursor(cursor))) return null
  return {
    limit,
    ...(before ? { before } : {}),
    ...(after ? { after } : {}),
    ...(around ? { around } : {}),
    ...(sender ? { sender } : {}),
    ...(text!.trim() ? { query: text!.trim() } : {}),
  }
}

export function registerWechatTimelineRoutes(router: Router, deps: WechatRouterDependencies) {
  router.get('/api/wechat/conversation/:id/timeline', (request, response) => {
    const conversationId = request.params.id
    if (!validConversationId(conversationId)) return sendError(response, 400, 'invalid_conversation_id')
    const input = parseTimelineQuery(request.query as Record<string, unknown>)
    if (!input) return sendError(response, 400, 'invalid_query')
    const lease = deps.openWechatDatabase()
    if (!lease.db) return sendError(response, 503, 'database_unavailable')
    try {
      if (!canonicalWechatDatabase(lease.db)) return sendError(response, 503, 'database_unavailable')
      const exists = lease.db.prepare('SELECT 1 FROM conversations WHERE id=?').get(conversationId)
      if (!exists) return sendError(response, 404, 'not_found')
      return response.json(queryTimeline(lease.db, { conversationId, ...input }))
    } catch {
      return sendError(response, 503, 'database_unavailable')
    } finally {
      lease.release()
    }
  })
}
