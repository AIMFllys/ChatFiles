import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'

test('renders canonical messages by sequence with bundle-zone seconds and offset', async (t) => {
  const modulePath = './conversationTranscript.js'
  const { readConversationTranscript } = await import(modulePath)
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  db.exec(`
    CREATE TABLE conversations(id TEXT,display TEXT,is_group INTEGER,msg_count INTEGER);
    CREATE TABLE parse_runs(run_id TEXT,time_zone TEXT);
    CREATE TABLE messages(
      conv_id TEXT,message_uid TEXT,canonical_seq INTEGER,occurred_at_epoch_s INTEGER,
      time INTEGER,sender_name TEXT,sender TEXT,type INTEGER,type_label TEXT,text TEXT
    );
    INSERT INTO conversations VALUES('conv','中文会话',1,3);
    INSERT INTO parse_runs VALUES('run-v2','Asia/Shanghai');
    INSERT INTO messages VALUES
      ('conv','uid-z',0,1700000000,1700000000,'张三','u-a',1,'text','第一条'),
      ('conv','uid-a',2,1700000000,1700000000,'王五','u-c',3,'image',''),
      ('conv','uid-m',1,1700000000,1700000000,'李四','u-b',1,'text','第二条');
  `)

  const transcript = readConversationTranscript(db, { conversationId: 'conv', maxCharacters: 10_000 })

  assert.ok(transcript)
  assert.equal(transcript.timeZone, 'Asia/Shanghai')
  assert.match(transcript.text, /^\[2023-11-15 06:13:20 \+08:00\] 张三: 第一条/mu)
  assert.ok(transcript.text.indexOf('张三: 第一条') < transcript.text.indexOf('李四: 第二条'))
  assert.ok(transcript.text.indexOf('李四: 第二条') < transcript.text.indexOf('王五: [image]'))
  assert.equal(transcript.text.includes('.000'), false)
})

test('keeps explicit legacy ordering compatibility without truncating timestamps to minutes', async (t) => {
  const modulePath = './conversationTranscript.js'
  const { readConversationTranscript } = await import(modulePath)
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  db.exec(`
    CREATE TABLE conversations(id TEXT,display TEXT,is_group INTEGER,msg_count INTEGER);
    CREATE TABLE messages(
      conv_id TEXT,seq INTEGER,time INTEGER,sender_name TEXT,sender TEXT,
      type INTEGER,type_label TEXT,text TEXT
    );
    INSERT INTO conversations VALUES('legacy','旧会话',0,2);
    INSERT INTO messages VALUES
      ('legacy',2,1700000001,'乙','u-b',1,'text','后'),
      ('legacy',1,1700000000,'甲','u-a',1,'text','前');
  `)

  const transcript = readConversationTranscript(db, { conversationId: 'legacy', maxCharacters: 10_000 })

  assert.equal(transcript?.timeZone, 'Asia/Shanghai')
  assert.match(transcript?.text ?? '', /\[2023-11-15 06:13:20 \+08:00\] 甲: 前/u)
  assert.match(transcript?.text ?? '', /\[2023-11-15 06:13:21 \+08:00\] 乙: 后/u)
})
