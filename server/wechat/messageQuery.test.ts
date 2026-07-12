import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'

import { readConversationMessages } from './messageQuery.js'

function canonicalDatabase() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE messages(
      conv_id TEXT, message_uid TEXT, seq INTEGER, source_db TEXT, local_id INTEGER,
      sort_seq INTEGER, time INTEGER, sender TEXT, sender_name TEXT, is_own INTEGER,
      sender_source TEXT, sender_audit TEXT, raw_type INTEGER, type INTEGER,
      type_label TEXT, text TEXT
    );
  `)
  const insert = db.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  insert.run('conv', 'uid-late-source', 3, 'message_1.db', 2, 7, 100, 'wxid_3', '三', 0, 'name2id', '', 1n, 1, 'text', '三')
  insert.run('conv', 'uid-local-two', 2, 'message_0.db', 2, 7, 100, 'wxid_2', '二', 0, 'name2id', '', 1n, 1, 'text', '二')
  insert.run('conv', 'uid-local-one', 1, 'message_0.db', 1, 7, 100, 'wxid_owner', '我', 1, 'name2id', '', 4_294_967_297n, 1, 'text', '一')
  insert.run('conv', 'uid-first', 0, 'message_1.db', 9, 99, 99, 'wxid_0', '零', 0, 'name2id', '', 3n, 3, 'image', '[图片]')
  return db
}

function legacyDatabase() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE messages(
      conv_id TEXT, seq INTEGER, time INTEGER, sender TEXT, sender_name TEXT,
      type INTEGER, type_label TEXT, text TEXT
    );
    INSERT INTO messages VALUES ('conv', 2, 200, 'wxid_b', '乙', 1, 'text', '后');
    INSERT INTO messages VALUES ('conv', 1, 100, 'wxid_a', '甲', 1, 'text', '前');
  `)
  return db
}

test('reads canonical identity fields in deterministic parser order and serializes raw_type as text', () => {
  const db = canonicalDatabase()
  try {
    const result = readConversationMessages(db, { conversationId: 'conv', limit: 20, offset: 0 })

    assert.equal(result.mode, 'canonical')
    assert.deepEqual(result.messages.map((message) => message.message_uid), [
      'uid-first',
      'uid-local-one',
      'uid-local-two',
      'uid-late-source',
    ])
    assert.deepEqual(result.messages[1], {
      message_uid: 'uid-local-one',
      seq: 1,
      time: 100,
      sort_seq: 7,
      source_db: 'message_0.db',
      local_id: 1,
      sender: 'wxid_owner',
      sender_name: '我',
      is_own: 1,
      sender_source: 'name2id',
      sender_audit: '',
      raw_type: '4294967297',
      type: 1,
      type_label: 'text',
      text: '一',
    })
    assert.doesNotThrow(() => JSON.stringify(result.messages))
  } finally {
    db.close()
  }
})

test('uses the original legacy projection and ordering when identity columns are absent', () => {
  const db = legacyDatabase()
  try {
    const result = readConversationMessages(db, { conversationId: 'conv', limit: 20, offset: 0 })

    assert.equal(result.mode, 'legacy')
    assert.deepEqual(result.messages, [
      { seq: 1, time: 100, sender: 'wxid_a', sender_name: '甲', type: 1, type_label: 'text', text: '前' },
      { seq: 2, time: 200, sender: 'wxid_b', sender_name: '乙', type: 1, type_label: 'text', text: '后' },
    ])
  } finally {
    db.close()
  }
})

test('applies text search without changing canonical ordering', () => {
  const db = canonicalDatabase()
  try {
    const result = readConversationMessages(db, {
      conversationId: 'conv',
      query: '二',
      limit: 20,
      offset: 0,
    })

    assert.equal(result.mode, 'canonical')
    assert.deepEqual(result.messages.map((message) => message.message_uid), ['uid-local-two'])
  } finally {
    db.close()
  }
})
