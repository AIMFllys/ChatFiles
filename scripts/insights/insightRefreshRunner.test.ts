import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import {
  activateInsightRefresh,
  auditInsightRefresh,
  distillInsightRefresh,
  prepareInsightRefresh,
  rebuildInsightBoards,
} from './insightRefreshRunner.js'
import type { InsightConversation, InsightState } from './insightRefresh.js'

function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
}

function readJson(file: string) {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
}

function fixture(t: test.TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatfiles-insights-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const source = path.join(root, 'data', 'insights')
  const dbPath = path.join(root, 'data', 'wechat.current', 'wechat.db')
  const aliasMapPath = path.join(root, 'work', 'audits', 'insight-owner-aliases.json')
  fs.mkdirSync(path.join(source, 'conv'), { recursive: true })
  fs.mkdirSync(path.join(source, 'boards'), { recursive: true })
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  fs.writeFileSync(path.join(source, 'boards', 'AI.md'), '# AI\n\n旧主题板', 'utf8')

  const conversations: InsightConversation[] = [
    {
      convId: 'wx:short:room@chatroom',
      name: '旧群名',
      isGroup: true,
      summary: '旧总结',
      topics: ['技术'],
      keyPeople: ['甲'],
      nuggets: [{ category: '技术', title: '旧要点', content: '必须保留', importance: 3 }],
    },
    {
      convId: 'wx:old-owner:room@chatroom',
      name: '中文群',
      isGroup: true,
      summary: '新总结',
      topics: ['AI'],
      keyPeople: ['乙'],
      nuggets: [{ category: 'AI', title: '新要点', content: '同样保留', importance: 4 }],
    },
  ]
  for (const [index, conversation] of conversations.entries()) {
    writeJson(path.join(source, 'conv', `legacy-${index}.json`), conversation)
  }
  const states: InsightState[] = [
    { convId: conversations[0]!.convId, analyzedTextCount: 30, analyzedLastTime: 100, analyzedAt: 'old' },
    {
      convId: conversations[1]!.convId,
      analyzedTextCount: 40,
      analyzedLastTime: 200,
      analyzedLastMessageUid: 'room-005',
      analyzedAt: 'new',
    },
  ]
  writeJson(path.join(source, '_state.json'), states)
  writeJson(path.join(source, '_manifest.json'), conversations.map((conversation, index) => ({
    convId: conversation.convId,
    name: conversation.name,
    isGroup: conversation.isGroup,
    textCount: index === 0 ? 30 : 40,
  })))
  writeJson(aliasMapPath, {
    version: 1,
    canonicalOwner: 'canonical',
    aliases: { short: 'canonical', 'old-owner': 'canonical' },
    evidence: [{ kind: 'strict-source-audit', reference: 'fixture' }],
  })

  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      display TEXT NOT NULL,
      is_group INTEGER NOT NULL,
      text_count INTEGER NOT NULL,
      first_time INTEGER NOT NULL,
      last_time INTEGER NOT NULL
    );
    CREATE TABLE messages (
      conv_id TEXT NOT NULL,
      message_uid TEXT NOT NULL,
      type INTEGER NOT NULL,
      time INTEGER NOT NULL,
      sender_name TEXT,
      text TEXT
    );
  `)
  const insertConversation = db.prepare('INSERT INTO conversations VALUES (?, ?, ?, ?, ?, ?)')
  insertConversation.run('wx:canonical:room@chatroom', '中文群', 1, 50, 50, 300)
  insertConversation.run('wx:canonical:new-peer', '新增私聊', 0, 20, 250, 310)
  const insertMessage = db.prepare('INSERT INTO messages VALUES (?, ?, 1, ?, ?, ?)')
  for (let index = 0; index < 10; index++) {
    insertMessage.run(
      'wx:canonical:room@chatroom',
      `room-${String(index + 6).padStart(3, '0')}`,
      index === 0 ? 200 : 200 + index,
      '孔德羽',
      index === 0 ? '这次决定使用 Codex 完成本地增量审计并记录方法。' : '收到',
    )
  }
  for (let index = 0; index < 20; index++) {
    insertMessage.run(
      'wx:canonical:new-peer',
      `new-${String(index + 1).padStart(3, '0')}`,
      291 + index,
      '陈同学',
      index === 0 ? '建议使用 Python 处理课程数据，完成后一起复盘结果。' : '嗯',
    )
  }
  db.close()
  return { root, source, dbPath, aliasMapPath }
}

test('prepares, distills, audits, and activates a non-destructive canonical insight snapshot', (t) => {
  const owned = fixture(t)

  const prepared = prepareInsightRefresh({ root: owned.root, runId: 'fixture', aliasMapPath: owned.aliasMapPath })
  assert.equal(prepared.metrics.canonicalConversations, 1)
  assert.deepEqual(prepared.delta, { new: 1, grown: 1, accumulated: 0, unchanged: 0 })
  assert.equal(fs.readdirSync(path.join(owned.source, 'conv')).length, 2)
  assert.equal(fs.readdirSync(path.join(prepared.bundleDir, 'conv')).length, 1)
  assert.equal(fs.existsSync(path.join(prepared.bundleDir, 'boards', 'AI.md')), true)

  const distilled = distillInsightRefresh({ root: owned.root, runId: 'fixture' })
  assert.equal(distilled.processed, 2)
  assert.equal(fs.readdirSync(path.join(prepared.bundleDir, 'conv')).length, 2)
  assert.equal(fs.existsSync(path.join(owned.root, 'data', 'insights.prepared.fixture', 'receipt.json')), true)

  const staleBoardAudit = auditInsightRefresh({ root: owned.root, bundleDir: prepared.bundleDir })
  assert.equal(staleBoardAudit.ok, false)
  assert.match(staleBoardAudit.issues.join('\n'), /board/iu)

  const rebuilt = rebuildInsightBoards({ root: owned.root, runId: 'fixture' })
  assert.equal(rebuilt.boards, 3)
  assert.match(fs.readFileSync(path.join(prepared.bundleDir, 'boards', 'AI.md'), 'utf8'), /基于 2 条要点/u)
  assert.equal(
    fs.existsSync(path.join(prepared.bundleDir, 'boards.pre-refresh.fixture', 'AI.md')),
    true,
  )

  const canonicalConversationPath = path.join(prepared.bundleDir, 'conv', 'wx_canonical_room_chatroom.json')
  const validConversationText = fs.readFileSync(canonicalConversationPath, 'utf8')
  const missingBaselineConversation = JSON.parse(validConversationText) as InsightConversation
  missingBaselineConversation.nuggets.shift()
  writeJson(canonicalConversationPath, missingBaselineConversation)
  const missingBaselineAudit = auditInsightRefresh({ root: owned.root, bundleDir: prepared.bundleDir })
  assert.equal(missingBaselineAudit.ok, false)
  assert.match(missingBaselineAudit.issues.join('\n'), /baseline/iu)
  fs.writeFileSync(canonicalConversationPath, validConversationText, 'utf8')

  const statePath = path.join(prepared.bundleDir, '_state.json')
  const validStateText = fs.readFileSync(statePath, 'utf8')
  const invalidStates = JSON.parse(validStateText) as InsightState[]
  const cursorState = invalidStates.find((state) => state.analyzedLastMessageUid)
  assert.ok(cursorState)
  cursorState.analyzedLastMessageUid = 'missing-message-uid'
  writeJson(statePath, invalidStates)
  const invalidCursorAudit = auditInsightRefresh({ root: owned.root, bundleDir: prepared.bundleDir })
  assert.equal(invalidCursorAudit.ok, false)
  assert.match(invalidCursorAudit.issues.join('\n'), /cursor/iu)
  fs.writeFileSync(statePath, validStateText, 'utf8')

  const receiptPath = path.join(prepared.bundleDir, 'receipt.json')
  const validReceiptText = fs.readFileSync(receiptPath, 'utf8')
  const invalidReceipt = JSON.parse(validReceiptText) as {
    distillation: { inputRows: number }
  }
  invalidReceipt.distillation.inputRows--
  writeJson(receiptPath, invalidReceipt)
  const invalidClosureAudit = auditInsightRefresh({ root: owned.root, bundleDir: prepared.bundleDir })
  assert.equal(invalidClosureAudit.ok, false)
  assert.match(invalidClosureAudit.issues.join('\n'), /closure/iu)
  fs.writeFileSync(receiptPath, validReceiptText, 'utf8')

  const audit = auditInsightRefresh({ root: owned.root, bundleDir: prepared.bundleDir })
  assert.equal(audit.ok, true)
  assert.deepEqual(audit.metrics, {
    currentConversations: 2,
    manifestConversations: 2,
    insightConversations: 2,
    stateConversations: 2,
    nuggets: 4,
    boards: 3,
  })

  const activated = activateInsightRefresh({ root: owned.root, runId: 'fixture' })
  assert.equal(activated.previousDir, path.join(owned.root, 'data', 'insights.previous.fixture'))
  assert.equal(fs.existsSync(activated.previousDir), true)
  assert.equal(fs.existsSync(path.join(owned.root, 'data', 'insights', 'conv')), true)
  assert.equal(fs.existsSync(path.join(owned.root, 'data', 'insights.next')), false)
  assert.equal(
    readJson(path.join(owned.root, 'data', '.insights-activation.fixture.json')).status,
    'activated',
  )
})

test('refuses to advance when queried text rows do not close against count growth', (t) => {
  const owned = fixture(t)
  const db = new DatabaseSync(owned.dbPath)
  db.prepare('UPDATE conversations SET text_count = text_count + 1 WHERE id = ?').run('wx:canonical:room@chatroom')
  db.close()

  assert.throws(
    () => prepareInsightRefresh({ root: owned.root, runId: 'closure', aliasMapPath: owned.aliasMapPath }),
    /text growth does not close/u,
  )
  assert.equal(fs.existsSync(path.join(owned.root, 'data', 'insights.next')), false)
})

test('binds distillation to the exact database fingerprint captured during prepare', (t) => {
  const owned = fixture(t)
  prepareInsightRefresh({ root: owned.root, runId: 'fingerprint', aliasMapPath: owned.aliasMapPath })
  const db = new DatabaseSync(owned.dbPath)
  db.prepare('UPDATE conversations SET display = ? WHERE id = ?').run('被替换的数据库', 'wx:canonical:room@chatroom')
  db.close()

  assert.throws(
    () => distillInsightRefresh({ root: owned.root, runId: 'fingerprint' }),
    /database fingerprint/u,
  )
})

test('refuses bundle paths outside the data root', (t) => {
  const owned = fixture(t)
  assert.throws(
    () => prepareInsightRefresh({
      root: owned.root,
      runId: 'escape',
      aliasMapPath: owned.aliasMapPath,
      bundleDir: path.join(os.tmpdir(), 'outside-insights.next'),
    }),
    /inside the data root/u,
  )
})

test('refuses a symlinked insight source', (t) => {
  const owned = fixture(t)
  const linkedSource = path.join(owned.root, 'data', 'insights.previous.link')
  try {
    fs.symlinkSync(owned.source, linkedSource, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      t.skip('Directory links are not available in this environment')
      return
    }
    throw error
  }

  assert.throws(
    () => prepareInsightRefresh({
      root: owned.root,
      runId: 'symlink',
      aliasMapPath: owned.aliasMapPath,
      sourceDir: linkedSource,
    }),
    /symlink/u,
  )
})

test('journals activation and restores current when next publication fails', (t) => {
  const owned = fixture(t)
  prepareInsightRefresh({ root: owned.root, runId: 'rollback', aliasMapPath: owned.aliasMapPath })
  distillInsightRefresh({ root: owned.root, runId: 'rollback' })
  rebuildInsightBoards({ root: owned.root, runId: 'rollback' })
  const nextDir = path.join(owned.root, 'data', 'insights.next')

  assert.throws(
    () => activateInsightRefresh({
      root: owned.root,
      runId: 'rollback',
      activationRename(source, target) {
        if (source === nextDir) throw new Error('injected publication failure')
        fs.renameSync(source, target)
      },
    }),
    /restored/u,
  )
  assert.equal(fs.existsSync(path.join(owned.root, 'data', 'insights')), true)
  assert.equal(fs.existsSync(path.join(owned.root, 'data', 'insights.previous.rollback')), false)
  assert.equal(
    readJson(path.join(owned.root, 'data', '.insights-activation.rollback.json')).status,
    'rolled_back',
  )
})
