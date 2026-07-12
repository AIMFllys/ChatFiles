import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const parserPath = path.join(repoRoot, 'scripts', 'parseWeChat.ts')
const tsxCli = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')

const owner = 'wxid_owner_fragment'
const peer = 'wxid_peer'
const room = 'fixture@chatroom'

function md5(value: string) {
  return crypto.createHash('md5').update(value, 'utf8').digest('hex')
}

function createContactDatabase(snapshotDir: string, peerDisplay = '陈同学') {
  const targetDir = path.join(snapshotDir, 'db_storage', 'contact')
  fs.mkdirSync(targetDir, { recursive: true })
  const db = new DatabaseSync(path.join(targetDir, 'contact.db'))
  db.exec(`
    CREATE TABLE contact(username TEXT, nick_name TEXT, remark TEXT, alias TEXT, local_type INTEGER);
    INSERT INTO contact VALUES ('${owner}', '机主', '', '', 0);
    INSERT INTO contact VALUES ('${peer}', '${peerDisplay}', '', '', 0);
    INSERT INTO contact VALUES ('${room}', '中文项目群', '', '', 0);
    INSERT INTO contact VALUES ('wxid_member', '群成员甲', '', '', 0);
    CREATE TABLE chat_room(username TEXT);
    INSERT INTO chat_room VALUES ('${room}');
  `)
  db.close()
}

function createSessionDatabase(snapshotDir: string, peerSummary = '中文私聊摘要') {
  const targetDir = path.join(snapshotDir, 'db_storage', 'session')
  fs.mkdirSync(targetDir, { recursive: true })
  const db = new DatabaseSync(path.join(targetDir, 'session.db'))
  db.exec(`
    CREATE TABLE SessionTable(username TEXT, summary TEXT, last_timestamp INTEGER);
    INSERT INTO SessionTable VALUES ('${peer}', '${peerSummary}', 1700000000);
    INSERT INTO SessionTable VALUES ('${room}', '中文群聊摘要', 1700000001);
  `)
  db.close()
}

type FixtureMessage = {
  conversation: string
  localId: number
  serverId: string
  rawType: string
  sortSeq: number
  realSenderId: number
  time: number
  content: string
}

function createMessageDatabase(
  snapshotDir: string,
  filename: string,
  names: Array<[number, string]>,
  messages: FixtureMessage[],
) {
  const targetDir = path.join(snapshotDir, 'db_storage', 'message')
  fs.mkdirSync(targetDir, { recursive: true })
  const dbPath = path.join(targetDir, filename)
  const db = new DatabaseSync(dbPath)
  db.exec('CREATE TABLE Name2Id(user_name TEXT PRIMARY KEY, is_session INTEGER);')
  const insertName = db.prepare('INSERT INTO Name2Id(rowid, user_name, is_session) VALUES (?,?,0)')
  for (const [id, username] of names) insertName.run(id, username)

  for (const conversation of new Set(messages.map((message) => message.conversation))) {
    const table = `Msg_${md5(conversation)}`
    db.exec(`
      CREATE TABLE "${table}"(
        local_id INTEGER, server_id INTEGER, local_type INTEGER, sort_seq INTEGER,
        real_sender_id INTEGER, create_time INTEGER, message_content TEXT, compress_content BLOB
      );
    `)
    const insert = db.prepare(`INSERT INTO "${table}" VALUES (?,?,?,?,?,?,?,NULL)`)
    for (const message of messages.filter((item) => item.conversation === conversation)) {
      insert.run(
        message.localId,
        BigInt(message.serverId),
        BigInt(message.rawType),
        message.sortSeq,
        message.realSenderId,
        message.time,
        message.content,
      )
    }
  }
  db.close()
  return dbPath
}

function createFixtureRoot(options: {
  conflictingDuplicate?: boolean
  conflictingEvidence?: boolean
  duplicateExactEvidence?: boolean
  repeatedFoldedEvidence?: boolean
  changedSharedMessage?: boolean
  boundaryUnicode?: boolean
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatfiles-parser-'))
  fs.writeFileSync(path.join(root, '.env.local'), 'VITE_OWNER_WXID=owner_fragment\n', 'utf8')
  const oldSnapshot = path.join(root, 'work', 'decrypted', 'wechat', 'snapshot-old')
  const newSnapshot = path.join(root, 'work', 'decrypted', 'wechat', 'snapshot-new')
  const boundaryEmoji = String.fromCodePoint(0x1f600)
  const peerDisplay = options.boundaryUnicode ? `${'陈'.repeat(79)}${boundaryEmoji}tail` : undefined
  const peerSummary = options.boundaryUnicode ? `${'摘'.repeat(119)}${boundaryEmoji}tail` : undefined
  for (const snapshot of [oldSnapshot, newSnapshot]) {
    createContactDatabase(snapshot, peerDisplay)
    createSessionDatabase(snapshot, peerSummary)
  }

  const oldDb = createMessageDatabase(oldSnapshot, 'message_0.db', [[7, owner]], [
    {
      conversation: peer,
      localId: 1,
      serverId: '1001',
      rawType: '9223372032559808513',
      sortSeq: 20,
      realSenderId: 7,
      time: 1700000000,
      content: options.changedSharedMessage ? '相同 server_id 但内容已变化' : '机主发出的中文',
    },
  ])
  const newDb0 = createMessageDatabase(newSnapshot, 'message_0.db', [[7, owner], [9, peer]], [
    {
      conversation: peer,
      localId: 1,
      serverId: '1001',
      rawType: '9223372032559808513',
      sortSeq: 20,
      realSenderId: 7,
      time: 1700000000,
      content: '机主发出的中文',
    },
    {
      conversation: peer,
      localId: 2,
      serverId: '0',
      rawType: '1',
      sortSeq: 30,
      realSenderId: 999,
      time: 1700000000,
      content: '身份未知但正文保留',
    },
    ...(options.duplicateExactEvidence ? [{
      conversation: peer,
      localId: 2,
      serverId: '0',
      rawType: '1',
      sortSeq: 30,
      realSenderId: 999,
      time: 1700000000,
      content: '身份未知但正文保留',
    }] : []),
    ...(options.conflictingEvidence ? [{
      conversation: peer,
      localId: 2,
      serverId: '0',
      rawType: '1',
      sortSeq: 35,
      realSenderId: 999,
      time: 1700000000,
      content: '相同 evidence key 的冲突正文',
    }] : []),
    {
      conversation: peer,
      localId: 3,
      serverId: '1002',
      rawType: '1',
      sortSeq: 40,
      realSenderId: 9,
      time: 1700000000,
      content: options.conflictingDuplicate ? '相同 server_id 的冲突正文' : '对端先发出的中文',
    },
    ...(options.repeatedFoldedEvidence ? [{
      conversation: peer,
      localId: 3,
      serverId: '1003',
      rawType: '1',
      sortSeq: 50,
      realSenderId: 9,
      time: 1700000000,
      content: '对端先发出的中文',
    }] : []),
  ])
  const newDb1 = createMessageDatabase(newSnapshot, 'message_1.db', [[7, peer], [8, 'wxid_member']], [
    {
      conversation: peer,
      localId: 5,
      serverId: '1002',
      rawType: '1',
      sortSeq: 10,
      realSenderId: 7,
      time: 1700000000,
      content: '对端先发出的中文',
    },
    {
      conversation: room,
      localId: 8,
      serverId: '2001',
      rawType: '1',
      sortSeq: 1,
      realSenderId: 8,
      time: 1700000001,
      content: 'wxid_member:\n群聊中文正文',
    },
  ])

  const oldTime = new Date('2025-01-01T00:00:00Z')
  const newTime = new Date('2026-01-01T00:00:00Z')
  fs.utimesSync(oldDb, oldTime, oldTime)
  fs.utimesSync(newDb0, newTime, newTime)
  fs.utimesSync(newDb1, newTime, newTime)
  return root
}

function runParser(root: string) {
  return spawnSync(process.execPath, [tsxCli, parserPath], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CHATFILES_RUN_ID: 'fixture-run' },
  })
}

test('builds a non-destructive identity-aligned next database from strict snapshot coverage', () => {
  const root = createFixtureRoot()
  try {
    const first = runParser(root)
    assert.equal(first.status, 0, first.stderr || first.stdout)

    const bundleDir = path.join(root, 'data', 'wechat.next')
    const dbPath = path.join(bundleDir, 'wechat.db')
    const indexPath = path.join(bundleDir, 'index.json')
    const transcriptDir = path.join(bundleDir, 'transcripts')
    assert.equal(fs.existsSync(bundleDir), true)
    assert.equal(fs.statSync(bundleDir).isDirectory(), true)
    assert.equal(fs.existsSync(dbPath), true)
    assert.equal(fs.existsSync(indexPath), true)
    assert.equal(fs.existsSync(transcriptDir), true)
    assert.deepEqual(fs.readdirSync(bundleDir).sort(), ['index.json', 'transcripts', 'wechat.db'])
    assert.equal(fs.existsSync(path.join(root, 'data', 'wechat.next.db')), false)
    assert.equal(fs.existsSync(path.join(root, 'data', 'wechat', 'index.next.json')), false)
    assert.equal(fs.existsSync(path.join(root, 'work', 'chat-text-v2', 'fixture-run')), false)
    assert.equal(fs.existsSync(path.join(root, 'data', 'wechat.db')), false)
    assert.equal(fs.existsSync(path.join(root, 'work', 'chat-text')), false)

    const db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      const conversations = db.prepare('SELECT account, owner, username FROM conversations ORDER BY username')
        .all()
        .map((row) => ({ ...row }))
      assert.deepEqual(conversations, [
        { account: 'snapshot-new', owner, username: room },
        { account: 'snapshot-new', owner, username: peer },
      ])

      const privateRows = db.prepare(`
        SELECT server_id, CAST(raw_type AS TEXT) AS raw_type, type, sender, sender_source, sender_audit,
          source_db, local_id, sort_seq, text
        FROM messages WHERE conv_id=? ORDER BY seq
      `).all(`wx:${owner}:${peer}`).map((row) => ({ ...row }))
      assert.deepEqual(privateRows, [
        {
          server_id: '1002', raw_type: '1', type: 1, sender: peer,
          sender_source: 'message-name2id', sender_audit: '', source_db: 'message_1.db',
          local_id: 5, sort_seq: 10, text: '对端先发出的中文',
        },
        {
          server_id: '1001', raw_type: '9223372032559808513', type: 1, sender: owner,
          sender_source: 'message-name2id', sender_audit: '', source_db: 'message_0.db',
          local_id: 1, sort_seq: 20, text: '机主发出的中文',
        },
        {
          server_id: '0', raw_type: '1', type: 1, sender: '', sender_source: 'unknown',
          sender_audit: 'private-direction-unknown', source_db: 'message_0.db',
          local_id: 2, sort_seq: 30, text: '身份未知但正文保留',
        },
      ])
      assert.equal(
        db.prepare("SELECT count(*) AS total FROM messages WHERE sender_audit='group-prefix-mismatch'").get()?.total,
        0,
      )
      assert.deepEqual(
        db.prepare(`
          SELECT run_id, status, selected_snapshot_count, selected_source_count,
            source_conversation_count, source_message_count, output_conversation_count,
            output_message_count, output_text_count, deduplicated_message_count
          FROM parse_runs
        `).all().map((row) => ({ ...row })),
        [{
          run_id: 'fixture-run',
          status: 'complete',
          selected_snapshot_count: 1,
          selected_source_count: 2,
          source_conversation_count: 2,
          source_message_count: 5,
          output_conversation_count: 2,
          output_message_count: 4,
          output_text_count: 4,
          deduplicated_message_count: 1,
        }],
      )
    } finally {
      db.close()
    }

    const transcriptFiles = fs.readdirSync(transcriptDir).filter((name) => name.endsWith('.txt'))
    assert.equal(transcriptFiles.length, 2)
    const transcriptText = transcriptFiles
      .map((name) => fs.readFileSync(path.join(transcriptDir, name), 'utf8'))
      .join('\n')
    assert.match(transcriptText, /机主发出的中文/)
    assert.match(transcriptText, /群聊中文正文/)
    assert.equal(transcriptText.includes('\uFFFD'), false)

    const before = fs.readFileSync(dbPath)
    const second = runParser(root)
    assert.notEqual(second.status, 0)
    assert.match(second.stderr, /already exists/i)
    assert.deepEqual(fs.readFileSync(dbPath), before)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('keeps transcript filenames and index summaries on Unicode code-point boundaries', () => {
  const root = createFixtureRoot({ boundaryUnicode: true })
  try {
    const result = runParser(root)
    assert.equal(result.status, 0, result.stderr || result.stdout)

    const bundleDir = path.join(root, 'data', 'wechat.next')
    const index = JSON.parse(fs.readFileSync(path.join(bundleDir, 'index.json'), 'utf8')) as {
      conversations: Array<{ username: string, summary: string }>
    }
    const peerEntry = index.conversations.find((entry) => entry.username === peer)
    const emoji = String.fromCodePoint(0x1f600)
    assert.equal(peerEntry?.summary, `${'摘'.repeat(119)}${emoji}`)
    assert.equal(peerEntry?.summary.includes('\uFFFD'), false)

    const transcriptFiles = fs.readdirSync(path.join(bundleDir, 'transcripts'))
    const peerSuffix = `__${md5(peer).slice(0, 8)}.txt`
    const peerTranscript = transcriptFiles.find((name) => name.endsWith(peerSuffix))
    assert.equal(peerTranscript, `${'陈'.repeat(79)}${emoji}${peerSuffix}`)
    assert.equal(peerTranscript?.includes('\uFFFD'), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

function assertNoFinalOutputs(root: string) {
  assert.equal(fs.existsSync(path.join(root, 'data', 'wechat.next')), false)
  assert.equal(fs.existsSync(path.join(root, 'data', 'wechat.next.db')), false)
  assert.equal(fs.existsSync(path.join(root, 'data', 'wechat', 'index.next.json')), false)
  assert.equal(fs.existsSync(path.join(root, 'work', 'chat-text-v2', 'fixture-run')), false)
}

test('rejects conflicting duplicate semantics without publishing final artifacts', () => {
  const root = createFixtureRoot({ conflictingDuplicate: true })
  try {
    const result = runParser(root)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /conflicting duplicate/i)
    assertNoFinalOutputs(root)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('rejects conflicting evidence-key semantics without publishing final artifacts', () => {
  const root = createFixtureRoot({ conflictingEvidence: true })
  try {
    const result = runParser(root)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /duplicate exact evidence key/i)
    assertNoFinalOutputs(root)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('rejects duplicate exact evidence keys even when message semantics match', () => {
  const root = createFixtureRoot({ duplicateExactEvidence: true })
  try {
    const result = runParser(root)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /duplicate exact evidence key/i)
    assertNoFinalOutputs(root)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('rejects repeated evidence after its first row was folded by server identity', () => {
  const root = createFixtureRoot({ repeatedFoldedEvidence: true })
  try {
    const result = runParser(root)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /duplicate exact evidence key/i)
    assertNoFinalOutputs(root)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('does not treat a changed message body as strict snapshot coverage', () => {
  const root = createFixtureRoot({ changedSharedMessage: true })
  try {
    const result = runParser(root)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /ambiguous account snapshots/i)
    assertNoFinalOutputs(root)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
