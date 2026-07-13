import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { liveMessageSearch } from './liveMessageSearch.js'

test('provides a bounded literal keyword fallback directly from canonical messages', () => {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE messages(
    conv_id TEXT,message_uid TEXT PRIMARY KEY,time INTEGER,sender TEXT,sender_name TEXT,text TEXT
  ); INSERT INTO messages VALUES
    ('conv-a','m-1',100,'u-a','张三','季度_计划% 已确认'),
    ('conv-a','m-2',101,'u-b','李四','季度计划待讨论'),
    ('conv-b','m-3',102,'u-a','张三','其他会话');`)
  const literal = liveMessageSearch(db, { query: '季度_计划%', conversationId: 'conv-a', limit: 10 })
  assert.deepEqual(literal.hits.map((hit) => hit.firstMessageUid), ['m-1'])
  assert.equal(literal.mode, 'keyword-only')
  const filtered = liveMessageSearch(db, { query: '季度', sender: 'u-b', after: 100, before: 101, limit: 10 })
  assert.deepEqual(filtered.hits.map((hit) => hit.firstMessageUid), ['m-2'])
  db.close()
})
