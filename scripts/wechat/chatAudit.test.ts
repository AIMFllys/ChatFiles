import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { auditWechatDatabase } from './chatAudit.js'

function fixture(mutator?: (db: DatabaseSync) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatfiles-audit-'))
  const dbPath = path.join(dir, 'wechat.db')
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE conversations(
      id TEXT PRIMARY KEY, account TEXT, owner TEXT, username TEXT, display TEXT, is_group INTEGER,
      msg_count INTEGER, text_count INTEGER, first_time INTEGER, last_time INTEGER, summary TEXT
    );
    CREATE TABLE messages(
      conv_id TEXT, message_uid TEXT, seq INTEGER, source_snapshot TEXT, source_db TEXT, source_table TEXT,
      local_id INTEGER, server_id TEXT,
      sort_seq INTEGER, time INTEGER, sender TEXT, sender_name TEXT, sender_prefix TEXT, is_own INTEGER,
      sender_source TEXT, sender_audit TEXT, raw_type INTEGER, type INTEGER, type_label TEXT, text TEXT
    );
    CREATE TABLE parse_runs(
      run_id TEXT PRIMARY KEY, status TEXT, completed_at TEXT,
      selected_snapshot_count INTEGER, selected_source_count INTEGER,
      source_conversation_count INTEGER, source_message_count INTEGER,
      output_conversation_count INTEGER, output_message_count INTEGER, output_text_count INTEGER,
      deduplicated_message_count INTEGER
    );
  `)
  db.prepare('INSERT INTO conversations VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
    'wx:owner-1:peer-1',
    'owner-1',
    'owner-1',
    'peer-1',
    '测试会话',
    0,
    2,
    2,
    1_700_000_000,
    1_700_000_001,
    '',
  )
  const insert = db.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  insert.run(
    'wx:owner-1:peer-1', 'uid-1', 0, 'snapshot-new', 'message_0.db', 'Msg_fixture',
    1, '9007199254740999', 10, 1_700_000_000, 'owner-1', '我', '', 1,
    'message-name2id', '', 1, 1, 'text', '中文完整',
  )
  insert.run(
    'wx:owner-1:peer-1', 'uid-2', 1, 'snapshot-new', 'message_0.db', 'Msg_fixture',
    2, '9007199254741000', 11, 1_700_000_001, 'peer-1', '对方', '', 0,
    'message-name2id', '', 1, 1, 'text', '第二条',
  )
  db.prepare('INSERT INTO parse_runs VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
    'fixture-run', 'complete', '2026-07-12T00:00:00.000Z',
    1, 1, 1, 2, 1, 2, 2, 0,
  )
  mutator?.(db)
  db.close()
  return {
    dbPath,
    cleanup() {
      fs.unlinkSync(dbPath)
      fs.rmdirSync(dir)
    },
  }
}

test('accepts a provenance-complete UTF-8 database', () => {
  const item = fixture()
  try {
    const result = auditWechatDatabase(item.dbPath)
    assert.equal(result.ok, true)
    assert.equal(result.metrics.conversations, 1)
    assert.equal(result.metrics.messages, 2)
    assert.deepEqual(result.issues, [])
  } finally {
    item.cleanup()
  }
})

test('accepts a signed negative raw type when its unsigned low 32 bits match type', () => {
  const item = fixture((db) => {
    db.prepare('UPDATE messages SET raw_type=? WHERE message_uid=?').run(
      -9_223_372_036_854_775_807n,
      'uid-1',
    )
  })
  try {
    const result = auditWechatDatabase(item.dbPath)
    assert.equal(result.ok, true)
    assert.equal(result.issues.some((issue) => issue.code === 'message-type-not-normalized'), false)
  } finally {
    item.cleanup()
  }
})

test('reports identity, evidence, type, count and UTF-8 violations', () => {
  const item = fixture((db) => {
    db.prepare('UPDATE conversations SET msg_count=4, text_count=4').run()
    db.prepare(`
      INSERT INTO messages VALUES (
        'wx:owner-1:peer-1', 'uid-2', 2, 'snapshot-new', 'message_0.db', 'Msg_fixture',
        2, '9007199254741000', 12, 1700000002, 'third-person', '错配�', 'spoofed-prefix', 0,
        'message-name2id', 'group-prefix-mismatch', 244813135921, 244813135921,
        'type_244813135921', '内容'
      )
    `).run()
  })
  try {
    const result = auditWechatDatabase(item.dbPath)
    assert.equal(result.ok, false)
    const codes = new Set(result.issues.map((issue) => issue.code))
    assert.equal(codes.has('duplicate-message-uid'), true)
    assert.equal(codes.has('duplicate-evidence-key'), true)
    assert.equal(codes.has('duplicate-server-id'), true)
    assert.equal(codes.has('private-sender-outside-participants'), true)
    assert.equal(codes.has('group-prefix-sender-mismatch'), true)
    assert.equal(codes.has('message-type-not-normalized'), true)
    assert.equal(codes.has('replacement-character'), true)
    assert.equal(codes.has('conversation-count-mismatch'), true)
    assert.equal(codes.has('parse-run-database-count-mismatch'), true)
  } finally {
    item.cleanup()
  }
})

test('rejects missing, incomplete, or empty parse run completion state', () => {
  const missing = fixture((db) => db.exec('DELETE FROM parse_runs'))
  try {
    const result = auditWechatDatabase(missing.dbPath)
    assert.equal(result.ok, false)
    assert.equal(result.issues.some((issue) => issue.code === 'parse-run-record-count'), true)
  } finally {
    missing.cleanup()
  }

  const empty = fixture((db) => {
    db.exec('DELETE FROM messages; DELETE FROM conversations;')
    db.exec(`
      UPDATE parse_runs SET status='building', source_conversation_count=0, source_message_count=0,
        output_conversation_count=0, output_message_count=0, output_text_count=0,
        deduplicated_message_count=0
    `)
  })
  try {
    const result = auditWechatDatabase(empty.dbPath)
    const codes = new Set(result.issues.map((issue) => issue.code))
    assert.equal(codes.has('parse-run-not-complete'), true)
    assert.equal(codes.has('empty-output'), true)
  } finally {
    empty.cleanup()
  }
})
