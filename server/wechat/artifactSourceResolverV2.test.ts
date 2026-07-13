import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { createArtifactSourceResolver } from './artifactSourceResolver.js'

test('preserves normalized unavailable materialization reasons in metadata resolution', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatfiles-v2-source-state-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const accountRoot = path.join(root, 'account')
  fs.mkdirSync(accountRoot)
  const database = new DatabaseSync(':memory:')
  t.after(() => database.close())
  database.exec(`
    CREATE TABLE artifacts(
      asset_id TEXT PRIMARY KEY,conv_id TEXT,category TEXT,kind TEXT,name TEXT,preview TEXT,
      url TEXT,source_relative_path TEXT,source_size INTEGER,created_at INTEGER,sender_name TEXT,
      materialization TEXT,preview_status TEXT,link_status TEXT,association_status TEXT,
      confirmation_status TEXT,association_evidence TEXT,source_presence TEXT,source_content_sha256 TEXT
    );
    INSERT INTO artifacts VALUES
      ('${'b'.repeat(64)}','conv','document','resource','解密失败.dat','image',NULL,NULL,NULL,1,
       '成员','decrypt_failed','unavailable','confirmed','exact','confirmed','lookup_evidence','present',NULL),
      ('${'c'.repeat(64)}','conv','document','resource','来源冲突.pdf','pdf',NULL,NULL,NULL,1,
       '成员','source_ambiguous','unavailable','confirmed','exact','confirmed','lookup_evidence','ambiguous',NULL),
      ('${'d'.repeat(64)}','conv','document','resource','编码不支持.bin','download',NULL,NULL,NULL,1,
       '成员','unsupported_codec','unavailable','confirmed','exact','confirmed','lookup_evidence','present',NULL),
      ('${'e'.repeat(64)}','conv','document','resource','部分关联.pdf','pdf',NULL,NULL,NULL,1,
       '成员','ready','ready','confirmed','partial','confirmed','lookup_evidence','present',NULL),
      ('${'f'.repeat(64)}','conv','document','resource','缺少摘要.pdf','pdf',NULL,'ready.pdf',4,1,
       '成员','ready','ready','confirmed','exact','confirmed','lookup_evidence','present',NULL),
      ('${'1'.repeat(64)}','conv','document','resource','伪旧状态.pdf','pdf',NULL,'ready.pdf',4,1,
       '成员','exported','ready','confirmed','exact','confirmed','lookup_evidence','present',NULL),
      ('${'2'.repeat(64)}','conv','document','resource','缺摘要缩略图.jpg','image',NULL,'ready.pdf',4,1,
       '成员','thumbnail_only','thumbnail_only','confirmed','exact','confirmed','lookup_evidence','present',NULL);
  `)
  fs.writeFileSync(path.join(accountRoot, 'ready.pdf'), 'AAAA', 'utf8')
  const resolver = createArtifactSourceResolver({ assetDb: database, accountRoot })

  assert.equal(resolver.resolve('b'.repeat(64), 'content').state, 'decrypt_failed')
  assert.equal(resolver.resolve('c'.repeat(64), 'content').state, 'source_ambiguous')
  assert.equal(resolver.resolve('d'.repeat(64), 'content').state, 'unsupported_codec')
  assert.equal(resolver.resolve('e'.repeat(64), 'content').status, 'unknown')
  assert.equal(resolver.resolve('f'.repeat(64), 'content').status, 'unavailable')
  assert.equal(resolver.resolve('1'.repeat(64), 'content').status, 'unavailable')
  assert.equal(resolver.resolve('2'.repeat(64), 'thumbnail').status, 'unavailable')
})
