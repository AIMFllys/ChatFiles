import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { library, root, sourceLibrary } from '../utils/helpers.js'
import { wechatDb } from './wechat.js'

function loadInsights() {
  const dir = path.join(root, 'data', 'insights', 'conv')
  const convs: Array<Record<string, unknown>> = []
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue
      try {
        convs.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
      } catch {
        /* skip malformed */
      }
    }
  }
  return convs
}

const router = Router()

router.get('/api/insights', (_req, res) => {
  const convs = loadInsights()
  const byCategory: Record<string, Array<Record<string, unknown>>> = {}
  const summaries: Array<Record<string, unknown>> = []
  let nuggetCount = 0
  for (const c of convs) {
    if (c.summary) summaries.push({ convId: c.convId, name: c.name, isGroup: c.isGroup, summary: c.summary, topics: c.topics ?? [], keyPeople: c.keyPeople ?? [] })
    for (const n of (c.nuggets as Array<Record<string, unknown>> | undefined) ?? []) {
      const cat = String(n.category ?? '其他')
      ;(byCategory[cat] ??= []).push({ ...n, conv: c.name, convId: c.convId, isGroup: c.isGroup })
      nuggetCount++
    }
  }
  for (const k of Object.keys(byCategory)) byCategory[k].sort((a, b) => Number(b.importance ?? 0) - Number(a.importance ?? 0))
  const boardsDir = path.join(root, 'data', 'insights', 'boards')
  const boards: Record<string, string> = {}
  if (fs.existsSync(boardsDir)) {
    for (const f of fs.readdirSync(boardsDir)) {
      if (f.endsWith('.md')) boards[f.replace(/\.md$/, '')] = fs.readFileSync(path.join(boardsDir, f), 'utf8')
    }
  }
  res.json({ convCount: convs.length, nuggetCount, byCategory, summaries, boards })
})

router.get('/api/overview', (_req, res) => {
  const db = wechatDb()
  let chat: Record<string, unknown> = { conversations: 0, messages: 0, textMessages: 0, contacts: 0 }
  if (db) {
    try {
      chat = db.prepare(`SELECT count(*) AS conversations, sum(msg_count) AS messages, sum(text_count) AS textMessages FROM conversations`).get() as Record<string, unknown>
      const c = db.prepare(`SELECT count(*) AS contacts FROM contacts`).get() as { contacts: number }
      chat.contacts = c.contacts
    } finally {
      db.close()
    }
  }
  const lib = library()
  const src = sourceLibrary()
  const insights = loadInsights()
  const nuggets = insights.reduce((sum, c) => sum + (((c.nuggets as unknown[]) ?? []).length), 0)
  res.json({
    chat,
    files: { archived: lib.files.length, indexed: src.files.length, bytes: lib.stats.bytes },
    insights: { conversations: insights.length, nuggets },
  })
})

export default router
