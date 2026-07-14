import { Router } from 'express'
import { readActiveProductSet } from '../data/catalogReader.js'
import { openCatalogWechatDatabase } from '../data/productDatabases.js'
import { readCatalogInsights, readCatalogLibrary } from '../data/productReaders.js'
import { root, sourceLibrary } from '../utils/helpers.js'

function unavailable(res: import('express').Response) {
  return res.status(503).json({ error: 'Request failed',code: 'data_product_unavailable' })
}

export function createInsightsRouter(projectRoot = root) {
  const router = Router()

router.get('/api/insights', (_req, res) => {
  let loaded: ReturnType<typeof readCatalogInsights>
  try { loaded = readCatalogInsights(readActiveProductSet(projectRoot)) }
  catch { return unavailable(res) }
  const convs = loaded.conversations
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
  return res.json({ convCount: convs.length, nuggetCount, byCategory, summaries, boards: loaded.boards })
})

router.get('/api/overview', (_req, res) => {
  const active = readActiveProductSet(projectRoot)
  const opened = openCatalogWechatDatabase(projectRoot, () => active)
  const db = opened.db
  let chat: Record<string, unknown>
  if (!db) return unavailable(res)
  try {
      chat = db.prepare(`SELECT count(*) AS conversations, sum(msg_count) AS messages, sum(text_count) AS textMessages FROM conversations`).get() as Record<string, unknown>
      const c = db.prepare(`SELECT count(*) AS contacts FROM contacts`).get() as { contacts: number }
      chat.contacts = c.contacts
  } finally {
    db.close()
  }
  let lib: ReturnType<typeof readCatalogLibrary>
  let loaded: ReturnType<typeof readCatalogInsights>
  try {
    lib = readCatalogLibrary(active)
    loaded = readCatalogInsights(active)
  } catch { return unavailable(res) }
  const src = sourceLibrary(projectRoot)
  const insights = loaded.conversations
  const nuggets = insights.reduce((sum, c) => sum + (((c.nuggets as unknown[]) ?? []).length), 0)
  return res.json({
    chat,
    files: { archived: lib.files.length, indexed: src.files.length, bytes: lib.stats.bytes },
    insights: { conversations: insights.length, nuggets },
  })
})

  return router
}

export default createInsightsRouter()
