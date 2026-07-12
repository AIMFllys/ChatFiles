import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'

import { queryArtifacts } from './artifactQuery.js'

function fixtureDatabases() {
  const assetDb = new DatabaseSync(':memory:')
  const wechatDb = new DatabaseSync(':memory:')
  assetDb.exec(`
    CREATE TABLE artifacts(
      asset_id TEXT PRIMARY KEY, conv_id TEXT, category TEXT, kind TEXT, name TEXT,
      preview TEXT, url TEXT, source_relative_path TEXT, source_size INTEGER,
      created_at INTEGER, sender_name TEXT, text TEXT, materialization TEXT,
      preview_status TEXT, failure_reason TEXT
    );
  `)
  wechatDb.exec(`
    CREATE TABLE messages(
      conv_id TEXT, message_uid TEXT PRIMARY KEY, time INTEGER, sender_name TEXT,
      type INTEGER, text TEXT
    );
  `)
  const insertAsset = assetDb.prepare('INSERT INTO artifacts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  insertAsset.run('a'.repeat(64), 'conv-a', 'work', 'resource', '季度_计划%草案.pdf', 'pdf', null, 'private/季度.pdf', 20, 100, '张三', '内部说明', 'exported', 'ready', null)
  insertAsset.run('b'.repeat(64), 'conv-a', 'document', 'resource', '说明书.pdf', 'pdf', null, 'private/说明.pdf', 30, 100, '李四', '反斜杠 \\ 查询', 'decrypt_failed', 'decrypt_failed', 'secret detail')
  insertAsset.run('c'.repeat(64), 'conv-b', 'skill', 'resource', 'demo.ts', 'code', null, 'private/demo.ts', 40, 100, 'Alice', 'typescript', 'exported', 'ready', null)
  insertAsset.run('d'.repeat(64), 'conv-b', 'link', 'link', 'OpenAI', 'link', 'https://example.test/a_b%20', null, null, 90, 'Bob', '参考链接', 'exported', 'ready', null)
  insertAsset.run('e'.repeat(64), null, 'document', 'resource', '全局孤立文档.docx', 'docx', null, 'private/global.docx', 50, 80, '系统', '未关联会话', 'missing_source', 'missing_source', 'private failure')
  wechatDb.exec(`
    INSERT INTO messages VALUES ('conv-a', 'm-1', 100, '张三', 1, '中文消息 100%');
    INSERT INTO messages VALUES ('conv-a', 'm-2', 99, '李四', 49, '非文本消息');
    INSERT INTO messages VALUES ('conv-b', 'm-3', 100, 'Alice', 1, '下划线_a');
  `)
  return { assetDb, wechatDb }
}

test('reports exact six-tab global counts while all contains only the four artifact categories', () => {
  const { assetDb, wechatDb } = fixtureDatabases()
  const page = queryArtifacts(assetDb, wechatDb, { tab: 'all', query: '', limit: 60, offset: 0 })

  assert.deepEqual(page.counts, { all: 5, work: 1, document: 2, skill: 1, link: 1, chatText: 2 })
  assert.equal(page.total, 5)
  assert.equal(page.matchingTotal, 5)
  assert.equal(page.items.length, 5)
  assert.equal(page.items.every((item) => item.itemType === 'artifact'), true)
  assetDb.close()
  wechatDb.close()
})

test('scopes conversation artifacts and text while excluding null-conversation artifacts', () => {
  const { assetDb, wechatDb } = fixtureDatabases()
  const page = queryArtifacts(assetDb, wechatDb, {
    conversationId: 'conv-a', tab: 'document', query: '', limit: 60, offset: 0,
  })
  const chatText = queryArtifacts(assetDb, wechatDb, {
    conversationId: 'conv-a', tab: 'chatText', query: '', limit: 60, offset: 0,
  })

  assert.deepEqual(page.counts, { all: 2, work: 1, document: 1, skill: 0, link: 0, chatText: 1 })
  assert.equal(page.total, 1)
  assert.equal(page.items[0]?.id, 'b'.repeat(64))
  assert.equal(chatText.total, 1)
  assert.equal(chatText.items[0]?.itemType, 'chatText')
  assert.equal(chatText.items[0] && 'content' in chatText.items[0] ? chatText.items[0].content : null, '中文消息 100%')
  assetDb.close()
  wechatDb.close()
})

test('searches Chinese asset fields and treats percent, underscore, and backslash literally', () => {
  const { assetDb, wechatDb } = fixtureDatabases()
  const chinese = queryArtifacts(assetDb, wechatDb, { tab: 'all', query: '季度', limit: 60, offset: 0 })
  const percent = queryArtifacts(assetDb, wechatDb, { tab: 'all', query: '%', limit: 60, offset: 0 })
  const underscore = queryArtifacts(assetDb, wechatDb, { tab: 'all', query: '_', limit: 60, offset: 0 })
  const backslash = queryArtifacts(assetDb, wechatDb, { tab: 'all', query: '\\', limit: 60, offset: 0 })
  const textPercent = queryArtifacts(assetDb, wechatDb, { tab: 'chatText', query: '%', limit: 60, offset: 0 })

  assert.deepEqual(chinese.items.map((item) => item.id), ['a'.repeat(64)])
  assert.deepEqual(percent.items.map((item) => item.id).sort(), ['a'.repeat(64), 'd'.repeat(64)])
  assert.deepEqual(underscore.items.map((item) => item.id).sort(), ['a'.repeat(64), 'd'.repeat(64)])
  assert.deepEqual(backslash.items.map((item) => item.id), ['b'.repeat(64)])
  assert.equal(textPercent.matchingTotal, 1)
  assert.equal(percent.counts.all, 5)
  assert.equal(percent.total, 5)
  assetDb.close()
  wechatDb.close()
})

test('binds hostile search input without changing either database', () => {
  const { assetDb, wechatDb } = fixtureDatabases()
  const page = queryArtifacts(assetDb, wechatDb, {
    tab: 'all', query: "x%' OR 1=1; DROP TABLE artifacts; --", limit: 60, offset: 0,
  })

  assert.equal(page.matchingTotal, 0)
  assert.equal(assetDb.prepare('SELECT count(*) AS count FROM artifacts').get()?.count, 5)
  assert.equal(wechatDb.prepare('SELECT count(*) AS count FROM messages').get()?.count, 3)
  assetDb.close()
  wechatDb.close()
})

test('uses a unique stable order for offset pagination at identical timestamps', () => {
  const { assetDb, wechatDb } = fixtureDatabases()
  const first = queryArtifacts(assetDb, wechatDb, { tab: 'all', query: '', limit: 2, offset: 0 })
  const second = queryArtifacts(assetDb, wechatDb, { tab: 'all', query: '', limit: 2, offset: 2 })
  const repeated = queryArtifacts(assetDb, wechatDb, { tab: 'all', query: '', limit: 2, offset: 0 })

  assert.deepEqual(first.items.map((item) => item.id), repeated.items.map((item) => item.id))
  assert.equal(first.items.some((item) => second.items.some((other) => other.id === item.id)), false)
  assert.deepEqual([...first.items, ...second.items].map((item) => item.id), [
    'a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64),
  ])
  assetDb.close()
  wechatDb.close()
})

test('returns only path-free public DTO fields and no ordinary artifact text', () => {
  const { assetDb, wechatDb } = fixtureDatabases()
  const page = queryArtifacts(assetDb, wechatDb, { tab: 'document', query: '', limit: 60, offset: 0 })
  const serialized = JSON.stringify(page)

  assert.doesNotMatch(serialized, /source_relative_path|candidate_message_uids|evidence_signature|failure_reason|private\//)
  assert.doesNotMatch(serialized, /内部说明|未关联会话|secret detail|private failure/)
  assert.deepEqual(Object.keys(page.items[0] ?? {}).sort(), [
    'availability', 'category', 'conversationId', 'createdAt', 'id', 'itemType',
    'kind', 'metadataUrl', 'name', 'preview', 'senderName', 'url',
  ])
  assetDb.close()
  wechatDb.close()
})

test('returns zeroed counts and an empty page for empty databases', () => {
  const { assetDb, wechatDb } = fixtureDatabases()
  assetDb.exec('DELETE FROM artifacts')
  wechatDb.exec('DELETE FROM messages')

  assert.deepEqual(queryArtifacts(assetDb, wechatDb, { tab: 'all', query: '', limit: 60, offset: 0 }), {
    tab: 'all', counts: { all: 0, work: 0, document: 0, skill: 0, link: 0, chatText: 0 },
    total: 0, matchingTotal: 0, offset: 0, limit: 60, items: [],
  })
  assetDb.close()
  wechatDb.close()
})

test('fails closed when list rows contain an invalid evidence-state combination', () => {
  const { assetDb, wechatDb } = fixtureDatabases()
  assetDb.prepare('UPDATE artifacts SET materialization=?, preview_status=? WHERE asset_id=?')
    .run('missing_source', 'ready', 'a'.repeat(64))

  const page = queryArtifacts(assetDb, wechatDb, { tab: 'work', query: '', limit: 60, offset: 0 })
  assert.equal(page.items[0]?.itemType === 'artifact' ? page.items[0].availability : null, 'source_unavailable')
  assetDb.close()
  wechatDb.close()
})
