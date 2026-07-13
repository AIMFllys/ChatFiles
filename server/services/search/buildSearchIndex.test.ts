import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { buildSearchIndex } from './buildSearchIndex.js'
import { readSearchMetadata } from './searchSchema.js'

function sourceDatabase() {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE messages(
    conv_id TEXT, message_uid TEXT PRIMARY KEY, time INTEGER, sender TEXT,
    sender_name TEXT, text TEXT
  )`)
  const insert = db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?)')
  for (let index = 0; index < 15; index += 1) {
    insert.run('conv-a', `m-${index}`, 100 + index, index % 2 ? 'u-b' : 'u-a', index % 2 ? '李四' : '张三', '中文索引内容'.repeat(20))
  }
  return db
}

test('streams source messages into a validated keyword staging index and activates it', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatfiles-search-build-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const sourceDb = sourceDatabase()
  t.after(() => sourceDb.close())
  const currentPath = path.join(root, 'ai-index.current.db')
  const stagingPath = path.join(root, 'ai-index.staging.db')
  fs.writeFileSync(currentPath, 'old-derived-index', 'utf8')
  const result = await buildSearchIndex({
    sourceDb, sourceFingerprint: 'source-fingerprint', currentPath, stagingPath,
  })
  assert.equal(result.mode, 'keyword-only')
  assert.ok(result.chunkCount >= 2)
  assert.equal(fs.existsSync(stagingPath), false)
  const opened = new DatabaseSync(currentPath, { readOnly: true })
  assert.equal(readSearchMetadata(opened)?.sourceFingerprint, 'source-fingerprint')
  assert.equal(readSearchMetadata(opened)?.chunkCount, result.chunkCount)
  opened.close()
})

test('validates embedding dimensions, leaves current untouched on failure, and never stores the key', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatfiles-search-build-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const sourceDb = sourceDatabase()
  t.after(() => sourceDb.close())
  const currentPath = path.join(root, 'ai-index.current.db')
  const stagingPath = path.join(root, 'ai-index.staging.db')
  fs.writeFileSync(currentPath, 'known-current', 'utf8')
  await assert.rejects(buildSearchIndex({
    sourceDb, sourceFingerprint: 'fp', currentPath, stagingPath,
    embedding: { baseURL: 'https://example.test/v1', apiKey: 'fake-private-key', model: 'fixture', dimensions: 3, batchSize: 4 },
    fetchImpl: async () => Response.json({ data: [{ index: 0, embedding: [1, 0] }] }),
  }), /embedding_response_invalid/u)
  assert.equal(fs.readFileSync(currentPath, 'utf8'), 'known-current')
  assert.equal(fs.existsSync(stagingPath), false)

  const result = await buildSearchIndex({
    sourceDb, sourceFingerprint: 'fp', currentPath, stagingPath,
    embedding: { baseURL: 'https://example.test/v1', apiKey: 'fake-private-key', model: 'fixture', dimensions: 3, batchSize: 4 },
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { input: string[] }
      return Response.json({ data: body.input.map((_, index) => ({ index, embedding: [1, index + 1, 0] })) })
    },
  })
  assert.equal(result.mode, 'hybrid')
  assert.doesNotMatch(JSON.stringify(result), /fake-private-key/u)
  assert.equal(fs.readFileSync(currentPath).includes(Buffer.from('fake-private-key')), false)
})
