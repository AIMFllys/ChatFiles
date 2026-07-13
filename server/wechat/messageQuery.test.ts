import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'

import { readConversationMessages } from './messageQuery.js'

function canonicalDatabase() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE messages(
      conv_id TEXT, message_uid TEXT, seq INTEGER, source_db TEXT, local_id INTEGER,
      sort_seq INTEGER, time INTEGER, canonical_seq INTEGER, occurred_at_epoch_s INTEGER,
      time_precision TEXT, archive_day TEXT, source_adapter TEXT, source_sort_seq INTEGER,
      sender TEXT, person_id TEXT, sender_name TEXT, sender_name_snapshot TEXT, is_own INTEGER,
      sender_source TEXT, sender_audit TEXT, raw_type INTEGER, type INTEGER,
      type_label TEXT, content_kind TEXT, structured_content_json TEXT, text TEXT
    );
  `)
  const insert = db.prepare(`INSERT INTO messages VALUES (${Array.from({ length: 26 }, () => '?').join(',')})`)
  insert.run('conv', 'uid-late-source', 3, 'message_1.db', 2, 7, 100, 3, 100, 'second', '1970-01-01', 'regular', 7, 'wxid_3', 'wxp:3', '三', '三', 0, 'name2id', '', 1n, 1, 'text', 'text', '{}', '三')
  insert.run('conv', 'uid-local-two', 0, 'message_0.db', 2, 7, 100, 0, 100, 'second', '1970-01-01', 'regular', 7, 'wxid_2', 'wxp:2', '二', '二', 0, 'name2id', '', 1n, 1, 'text', 'text', '{}', '二')
  insert.run('conv', 'uid-local-one', 1, 'message_0.db', 1, 7, 100, 1, 100, 'second', '1970-01-01', 'regular', 7, 'wxid_owner', 'wxp:owner', '我', '我', 1, 'name2id', '', 4_294_967_297n, 1, 'text', 'text', '{"mention":"二"}', '一')
  insert.run('conv', 'uid-first', 2, 'message_1.db', 9, 99, 100, 2, 100, 'second', '1970-01-01', 'regular', 99, 'wxid_0', null, '零', '零', 0, 'name2id', 'unknown', 3n, 3, 'image', 'media', '{"mediaKind":"image"}', '[图片]')
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

test('reads canonical v2 fields in canonical sequence order and serializes raw_type as text', () => {
  const db = canonicalDatabase()
  try {
    const result = readConversationMessages(db, { conversationId: 'conv', limit: 20, offset: 0 })

    assert.equal(result.mode, 'canonical')
    assert.deepEqual(result.messages.map((message) => message.message_uid), [
      'uid-local-two',
      'uid-local-one',
      'uid-first',
      'uid-late-source',
    ])
    assert.deepEqual(result.messages[1], {
      message_uid: 'uid-local-one',
      seq: 1,
      canonical_seq: 1,
      time: 100,
      occurred_at_epoch_s: 100,
      time_precision: 'second',
      archive_day: '1970-01-01',
      source_adapter: 'regular',
      source_sort_seq: 7,
      sort_seq: 7,
      source_db: 'message_0.db',
      local_id: 1,
      sender: 'wxid_owner',
      person_id: 'wxp:owner',
      sender_name: '我',
      sender_name_snapshot: '我',
      is_own: 1,
      sender_source: 'name2id',
      sender_audit: '',
      raw_type: '4294967297',
      type: 1,
      type_label: 'text',
      content_kind: 'text',
      structured_content_json: '{"mention":"二"}',
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
