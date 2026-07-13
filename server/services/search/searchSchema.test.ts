import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import {
  activateSearchIndex,
  createSearchSchema,
  readSearchMetadata,
  validateSearchMetadata,
} from './searchSchema.js'

test('creates a versioned FTS5 schema with a source and embedding fingerprint', () => {
  const db = new DatabaseSync(':memory:')
  createSearchSchema(db, {
    sourceFingerprint: 'source-v1',
    embeddingModel: 'fixture-embedding',
    embeddingDimensions: 3,
  })
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name")
    .all().map((row) => (row as { name: string }).name)
  assert.ok(tables.includes('search_chunks'))
  assert.ok(tables.includes('search_chunks_fts'))
  assert.ok(tables.includes('search_vectors'))
  assert.deepEqual(readSearchMetadata(db), {
    schemaVersion: 1, sourceFingerprint: 'source-v1', chunkCount: 0,
    embeddingModel: 'fixture-embedding', embeddingDimensions: 3,
  })
  assert.deepEqual(validateSearchMetadata(db, {
    sourceFingerprint: 'source-v1', embeddingModel: 'fixture-embedding', embeddingDimensions: 3,
  }), { ok: true })
  assert.deepEqual(validateSearchMetadata(db, {
    sourceFingerprint: 'source-v1', embeddingModel: 'different', embeddingDimensions: 3,
  }), { ok: false, code: 'embedding_mismatch' })
  db.close()
})

test('activates a same-directory staging index without leaving stale bytes', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatfiles-search-schema-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const current = path.join(root, 'ai-index.current.db')
  const staging = path.join(root, 'ai-index.staging.db')
  fs.writeFileSync(current, 'old', 'utf8')
  fs.writeFileSync(staging, 'new', 'utf8')
  activateSearchIndex(staging, current)
  assert.equal(fs.readFileSync(current, 'utf8'), 'new')
  assert.equal(fs.existsSync(staging), false)
  const outside = path.join(os.tmpdir(), `outside-${process.pid}.db`)
  fs.writeFileSync(outside, 'outside', 'utf8')
  t.after(() => fs.rmSync(outside, { force: true }))
  assert.throws(() => activateSearchIndex(outside, current), /staging_directory_mismatch/u)
})
