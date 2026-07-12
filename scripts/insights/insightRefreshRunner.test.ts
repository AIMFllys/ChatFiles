import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import {
  activateInsightRefresh,
  auditInsightRefresh,
  distillInsightRefresh,
  prepareInsightRefresh,
} from './insightRefreshRunner.js'
import type { InsightConversation, InsightState } from './insightRefresh.js'

function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
}

function fixture(t: test.TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatfiles-insights-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const source = path.join(root, 'data', 'insights')
  const dbPath = path.join(root, 'data', 'wechat.current', 'wechat.db')
  fs.mkdirSync(path.join(source, 'conv'), { recursive: true })
  fs.mkdirSync(path.join(source, 'boards'), { recursive: true })
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  fs.writeFileSync(path.join(source, 'boards', 'AI.md'), '# AI\n\n旧主题板', 'utf8')

  const conversations: InsightConversation[] = [
    {
      convId: 'wx:short:room@chatroom',
      name: '旧群名',
      isGroup: true,
      summary: '旧总结',
      topics: ['技术'],
      keyPeople: ['甲'],
      nuggets: [{ category: '技术', title: '旧要点', content: '必须保留', importance: 3 }],
    },
    {
      convId: 'wx:old-owner:room@chatroom',
      name: '中文群',
      isGroup: true,
      summary: '新总结',
      topics: ['AI'],
      keyPeople: ['乙'],
      nuggets: [{ category: 'AI', title: '新要点', content: '同样保留', importance: 4 }],
    },
  ]
  for (const [index, conversation] of conversations.entries()) {
    writeJson(path.join(source, 'conv', `legacy-${index}.json`), conversation)
  }
  const states: InsightState[] = [
    { convId: conversations[0]!.convId, analyzedTextCount: 30, analyzedLastTime: 100, analyzedAt: 'old' },
    { convId: conversations[1]!.convId, analyzedTextCount: 40, analyzedLastTime: 200, analyzedAt: 'new' },
  ]
  writeJson(path.join(source, '_state.json'), states)
  writeJson(path.join(source, '_manifest.json'), conversations.map((conversation, index) => ({
    convId: conversation.convId,
    name: conversation.name,
    isGroup: conversation.isGroup,
    textCount: index === 0 ? 30 : 40,
  })))

  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      display TEXT NOT NULL,
      is_group INTEGER NOT NULL,
      text_count INTEGER NOT NULL,
      first_time INTEGER NOT NULL,
      last_time INTEGER NOT NULL
    );
    CREATE TABLE messages (
      conv_id TEXT NOT NULL,
      type INTEGER NOT NULL,
      time INTEGER NOT NULL,
      sender_name TEXT,
      text TEXT
    );
  `)
  const insertConversation = db.prepare('INSERT INTO conversations VALUES (?, ?, ?, ?, ?, ?)')
  insertConversation.run('wx:canonical:room@chatroom', '中文群', 1, 50, 50, 300)
  insertConversation.run('wx:canonical:new-peer', '新增私聊', 0, 20, 250, 310)
  const insertMessage = db.prepare('INSERT INTO messages VALUES (?, 1, ?, ?, ?)')
  insertMessage.run('wx:canonical:room@chatroom', 210, '孔德羽', '这次决定使用 Codex 完成本地增量审计并记录方法。')
  insertMessage.run('wx:canonical:new-peer', 300, '陈同学', '建议使用 Python 处理课程数据，完成后一起复盘结果。')
  db.close()
  return { root, source, dbPath }
}

test('prepares, distills, audits, and activates a non-destructive canonical insight snapshot', (t) => {
  const owned = fixture(t)

  const prepared = prepareInsightRefresh({ root: owned.root, runId: 'fixture' })
  assert.equal(prepared.metrics.canonicalConversations, 1)
  assert.deepEqual(prepared.delta, { new: 1, grown: 1, accumulated: 0, unchanged: 0 })
  assert.equal(fs.readdirSync(path.join(owned.source, 'conv')).length, 2)
  assert.equal(fs.readdirSync(path.join(prepared.bundleDir, 'conv')).length, 1)
  assert.equal(fs.existsSync(path.join(prepared.bundleDir, 'boards', 'AI.md')), true)

  const distilled = distillInsightRefresh({ root: owned.root, runId: 'fixture' })
  assert.equal(distilled.processed, 2)
  assert.equal(fs.readdirSync(path.join(prepared.bundleDir, 'conv')).length, 2)

  const audit = auditInsightRefresh({ root: owned.root, bundleDir: prepared.bundleDir })
  assert.equal(audit.ok, true)
  assert.deepEqual(audit.metrics, {
    currentConversations: 2,
    manifestConversations: 2,
    insightConversations: 2,
    stateConversations: 2,
    nuggets: 4,
    boards: 1,
  })

  const activated = activateInsightRefresh({ root: owned.root, runId: 'fixture' })
  assert.equal(activated.previousDir, path.join(owned.root, 'data', 'insights.previous.fixture'))
  assert.equal(fs.existsSync(activated.previousDir), true)
  assert.equal(fs.existsSync(path.join(owned.root, 'data', 'insights', 'conv')), true)
  assert.equal(fs.existsSync(path.join(owned.root, 'data', 'insights.next')), false)
})
