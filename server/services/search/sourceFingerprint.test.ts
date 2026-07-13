import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { wechatSourceFingerprint } from './sourceFingerprint.js'

test('fingerprints legacy message tables that only expose seq identities', () => {
  const db = new DatabaseSync(':memory:')
  test.after(() => db.close())
  db.exec(`
    CREATE TABLE messages(
      conv_id TEXT, seq INTEGER, time INTEGER, sender TEXT, sender_name TEXT, text TEXT
    );
    INSERT INTO messages VALUES('会话一', 7, 123, 'user-1', '张三', '中文🙂');
  `)

  const first = wechatSourceFingerprint(db)
  const second = wechatSourceFingerprint(db)

  assert.match(first, /^[a-f0-9]{64}$/u)
  assert.equal(second, first)
})
