import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'
import { DatabaseSync } from 'node:sqlite'

import {
  openValidatedArtifactDatabase,
  resolveArtifactDatabasePath,
} from './artifactDatabase.js'

function fixtureRoot(t: TestContext) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chatfiles-artifact-db-'))
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }))
  return projectRoot
}

function createArtifactDatabase(
  projectRoot: string,
  options: { missingColumn?: boolean; runs?: Array<{ runId: string; status: string }> } = {},
) {
  const databasePath = resolveArtifactDatabasePath(projectRoot)
  fs.mkdirSync(path.dirname(databasePath), { recursive: true })
  const db = new DatabaseSync(databasePath)
  const sourceSize = options.missingColumn ? '' : 'source_size INTEGER,'
  db.exec(`
    CREATE TABLE artifacts(
      asset_id TEXT PRIMARY KEY,
      conv_id TEXT,
      message_uid TEXT,
      resource_message_id TEXT,
      resource_id TEXT,
      category TEXT NOT NULL,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      preview TEXT NOT NULL,
      url TEXT,
      source_relative_path TEXT,
      ${sourceSize}
      created_at INTEGER NOT NULL,
      sender_name TEXT NOT NULL,
      text TEXT NOT NULL,
      alignment_status TEXT NOT NULL,
      link_status TEXT NOT NULL,
      link_reason TEXT,
      candidate_message_uids TEXT NOT NULL,
      evidence_kind TEXT NOT NULL,
      evidence_signature TEXT NOT NULL,
      materialization TEXT NOT NULL,
      preview_status TEXT NOT NULL,
      failure_reason TEXT
    );
    CREATE TABLE asset_runs(
      run_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      resources INTEGER NOT NULL,
      exact_alignments INTEGER NOT NULL,
      partial_alignments INTEGER NOT NULL,
      missing_alignments INTEGER NOT NULL,
      conflicting_alignments INTEGER NOT NULL,
      confirmed_links INTEGER NOT NULL,
      unconfirmed_links INTEGER NOT NULL,
      exported INTEGER NOT NULL,
      failed INTEGER NOT NULL,
      voice_attempts INTEGER NOT NULL
    );
  `)
  const insert = db.prepare('INSERT INTO asset_runs VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)')
  for (const run of options.runs ?? [{ runId: 'run-1', status: 'complete' }]) {
    insert.run(run.runId, run.status, '2026-07-12T12:00:00.000Z')
  }
  db.close()
  return databasePath
}

test('uses the current artifact bundle path by default', () => {
  assert.equal(
    resolveArtifactDatabasePath('C:\\project'),
    path.resolve('C:\\project', 'data', 'chat-assets.current', 'artifacts.db'),
  )
})

test('opens a regular validated artifact database read-only', (t) => {
  const projectRoot = fixtureRoot(t)
  createArtifactDatabase(projectRoot)

  const opened = openValidatedArtifactDatabase(projectRoot)
  assert.ok(opened.db)
  assert.equal(opened.code, 'ready')
  assert.throws(() => opened.db?.exec("INSERT INTO asset_runs VALUES ('x','complete','x',0,0,0,0,0,0,0,0,0,0)"))
  opened.db.close()
})

test('rejects missing, non-file, and corrupt artifact database candidates without exposing paths', (t) => {
  const projectRoot = fixtureRoot(t)

  const missing = openValidatedArtifactDatabase(projectRoot)
  assert.deepEqual(missing, { db: null, code: 'unavailable' })

  const databasePath = resolveArtifactDatabasePath(projectRoot)
  fs.mkdirSync(databasePath, { recursive: true })
  const directory = openValidatedArtifactDatabase(projectRoot)
  assert.deepEqual(directory, { db: null, code: 'unavailable' })

  fs.rmSync(databasePath, { recursive: true })
  fs.writeFileSync(databasePath, 'not sqlite', 'utf8')
  const corrupt = openValidatedArtifactDatabase(projectRoot)
  assert.deepEqual(corrupt, { db: null, code: 'unavailable' })
  assert.doesNotMatch(JSON.stringify(corrupt), new RegExp(projectRoot.replaceAll('\\', '\\\\')))
})

test('rejects missing schema columns and any non-unique or incomplete asset run', (t) => {
  const roots = [fixtureRoot(t), fixtureRoot(t), fixtureRoot(t), fixtureRoot(t)]
  createArtifactDatabase(roots[0], { missingColumn: true })
  createArtifactDatabase(roots[1], { runs: [] })
  createArtifactDatabase(roots[2], {
    runs: [{ runId: 'run-1', status: 'complete' }, { runId: 'run-2', status: 'complete' }],
  })
  createArtifactDatabase(roots[3], { runs: [{ runId: 'run-1', status: 'building' }] })

  for (const projectRoot of roots) {
    assert.deepEqual(openValidatedArtifactDatabase(projectRoot), { db: null, code: 'unavailable' })
  }
})
