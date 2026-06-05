import { Router } from 'express'
import { wechatDb } from './wechat.js'

const router = Router()

type Row = { time: number; sender_name: string; sender: string; type: number; type_label: string; text: string }

/**
 * Full plaintext transcript of one conversation, for injecting into the AI
 * assistant. Bounded by `maxChars` so a 100k-message group cannot blow memory;
 * the row LIMIT is derived from it so we never load the whole table.
 */
router.get('/api/wechat/conversation/:id/transcript', (req, res) => {
  const db = wechatDb()
  if (!db) return res.status(404).json({ error: 'wechat.db not found' })
  try {
    const id = req.params.id
    const maxChars = Math.min(Number(req.query.maxChars ?? 1_600_000) || 1_600_000, 4_000_000)
    const meta = db.prepare('SELECT display, is_group, msg_count FROM conversations WHERE id=?').get(id) as
      | { display: string; is_group: number; msg_count: number }
      | undefined
    if (!meta) return res.status(404).json({ error: 'conversation not found' })
    const rowCap = Math.ceil(maxChars / 6) + 2000
    const rows = db
      .prepare('SELECT time,sender_name,sender,type,type_label,text FROM messages WHERE conv_id=? ORDER BY time LIMIT ?')
      .all(id, rowCap) as Row[]
    const lines: string[] = []
    let chars = 0
    let truncated = rows.length >= rowCap
    for (const m of rows) {
      const who = m.sender_name || m.sender || '?'
      const body = m.text && m.text.trim() ? m.text.trim() : `[${m.type_label || '消息'}]`
      const line = `${who}: ${body}`
      if (chars + line.length > maxChars) {
        truncated = true
        break
      }
      lines.push(line)
      chars += line.length + 1
    }
    res.json({ meta, text: lines.join('\n'), chars, lines: lines.length, truncated })
  } finally {
    db.close()
  }
})

/**
 * Thin streaming proxy to a user-configured OpenAI-compatible endpoint. The API
 * key arrives per-request from the browser (localStorage) and is forwarded
 * upstream only — never written to disk, never logged. Avoids browser CORS.
 */
router.post('/api/ai/chat', async (req, res) => {
  const { baseURL, apiKey, model, messages, temperature } = req.body ?? {}
  if (!baseURL || !apiKey || !model || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'missing baseURL / apiKey / model / messages' })
  }
  const url = `${String(baseURL).replace(/\/+$/, '')}/chat/completions`
  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature: temperature ?? 0.6, stream: true }),
    })
    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => '')
      return res.status(upstream.status || 502).send(detail || 'upstream error')
    }
    res.setHeader('content-type', 'text/event-stream; charset=utf-8')
    res.setHeader('cache-control', 'no-cache')
    const reader = upstream.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(Buffer.from(value))
    }
    res.end()
  } catch (e) {
    if (!res.headersSent) res.status(502).json({ error: String((e as Error)?.message ?? e) })
    else res.end()
  }
})

export default router
