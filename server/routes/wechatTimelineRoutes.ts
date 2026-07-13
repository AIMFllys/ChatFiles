import type { Router } from 'express'
import { decodeTimelineCursor, encodeTimelineCursor, queryTimeline } from '../services/chatTimeline.js'
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
  const aroundUid = single(query.aroundUid)
  const sender = single(query.sender)
  const text = single(query.q)
  if ([limitValue, before, after, around, aroundUid, sender, text].some((value) => value === null)) return null
  if (!/^[1-9][0-9]*$/u.test(limitValue!)) return null
  const limit = Number(limitValue)
  if (!Number.isSafeInteger(limit) || limit > 240 || sender!.length > 512 || text!.length > 200) return null
  if (aroundUid!.length > 512 || aroundUid!.includes('\u0000')) return null
  const cursors = [before, after, around, aroundUid].filter(Boolean) as string[]
  const encodedCursors = [before, after, around].filter(Boolean) as string[]
  if (cursors.length > 1 || encodedCursors.some((cursor) => !decodeTimelineCursor(cursor))) return null
  return {
    limit,
    ...(before ? { before } : {}),
    ...(after ? { after } : {}),
    ...(around ? { around } : {}),
    ...(aroundUid ? { aroundUid } : {}),
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
      let timelineInput = input
      if (input.aroundUid) {
        const anchor = lease.db.prepare('SELECT time,message_uid FROM messages WHERE conv_id=? AND message_uid=?')
          .get(conversationId, input.aroundUid) as { time: number; message_uid: string } | undefined
        if (!anchor) return sendError(response, 404, 'not_found')
        const rest = { ...input }
        delete rest.aroundUid
        timelineInput = { ...rest, around: encodeTimelineCursor({ time: Number(anchor.time), messageUid: anchor.message_uid }) }
      }
      return response.json(queryTimeline(lease.db, { conversationId, ...timelineInput }))
    } catch {
      return sendError(response, 503, 'database_unavailable')
    } finally {
      lease.release()
    }
  })
}
