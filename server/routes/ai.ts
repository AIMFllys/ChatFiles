import { Router } from 'express'
import { readConversationTranscript } from '../services/conversationTranscript.js'
import { wechatDb } from './wechat.js'

const router = Router()

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
    const transcript = readConversationTranscript(db, { conversationId: id, maxCharacters: maxChars })
    if (!transcript) return res.status(404).json({ error: 'conversation not found' })
    res.json(transcript)
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
