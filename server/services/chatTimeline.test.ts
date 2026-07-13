import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'

function timelineFixture() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE conversations(
      id TEXT PRIMARY KEY, display TEXT, is_group INTEGER, msg_count INTEGER,
      text_count INTEGER, first_time INTEGER, last_time INTEGER
    );
    CREATE TABLE messages(
      conv_id TEXT, message_uid TEXT PRIMARY KEY, seq INTEGER, time INTEGER,
      sender TEXT, sender_name TEXT, type INTEGER, type_label TEXT, text TEXT
    );
    INSERT INTO conversations VALUES ('conv-a','测试会话',1,5,5,100,300);
    INSERT INTO messages VALUES
      ('conv-a','m-1',1,100,'u-1','张三',1,'文本','中文🙂'),
      ('conv-a','m-2',2,100,'u-2','李四',1,'文本','进度 100%_完成\\路径'),
      ('conv-a','m-3',3,200,'u-1','张三',1,'文本','第三条'),
      ('conv-a','m-4',4,300,'u-2','李四',1,'文本','第四条'),
      ('conv-a','m-5',5,300,'u-1','张三',1,'文本','第五条');
  `)
  return db
}

test('pages a timeline with stable time and message UID cursors', async () => {
  const modulePath = path.resolve(process.cwd(), 'server/services/chatTimeline.ts')
  assert.equal(fs.existsSync(modulePath), true)
  if (!fs.existsSync(modulePath)) return
  const timeline = await import('./chatTimeline.js')
  const db = timelineFixture()
  try {
    const before = timeline.queryTimeline(db, {
      conversationId: 'conv-a',
      limit: 2,
      before: timeline.encodeTimelineCursor({ time: 200, messageUid: 'm-3' }),
    })
    assert.deepEqual(before.messages.map((message: { message_uid: string }) => message.message_uid), ['m-1', 'm-2'])
    assert.equal(before.messages[0].text, '中文🙂')

    const after = timeline.queryTimeline(db, {
      conversationId: 'conv-a',
      limit: 2,
      after: timeline.encodeTimelineCursor({ time: 100, messageUid: 'm-2' }),
    })
    assert.deepEqual(after.messages.map((message: { message_uid: string }) => message.message_uid), ['m-3', 'm-4'])

    const latest = timeline.queryTimeline(db, { conversationId: 'conv-a', limit: 2 })
    assert.deepEqual(latest.messages.map((message: { message_uid: string }) => message.message_uid), ['m-4', 'm-5'])
    assert.ok(latest.pageInfo.olderCursor)
    assert.equal(latest.pageInfo.hasOlder, true)
    assert.equal(latest.pageInfo.hasNewer, false)
  } finally {
    db.close()
  }
})

test('filters senders and treats wildcard search characters literally', async () => {
  const modulePath = path.resolve(process.cwd(), 'server/services/chatTimeline.ts')
  assert.equal(fs.existsSync(modulePath), true)
  if (!fs.existsSync(modulePath)) return
  const timeline = await import('./chatTimeline.js')
  const db = timelineFixture()
  try {
    const sender = timeline.queryTimeline(db, { conversationId: 'conv-a', limit: 120, sender: 'u-1' })
    assert.deepEqual(sender.messages.map((message: { sender: string }) => message.sender), ['u-1', 'u-1', 'u-1'])
    assert.equal(sender.participants.find((person: { id: string }) => person.id === 'u-1')?.messageCount, 3)

    const searched = timeline.queryTimeline(db, { conversationId: 'conv-a', limit: 120, query: '%_完成\\' })
    assert.deepEqual(searched.messages.map((message: { message_uid: string }) => message.message_uid), ['m-2'])
    assert.equal(searched.messages[0].text, '进度 100%_完成\\路径')
  } finally {
    db.close()
  }
})

test('loads a bounded page around an anchor and rejects malformed cursors', async () => {
  const modulePath = path.resolve(process.cwd(), 'server/services/chatTimeline.ts')
  assert.equal(fs.existsSync(modulePath), true)
  if (!fs.existsSync(modulePath)) return
  const timeline = await import('./chatTimeline.js')
  const db = timelineFixture()
  try {
    assert.equal(timeline.decodeTimelineCursor('not-a-cursor'), null)
    const around = timeline.queryTimeline(db, {
      conversationId: 'conv-a',
      limit: 3,
      around: timeline.encodeTimelineCursor({ time: 200, messageUid: 'm-3' }),
    })
    assert.deepEqual(around.messages.map((message: { message_uid: string }) => message.message_uid), ['m-2', 'm-3', 'm-4'])
    assert.equal(timeline.queryTimeline(db, { conversationId: 'conv-a', limit: 1000 }).limit, 240)
    assert.equal(around.buckets.reduce((sum: number, bucket: { messageCount: number }) => sum + bucket.messageCount, 0), 5)
  } finally {
    db.close()
  }
})
