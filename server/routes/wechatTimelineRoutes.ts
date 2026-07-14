import type { Router } from 'express'
import {
  WechatQueryError,
  type WechatQueryService,
} from '../application/chat/wechatQueryService.js'
import { decodeTimelineCursor } from '../services/chatTimeline.js'
import {
  sendError,
  validConversationId,
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

export function registerWechatTimelineRoutes(router: Router, queries: WechatQueryService) {
  router.get('/api/wechat/conversation/:id/timeline', (request, response) => {
    const conversationId = request.params.id
    if (!validConversationId(conversationId)) return sendError(response, 400, 'invalid_conversation_id')
    const input = parseTimelineQuery(request.query as Record<string, unknown>)
    if (!input) return sendError(response, 400, 'invalid_query')
    try {
      return response.json(queries.timeline({ conversationId, ...input }))
    } catch (error) {
      if (error instanceof WechatQueryError && error.code === 'not_found') {
        return sendError(response, 404, 'not_found')
      }
      return sendError(response, 503, 'database_unavailable')
    }
  })
}
