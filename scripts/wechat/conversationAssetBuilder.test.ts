import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import {
  CANONICAL_LOCAL_LOOKUP_PREDICATE,
  CANONICAL_SERVER_LOOKUP_PREDICATE,
  runConversationAssetBuilder,
} from './conversationAssetBuilder.js'
import { auditConversationAssetBundle } from './conversationAssetAudit.js'

function varint(value: number) {
  const bytes: number[] = []
  let remaining = value >>> 0
  do {
    const next = remaining & 0x7f
    remaining >>>= 7
    bytes.push(next | (remaining > 0 ? 0x80 : 0))
  } while (remaining > 0)
  return Buffer.from(bytes)
}

function bytesField(field: number, value: Uint8Array | string) {
  const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value)
  return Buffer.concat([varint((field << 3) | 2), varint(bytes.length), bytes])
}

function createWechatDatabase(filename: string, table: string) {
  const db = new DatabaseSync(filename)
  db.exec(`
    CREATE TABLE conversations(id TEXT PRIMARY KEY, username TEXT NOT NULL);
    CREATE TABLE messages(
      conv_id TEXT, message_uid TEXT, source_db TEXT, source_table TEXT, local_id INTEGER,
      server_id TEXT, time INTEGER, sender_name TEXT, raw_type INTEGER, type INTEGER, text TEXT
    );
  `)
  db.prepare('INSERT INTO conversations VALUES (?, ?)').run('wx:owner:wxid_peer', 'wxid_peer')
  const insert = db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  insert.run(
    'wx:owner:wxid_peer', 'wxm:file', 'message_0.db', table, 42, '9001',
    1_783_800_000, '陈同学', 25_769_803_825, 49, '课程讲义 https://example.com/lesson',
  )
  insert.run(
    'wx:owner:wxid_peer', 'wxm:voice', 'message_0.db', table, 43, '9002',
    1_783_800_001, '陈同学', 34, 34, '[语音 3秒]',
  )
  insert.run(
    'wx:owner:wxid_peer', 'wxm:text', 'message_0.db', table, 44, '9003',
    1_783_800_002, '陈同学', 1, 1, '普通聊天文字',
  )
  db.close()
}

function createSourceDatabase(filename: string, table: string) {
  const db = new DatabaseSync(filename)
  db.exec(`CREATE TABLE "${table}"(
    local_id INTEGER, server_id INTEGER, local_type INTEGER, create_time INTEGER,
    origin_source INTEGER
  )`)
  const insert = db.prepare(`INSERT INTO "${table}" VALUES (?, ?, ?, ?, ?)`)
  insert.run(42, 9001, 25_769_803_825, 1_783_800_000, 1)
  insert.run(43, 9002, 34, 1_783_800_001, 1)
  db.close()
}

function createResourceDatabase(filename: string, hash: string, fileName: string) {
  const db = new DatabaseSync(filename)
  db.exec(`
    CREATE TABLE ChatName2Id(user_name TEXT PRIMARY KEY, update_time INTEGER);
    CREATE TABLE MessageResourceInfo(
      message_id INTEGER PRIMARY KEY, chat_id INTEGER, sender_id INTEGER,
      message_local_type INTEGER, message_create_time INTEGER, message_local_id INTEGER,
      message_svr_id INTEGER, message_origin_source INTEGER, packed_info BLOB
    );
    CREATE TABLE MessageResourceDetail(
      resource_id INTEGER PRIMARY KEY, message_id INTEGER, type INTEGER, size INTEGER,
      create_time INTEGER, access_time INTEGER, status INTEGER, data_index TEXT, packed_info BLOB
    );
  `)
  db.prepare('INSERT INTO ChatName2Id(rowid, user_name, update_time) VALUES (7, ?, 0)').run('wxid_peer')
  db.prepare('INSERT INTO MessageResourceInfo VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    100, 7, 1, 25_769_803_825, 1_783_800_000, 42, 9001, 1,
    bytesField(2, bytesField(1, hash)),
  )
  db.prepare('INSERT INTO MessageResourceDetail VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    501, 100, 3_342_339, 4, 1_783_800_000, 1_783_800_000, 1, '0',
    bytesField(1, Buffer.concat([bytesField(1, fileName), bytesField(2, fileName)])),
  )
  db.close()
}

test('builds a versioned resource, link, and voice asset bundle with exact counts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatfiles-assets-中文-'))
  const sourceRoot = path.join(root, 'snapshot')
  const sourceMessageRoot = path.join(sourceRoot, 'db_storage', 'message')
  const accountRoot = path.join(root, 'account')
  const fileRoot = path.join(accountRoot, 'msg', 'file', '2026-07')
  const bundleDir = path.join(root, 'data', 'chat-assets.next')
  fs.mkdirSync(sourceMessageRoot, { recursive: true })
  fs.mkdirSync(fileRoot, { recursive: true })

  const conversation = 'wxid_peer'
  const table = `Msg_${crypto.createHash('md5').update(conversation, 'utf8').digest('hex')}`
  const hash = '0123456789abcdef0123456789abcdef'
  const localName = `${hash}.pdf`
  fs.writeFileSync(path.join(fileRoot, localName), Buffer.from('PDF!'))

  const wechatDbPath = path.join(root, 'wechat.db')
  const resourceDbPath = path.join(root, 'message_resource.db')
  createWechatDatabase(wechatDbPath, table)
  createSourceDatabase(path.join(sourceMessageRoot, 'message_0.db'), table)
  createResourceDatabase(resourceDbPath, hash, '课程讲义.pdf')

  const result = runConversationAssetBuilder({
    wechatDbPath,
    resourceDbPath,
    sourceSnapshotRoot: sourceRoot,
    accountRoot,
    bundleDir,
    runId: 'fixture-run',
  })

  assert.deepEqual(result.counts, {
    all: 3,
    work: 1,
    document: 1,
    skill: 0,
    link: 1,
    chatText: 1,
  })
  const output = new DatabaseSync(path.join(bundleDir, 'artifacts.db'), { readOnly: true })
  try {
    const rows = output.prepare(`
      SELECT kind, category, name, link_status, link_reason, materialization, preview_status, failure_reason
      FROM artifacts ORDER BY kind
    `).all().map((row) => ({ ...row }))
    assert.deepEqual(rows, [
      {
        kind: 'link', category: 'link', name: 'https://example.com/lesson',
        link_status: 'confirmed', link_reason: null,
        materialization: 'exported', preview_status: 'ready',
        failure_reason: null,
      },
      {
        kind: 'resource', category: 'document', name: '课程讲义.pdf',
        link_status: 'confirmed', link_reason: null,
        materialization: 'exported', preview_status: 'ready',
        failure_reason: null,
      },
      {
        kind: 'voice', category: 'work', name: '语音消息',
        link_status: 'unconfirmed', link_reason: 'voice_resource_not_available',
        materialization: 'missing_source', preview_status: 'missing_source',
        failure_reason: 'voice_source_not_exposed_by_message_resource',
      },
    ])
    assert.equal(output.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok')
  } finally {
    output.close()
  }

  const index = JSON.parse(fs.readFileSync(path.join(bundleDir, 'index.json'), 'utf8'))
  assert.equal(index.runId, 'fixture-run')
  assert.deepEqual(index.counts, result.counts)
  const audit = auditConversationAssetBundle({ bundleDir, accountRoot })
  assert.equal(audit.ok, true)
  assert.deepEqual(audit.issues, [])

  const tampered = new DatabaseSync(path.join(bundleDir, 'artifacts.db'))
  tampered.prepare("UPDATE artifacts SET failure_reason=NULL WHERE kind='voice'").run()
  tampered.close()
  const failedAudit = auditConversationAssetBundle({ bundleDir, accountRoot })
  assert.equal(failedAudit.ok, false)
  assert.equal(failedAudit.issues.some((issue) => issue.code === 'missing-failure-reason'), true)
  assert.throws(() => runConversationAssetBuilder({
    wechatDbPath,
    resourceDbPath,
    sourceSnapshotRoot: sourceRoot,
    accountRoot,
    bundleDir,
    runId: 'fixture-run-2',
  }), /already exists/u)
})

test('canonical resource lookups bind every available identity index column', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(`
      CREATE TABLE messages(
        conv_id TEXT, source_db TEXT, source_table TEXT, local_id INTEGER, server_id TEXT,
        message_uid TEXT
      );
      CREATE INDEX idx_msg_evidence ON messages(conv_id, source_db, source_table, local_id);
      CREATE UNIQUE INDEX idx_msg_server ON messages(conv_id, server_id)
        WHERE server_id IS NOT NULL AND trim(server_id)<>'' AND server_id<>'0';
    `)
    const localPlan = db.prepare(`
      EXPLAIN QUERY PLAN SELECT message_uid FROM messages m
      WHERE ${CANONICAL_LOCAL_LOOKUP_PREDICATE}
    `).all('conv', 'message_0.db', 'Msg_0123456789abcdef0123456789abcdef', 42)
    const serverPlan = db.prepare(`
      EXPLAIN QUERY PLAN SELECT message_uid FROM messages m
      WHERE ${CANONICAL_SERVER_LOOKUP_PREDICATE}
    `).all('conv', '9001')
    assert.equal(String(localPlan[0]?.detail).includes('idx_msg_evidence'), true)
    assert.equal(String(serverPlan[0]?.detail).includes('idx_msg_server'), true)
  } finally {
    db.close()
  }
})
