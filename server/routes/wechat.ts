import { Router } from 'express'
import { root } from '../utils/helpers.js'
import { openValidatedWechatDatabase } from '../wechat/databaseOpener.js'
import { readConversationMessages } from '../wechat/messageQuery.js'

export function wechatDatabaseResolution(projectRoot = root) {
  const opened = openValidatedWechatDatabase(projectRoot)
  opened.db?.close()
  return opened.resolution
}

export function wechatDb(projectRoot = root) {
  return openValidatedWechatDatabase(projectRoot).db
}

const router = Router()

router.get('/api/wechat/conversations', (_req, res) => {
  const db = wechatDb()
  if (!db) return res.json({ conversations: [], totals: { conversations: 0, messages: 0 } })
  try {
    const conversations = db
      .prepare(`SELECT id, account, username, display, is_group, msg_count, text_count, first_time, last_time, summary FROM conversations ORDER BY last_time DESC`)
      .all()
    const totals = db.prepare(`SELECT count(*) AS conversations, sum(msg_count) AS messages, sum(text_count) AS textMessages FROM conversations`).get()
    res.json({ conversations, totals })
  } finally {
    db.close()
  }
})

router.get('/api/wechat/conversation/:id/messages', (req, res) => {
  const db = wechatDb()
  if (!db) return res.status(404).json({ error: 'wechat.db not found' })
  try {
    const id = req.params.id
    const limit = Math.min(Number(req.query.limit ?? 400), 2000)
    const offset = Math.max(Number(req.query.offset ?? 0), 0)
    const q = String(req.query.q ?? '').trim()
    const meta = db.prepare(`SELECT * FROM conversations WHERE id=?`).get(id)
    if (!meta) return res.status(404).json({ error: 'conversation not found' })
    const { messages } = readConversationMessages(db, {
      conversationId: id,
      query: q,
      limit,
      offset,
    })
    res.json({ meta, messages, offset, limit })
  } finally {
    db.close()
  }
})

export default router
