import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'

import { auditSourceIdentity } from './sourceIdentityAudit.js'

type SourceRow = {
  localId: number
  serverId: bigint
  rawType: bigint
  sortSeq: number
  realSenderId: number
  time: number
  content: string
}

type OutputRow = {
  uid: string
  sourceDb: string
  localId: number
  serverId: bigint
  rawType: bigint
  sortSeq: number
  time: number
  sender: string
  senderName?: string
  senderPrefix?: string
  text?: string
}

const snapshot = 'snapshot-new'
const table = 'Msg_fixture'

function createSourceContacts(root: string) {
  const contactDir = path.join(root, snapshot, 'db_storage', 'contact')
  fs.mkdirSync(contactDir, { recursive: true })
  const dbPath = path.join(contactDir, 'contact.db')
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE contact(username TEXT, nick_name TEXT, remark TEXT, alias TEXT);
    INSERT INTO contact VALUES ('wxid_owner', '机主', '', '');
    INSERT INTO contact VALUES ('wxid_peer', '陈同学', '', '');
    INSERT INTO contact VALUES ('wxid_member', '群成员甲', '', '');
    INSERT INTO contact VALUES ('room@chatroom', '中文测试群', '', '');
  `)
  db.close()
  return dbPath
}

function createSourceShard(
  root: string,
  filename: string,
  names: ReadonlyArray<readonly [number, string]>,
  rows: readonly SourceRow[],
) {
  const messageDir = path.join(root, snapshot, 'db_storage', 'message')
  fs.mkdirSync(messageDir, { recursive: true })
  const dbPath = path.join(messageDir, filename)
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE Name2Id(user_name TEXT PRIMARY KEY, is_session INTEGER);
    CREATE TABLE ${table}(
      local_id INTEGER, server_id INTEGER, local_type INTEGER, sort_seq INTEGER,
      real_sender_id INTEGER, create_time INTEGER, message_content TEXT, compress_content BLOB
    );
  `)
  const insertName = db.prepare('INSERT INTO Name2Id(rowid, user_name, is_session) VALUES (?,?,0)')
  for (const [id, username] of names) insertName.run(id, username)
  const insertMessage = db.prepare(`INSERT INTO ${table} VALUES (?,?,?,?,?,?,?,NULL)`)
  for (const row of rows) {
    insertMessage.run(
      row.localId,
      row.serverId,
      row.rawType,
      row.sortSeq,
      row.realSenderId,
      row.time,
      row.content,
    )
  }
  db.close()
  return dbPath
}

function createOutputDatabase(
  root: string,
  options: {
    owner?: string
    peer?: string
    isGroup?: boolean
    rows: readonly OutputRow[]
  },
) {
  const dbPath = path.join(root, 'wechat.db')
  const owner = options.owner ?? 'wxid_owner'
  const peer = options.peer ?? 'wxid_peer'
  const convId = `wx:${owner}:${peer}`
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE conversations(
      id TEXT PRIMARY KEY, account TEXT, owner TEXT, username TEXT, display TEXT, is_group INTEGER,
      msg_count INTEGER, text_count INTEGER, first_time INTEGER, last_time INTEGER, summary TEXT
    );
    CREATE TABLE messages(
      conv_id TEXT, message_uid TEXT, seq INTEGER, source_snapshot TEXT, source_db TEXT, source_table TEXT,
      local_id INTEGER, server_id TEXT, sort_seq INTEGER, time INTEGER, sender TEXT, sender_name TEXT,
      sender_prefix TEXT, is_own INTEGER, sender_source TEXT, sender_audit TEXT,
      raw_type INTEGER, type INTEGER, type_label TEXT, text TEXT
    );
    CREATE TABLE parse_runs(
      run_id TEXT, status TEXT, completed_at TEXT, selected_snapshot_count INTEGER,
      selected_source_count INTEGER, source_conversation_count INTEGER, source_message_count INTEGER,
      output_conversation_count INTEGER, output_message_count INTEGER, output_text_count INTEGER,
      deduplicated_message_count INTEGER
    );
  `)
  db.prepare('INSERT INTO conversations VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
    convId,
    snapshot,
    owner,
    peer,
    '中文测试会话',
    options.isGroup ? 1 : 0,
    options.rows.length,
    options.rows.length,
    Math.min(...options.rows.map((row) => row.time)),
    Math.max(...options.rows.map((row) => row.time)),
    '',
  )
  const insert = db.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  options.rows.forEach((row, index) => {
    insert.run(
      convId,
      row.uid,
      index,
      snapshot,
      row.sourceDb,
      table,
      row.localId,
      row.serverId.toString(),
      row.sortSeq,
      row.time,
      row.sender,
      row.senderName ?? row.sender,
      row.senderPrefix ?? '',
      row.sender === owner ? 1 : 0,
      'message-name2id',
      '',
      row.rawType,
      Number(BigInt.asUintN(32, row.rawType)),
      'text',
      row.text ?? '中文正文',
    )
  })
  const textCount = options.rows.filter(
    (row) => Number(BigInt.asUintN(32, row.rawType)) === 1,
  ).length
  db.prepare('INSERT INTO parse_runs VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
    'fixture-run',
    'complete',
    '2026-07-12T00:00:00.000Z',
    1,
    new Set(options.rows.map((row) => row.sourceDb)).size,
    1,
    options.rows.length,
    1,
    options.rows.length,
    textCount,
    0,
  )
  db.close()
  return dbPath
}

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatfiles-source-audit-'))
  const sourceRoot = path.join(dir, 'source')
  const files = [createSourceContacts(sourceRoot)]
  return {
    dir,
    sourceRoot,
    track(file: string) {
      files.push(file)
      return file
    },
    cleanup() {
      for (const file of files.reverse()) {
        if (fs.existsSync(file)) fs.unlinkSync(file)
      }
      const messageDir = path.join(sourceRoot, snapshot, 'db_storage', 'message')
      const contactDir = path.join(sourceRoot, snapshot, 'db_storage', 'contact')
      const directories = [
        messageDir,
        contactDir,
        path.dirname(messageDir),
        path.dirname(path.dirname(messageDir)),
        path.join(sourceRoot, snapshot),
        sourceRoot,
        dir,
      ]
      for (const directory of directories) {
        if (fs.existsSync(directory)) fs.rmdirSync(directory)
      }
    },
  }
}

test('keeps identical Name2Id rowids isolated between source message shards', () => {
  const item = fixture()
  try {
    const rawType = 9_223_372_032_559_808_513n
    item.track(createSourceShard(item.sourceRoot, 'message_0.db', [[7, 'wxid_owner']], [{
      localId: 12,
      serverId: 9_007_199_254_740_999n,
      rawType,
      sortSeq: 90,
      realSenderId: 7,
      time: 1_700_000_000,
      content: '我发送的中文',
    }]))
    item.track(createSourceShard(item.sourceRoot, 'message_1.db', [[7, 'wxid_peer']], [{
      localId: 12,
      serverId: 9_007_199_254_741_001n,
      rawType,
      sortSeq: 91,
      realSenderId: 7,
      time: 1_700_000_001,
      content: '对方发送的中文',
    }]))
    const outputDb = item.track(createOutputDatabase(item.dir, { rows: [
      {
        uid: 'uid-left', sourceDb: 'message_0.db', localId: 12,
        serverId: 9_007_199_254_740_999n, rawType, sortSeq: 90,
        time: 1_700_000_000, sender: 'wxid_owner', senderName: '机主',
        text: '我发送的中文',
      },
      {
        uid: 'uid-right', sourceDb: 'message_1.db', localId: 12,
        serverId: 9_007_199_254_741_001n, rawType, sortSeq: 91,
        time: 1_700_000_001, sender: 'wxid_peer', senderName: '陈同学',
        text: '对方发送的中文',
      },
    ] }))

    const result = auditSourceIdentity(outputDb, item.sourceRoot)

    assert.equal(result.ok, true)
    assert.deepEqual(result.issues, [])
    assert.equal(result.metrics.outputMessages, 2)
    assert.equal(result.metrics.matchedMessages, 2)
    assert.equal(result.metrics.sourceShards, 2)
  } finally {
    item.cleanup()
  }
})

test('rejects a private conversation whose peer message is spoofed as the owner', () => {
  const item = fixture()
  try {
    const rawType = 1n
    item.track(createSourceShard(item.sourceRoot, 'message_0.db', [
      [7, 'wxid_owner'],
      [8, 'wxid_peer'],
    ], [
      {
        localId: 1, serverId: 101n, rawType, sortSeq: 1, realSenderId: 7,
        time: 1_700_000_000, content: '本人消息',
      },
      {
        localId: 2, serverId: 102n, rawType, sortSeq: 2, realSenderId: 8,
        time: 1_700_000_001, content: '对方消息',
      },
    ]))
    const outputDb = item.track(createOutputDatabase(item.dir, { rows: [
      {
        uid: 'uid-owner', sourceDb: 'message_0.db', localId: 1,
        serverId: 101n, rawType, sortSeq: 1, time: 1_700_000_000,
        sender: 'wxid_owner', senderName: '机主', text: '本人消息',
      },
      {
        uid: 'uid-spoofed-peer', sourceDb: 'message_0.db', localId: 2,
        serverId: 102n, rawType, sortSeq: 2, time: 1_700_000_001,
        sender: 'wxid_owner', senderName: '机主', text: '对方消息',
      },
    ] }))

    const result = auditSourceIdentity(outputDb, item.sourceRoot)

    assert.equal(result.ok, false)
    assert.equal(result.issues.find((issue) => issue.code === 'source-sender-mismatch')?.count, 1)
  } finally {
    item.cleanup()
  }
})

test('strict CLI exits non-zero when source identity alignment fails', () => {
  const item = fixture()
  try {
    item.track(createSourceShard(item.sourceRoot, 'message_0.db', [
      [7, 'wxid_owner'],
      [8, 'wxid_peer'],
    ], [
      {
        localId: 1, serverId: 101n, rawType: 1n, sortSeq: 1, realSenderId: 7,
        time: 1_700_000_000, content: '本人消息',
      },
      {
        localId: 2, serverId: 102n, rawType: 1n, sortSeq: 2, realSenderId: 8,
        time: 1_700_000_001, content: '对方消息',
      },
    ]))
    const outputDb = item.track(createOutputDatabase(item.dir, { rows: [
      {
        uid: 'uid-owner', sourceDb: 'message_0.db', localId: 1,
        serverId: 101n, rawType: 1n, sortSeq: 1, time: 1_700_000_000,
        sender: 'wxid_owner', senderName: '机主', text: '本人消息',
      },
      {
        uid: 'uid-spoofed-peer', sourceDb: 'message_0.db', localId: 2,
        serverId: 102n, rawType: 1n, sortSeq: 2, time: 1_700_000_001,
        sender: 'wxid_owner', senderName: '机主', text: '对方消息',
      },
    ] }))

    const cli = spawnSync(process.execPath, [
      '--import',
      'tsx',
      path.resolve(process.cwd(), 'scripts', 'auditChatIdentity.ts'),
      '--db',
      outputDb,
      '--source',
      item.sourceRoot,
      '--strict',
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })

    assert.equal(cli.status, 1, cli.stderr || cli.stdout)
    const payload = JSON.parse(cli.stdout) as {
      issues: unknown[]
      sourceIdentity: { issues: Array<{ code: string }> }
    }
    assert.deepEqual(payload.issues, [])
    assert.equal(
      payload.sourceIdentity.issues.some((issue) => issue.code === 'source-sender-mismatch'),
      true,
    )
  } finally {
    item.cleanup()
  }
})

test('reports missing source rows and every immutable source-field conflict', () => {
  const item = fixture()
  try {
    item.track(createSourceShard(item.sourceRoot, 'message_0.db', [[7, 'wxid_member']], [{
      localId: 1,
      serverId: 201n,
      rawType: 49n,
      sortSeq: 11,
      realSenderId: 7,
      time: 1_700_000_100,
      content: 'wxid_member:\n群聊中文正文',
    }]))
    const outputDb = item.track(createOutputDatabase(item.dir, {
      owner: 'wxid_owner',
      peer: 'room@chatroom',
      isGroup: true,
      rows: [
        {
          uid: 'uid-conflict', sourceDb: 'message_0.db', localId: 1,
          serverId: 999n, rawType: 3n, sortSeq: 99, time: 1_700_000_999,
          sender: 'wxid_member', senderName: '群成员甲', senderPrefix: 'wxid_wrong_prefix',
          text: '[链接/应用消息]',
        },
        {
          uid: 'uid-missing', sourceDb: 'message_0.db', localId: 404,
          serverId: 404n, rawType: 1n, sortSeq: 404, time: 1_700_000_404,
          sender: 'wxid_member',
        },
      ],
    }))

    const result = auditSourceIdentity(outputDb, item.sourceRoot)
    const codes = new Set(result.issues.map((issue) => issue.code))

    assert.equal(result.ok, false)
    assert.equal(codes.has('source-row-missing'), true)
    assert.equal(codes.has('source-server-id-mismatch'), true)
    assert.equal(codes.has('source-raw-type-mismatch'), true)
    assert.equal(codes.has('source-time-mismatch'), true)
    assert.equal(codes.has('source-sort-seq-mismatch'), true)
    assert.equal(codes.has('source-group-prefix-mismatch'), true)
  } finally {
    item.cleanup()
  }
})

test('rejects mutated output text and sender display name despite exact source provenance', () => {
  const item = fixture()
  try {
    item.track(createSourceShard(item.sourceRoot, 'message_0.db', [[8, 'wxid_peer']], [{
      localId: 9,
      serverId: 309n,
      rawType: 1n,
      sortSeq: 19,
      realSenderId: 8,
      time: 1_700_000_309,
      content: '源中文正文',
    }]))
    const outputDb = item.track(createOutputDatabase(item.dir, { rows: [{
      uid: 'uid-mutated',
      sourceDb: 'message_0.db',
      localId: 9,
      serverId: 309n,
      rawType: 1n,
      sortSeq: 19,
      time: 1_700_000_309,
      sender: 'wxid_peer',
      senderName: '伪造人物',
      text: '被篡改的中文正文',
    }] }))

    const result = auditSourceIdentity(outputDb, item.sourceRoot)
    const codes = new Set(result.issues.map((issue) => issue.code))

    assert.equal(result.ok, false)
    assert.equal(codes.has('source-text-mismatch'), true)
    assert.equal(codes.has('source-sender-name-mismatch'), true)
  } finally {
    item.cleanup()
  }
})
