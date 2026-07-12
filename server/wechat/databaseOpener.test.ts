import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'
import { DatabaseSync } from 'node:sqlite'

import { wechatDb } from '../routes/wechat.js'
import { openValidatedWechatDatabase } from './databaseOpener.js'

type ParseRunOverrides = {
  status?: string
  completedAt?: string
  sourceMessages?: number
  outputMessages?: number
  deduplicatedMessages?: number | null
}

function fixtureRoot(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatfiles-wechat-opener-'))
  t.after(() => {
    const currentPath = path.join(root, 'data', 'wechat.current', 'wechat.db')
    const legacyPath = path.join(root, 'data', 'wechat.db')
    if (fs.existsSync(currentPath)) {
      if (fs.statSync(currentPath).isDirectory()) fs.rmdirSync(currentPath)
      else fs.unlinkSync(currentPath)
    }
    if (fs.existsSync(legacyPath)) fs.unlinkSync(legacyPath)
    const currentDir = path.dirname(currentPath)
    if (fs.existsSync(currentDir)) fs.rmdirSync(currentDir)
    const dataDir = path.join(root, 'data')
    if (fs.existsSync(dataDir)) fs.rmdirSync(dataDir)
    fs.rmdirSync(root)
  })
  return root
}

function createLegacyDatabase(root: string) {
  const databasePath = path.join(root, 'data', 'wechat.db')
  fs.mkdirSync(path.dirname(databasePath), { recursive: true })
  const db = new DatabaseSync(databasePath)
  db.exec(`
    CREATE TABLE conversations(
      id TEXT, account TEXT, username TEXT, display TEXT, is_group INTEGER,
      msg_count INTEGER, text_count INTEGER, first_time INTEGER, last_time INTEGER, summary TEXT
    );
    CREATE TABLE messages(
      conv_id TEXT, seq INTEGER, time INTEGER, sender TEXT, sender_name TEXT,
      type INTEGER, type_label TEXT, text TEXT
    );
    INSERT INTO conversations VALUES (
      'fixture-conversation', 'legacy', 'fixture-user', '回退会话', 0, 1, 1, 1, 1, ''
    );
  `)
  db.close()
  return databasePath
}

function createCurrentDatabase(
  root: string,
  options: { missingMessageUid?: boolean; parseRuns?: number; run?: ParseRunOverrides } = {},
) {
  const databasePath = path.join(root, 'data', 'wechat.current', 'wechat.db')
  fs.mkdirSync(path.dirname(databasePath), { recursive: true })
  const db = new DatabaseSync(databasePath)
  const messageUidColumn = options.missingMessageUid ? '' : 'message_uid TEXT,'
  db.exec(`
    CREATE TABLE contacts(
      account TEXT, owner TEXT, username TEXT, display TEXT, nick TEXT, remark TEXT, alias TEXT, is_group INTEGER
    );
    CREATE TABLE conversations(
      id TEXT, account TEXT, owner TEXT, username TEXT, display TEXT, is_group INTEGER,
      msg_count INTEGER, text_count INTEGER, first_time INTEGER, last_time INTEGER, summary TEXT
    );
    CREATE TABLE messages(
      conv_id TEXT, ${messageUidColumn} seq INTEGER, source_snapshot TEXT, source_db TEXT, source_table TEXT,
      local_id INTEGER, server_id TEXT, sort_seq INTEGER, time INTEGER, sender TEXT, sender_name TEXT,
      sender_prefix TEXT, is_own INTEGER, sender_source TEXT, sender_audit TEXT,
      raw_type INTEGER, type INTEGER, type_label TEXT, text TEXT
    );
    CREATE TABLE parse_runs(
      run_id TEXT, status TEXT, completed_at TEXT,
      selected_snapshot_count INTEGER, selected_source_count INTEGER,
      source_conversation_count INTEGER, source_message_count INTEGER,
      output_conversation_count INTEGER, output_message_count INTEGER, output_text_count INTEGER,
      deduplicated_message_count INTEGER
    );
  `)
  const run = options.run ?? {}
  const insert = db.prepare('INSERT INTO parse_runs VALUES (?,?,?,?,?,?,?,?,?,?,?)')
  for (let index = 0; index < (options.parseRuns ?? 1); index++) {
    insert.run(
      `run-${index}`,
      run.status ?? 'complete',
      run.completedAt ?? '2026-07-12T12:00:00.000Z',
      1,
      2,
      1,
      run.sourceMessages ?? 2,
      1,
      run.outputMessages ?? 2,
      1,
      run.deduplicatedMessages === undefined ? 0 : run.deduplicatedMessages,
    )
  }
  db.close()
  return databasePath
}

function currentRejection(root: string) {
  const opened = openValidatedWechatDatabase(root)
  assert.ok(opened.db)
  assert.equal(opened.resolution.source, 'legacy')
  assert.equal(opened.resolution.selectedPath, path.join(root, 'data', 'wechat.db'))
  assert.equal(opened.resolution.rejections.length, 1)
  assert.equal(opened.resolution.rejections[0].source, 'current')
  return opened
}

test('rejects a current database path that is a directory and opens valid legacy', (t) => {
  const root = fixtureRoot(t)
  fs.mkdirSync(path.join(root, 'data', 'wechat.current', 'wechat.db'), { recursive: true })
  createLegacyDatabase(root)

  const opened = currentRejection(root)
  try {
    assert.equal(opened.resolution.rejections[0].code, 'not-file')
  } finally {
    opened.db?.close()
  }
})

test('rejects corrupt current bytes and opens valid legacy', (t) => {
  const root = fixtureRoot(t)
  const currentPath = path.join(root, 'data', 'wechat.current', 'wechat.db')
  fs.mkdirSync(path.dirname(currentPath), { recursive: true })
  fs.writeFileSync(currentPath, 'not a sqlite database', 'utf8')
  createLegacyDatabase(root)

  const opened = currentRejection(root)
  try {
    assert.equal(opened.resolution.rejections[0].code, 'unreadable')
  } finally {
    opened.db?.close()
  }
})

test('rejects an incomplete current parse run and opens valid legacy', (t) => {
  const root = fixtureRoot(t)
  createCurrentDatabase(root, { run: { status: 'building', completedAt: '' } })
  createLegacyDatabase(root)

  const opened = currentRejection(root)
  try {
    assert.equal(opened.resolution.rejections[0].code, 'invalid-parse-run')
  } finally {
    opened.db?.close()
  }
})

test('rejects nonclosing current parse metadata and opens valid legacy', (t) => {
  const root = fixtureRoot(t)
  createCurrentDatabase(root, { run: { sourceMessages: 3, outputMessages: 2 } })
  createLegacyDatabase(root)

  const opened = currentRejection(root)
  try {
    assert.equal(opened.resolution.rejections[0].code, 'invalid-parse-run')
  } finally {
    opened.db?.close()
  }
})

test('rejects absent current count metadata instead of coercing null to zero', (t) => {
  const root = fixtureRoot(t)
  createCurrentDatabase(root, { run: { deduplicatedMessages: null } })
  createLegacyDatabase(root)

  const opened = currentRejection(root)
  try {
    assert.equal(opened.resolution.rejections[0].code, 'invalid-parse-run')
  } finally {
    opened.db?.close()
  }
})

test('rejects multiple current parse records and opens valid legacy', (t) => {
  const root = fixtureRoot(t)
  createCurrentDatabase(root, { parseRuns: 2 })
  createLegacyDatabase(root)

  const opened = currentRejection(root)
  try {
    assert.equal(opened.resolution.rejections[0].code, 'invalid-parse-run')
  } finally {
    opened.db?.close()
  }
})

test('rejects missing canonical columns and opens valid legacy', (t) => {
  const root = fixtureRoot(t)
  createCurrentDatabase(root, { missingMessageUid: true })
  createLegacyDatabase(root)

  const opened = currentRejection(root)
  try {
    assert.equal(opened.resolution.rejections[0].code, 'invalid-schema')
    assert.match(opened.resolution.rejections[0].detail, /messages\.message_uid/)
  } finally {
    opened.db?.close()
  }
})

test('prefers a valid complete canonical current database', (t) => {
  const root = fixtureRoot(t)
  const currentPath = createCurrentDatabase(root)
  createLegacyDatabase(root)

  const opened = openValidatedWechatDatabase(root)
  try {
    assert.ok(opened.db)
    assert.equal(opened.resolution.source, 'current')
    assert.equal(opened.resolution.selectedPath, currentPath)
    assert.equal(opened.resolution.currentAvailable, true)
    assert.equal(opened.resolution.legacyAvailable, true)
    assert.deepEqual(opened.resolution.rejections, [])
  } finally {
    opened.db?.close()
  }
})

test('wechat route opener delegates to validated candidate fallback', (t) => {
  const root = fixtureRoot(t)
  const currentPath = path.join(root, 'data', 'wechat.current', 'wechat.db')
  fs.mkdirSync(path.dirname(currentPath), { recursive: true })
  fs.writeFileSync(currentPath, 'broken current database', 'utf8')
  createLegacyDatabase(root)

  const openForRoot = wechatDb as (projectRoot: string) => DatabaseSync | null
  const db = openForRoot(root)
  try {
    const row = db?.prepare('SELECT id FROM conversations WHERE id=?').get('fixture-conversation') as
      | { id: string }
      | undefined
    assert.equal(row?.id, 'fixture-conversation')
  } finally {
    db?.close()
  }
})
