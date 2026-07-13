import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { createFixtureRoot, md5, owner, peer, room, runParser } from './parseWeChatTestFixtures.js'

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

for (const [name, options, pattern] of [
  ['rejects conflicting duplicate semantics without publishing final artifacts', { conflictingDuplicate: true }, /conflicting duplicate/i],
  ['rejects conflicting evidence-key semantics without publishing final artifacts', { conflictingEvidence: true }, /duplicate exact evidence key/i],
  ['rejects duplicate exact evidence keys even when message semantics match', { duplicateExactEvidence: true }, /duplicate exact evidence key/i],
  ['rejects repeated evidence after its first row was folded by server identity', { repeatedFoldedEvidence: true }, /duplicate exact evidence key/i],
] as const) {
  test(name, () => {
    const root = createFixtureRoot(options)
    try {
      const result = runParser(root)
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, pattern)
      assertNoFinalOutputs(root)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
}

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
