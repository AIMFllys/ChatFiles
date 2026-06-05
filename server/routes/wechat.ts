import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { root } from '../utils/helpers.js'

const wechatDbPath = path.join(root, 'data', 'wechat.db')

export function wechatDb() {
  if (!fs.existsSync(wechatDbPath)) return null
  try {
    return new DatabaseSync(wechatDbPath, { readOnly: true })
  } catch {
    return null
  }
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
    const messages = q
      ? db.prepare(`SELECT seq,time,sender,sender_name,type,type_label,text FROM messages WHERE conv_id=? AND text LIKE ? ORDER BY time LIMIT ? OFFSET ?`).all(id, `%${q}%`, limit, offset)
      : db.prepare(`SELECT seq,time,sender,sender_name,type,type_label,text FROM messages WHERE conv_id=? ORDER BY time LIMIT ? OFFSET ?`).all(id, limit, offset)
    res.json({ meta, messages, offset, limit })
  } finally {
    db.close()
  }
})

export default router
