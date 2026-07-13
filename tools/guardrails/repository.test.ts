import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'

import {
  EMPTY_REPOSITORY_BASELINE,
  inspectPrivacyPaths,
  inspectSourceSizes,
  inspectUtf8Files,
  listGitCandidateFiles,
  type RepositoryBaseline,
} from './repository.js'

function createFixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatfiles-repository-'))
  t.after(() => fs.rmSync(root, { force: true, recursive: true }))
  return root
}

function writeFixture(root: string, relativePath: string, content: string | Buffer) {
  const target = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}

function lines(count: number) {
  return `${Array.from({ length: count }, (_, index) => `export const line${index} = ${index}`).join('\n')}\n`
}

test('allows 300 lines and rejects a new 301-line source file', (t) => {
  const root = createFixture(t)
  writeFixture(root, 'src/exact.ts', lines(300))
  writeFixture(root, 'src/oversized.ts', lines(301))

  const issues = inspectSourceSizes(
    root,
    ['src/exact.ts', 'src/oversized.ts'],
    EMPTY_REPOSITORY_BASELINE,
  )

  assert.equal(issues.length, 1)
  assert.match(issues[0]?.message ?? '', /src\/oversized\.ts.*301/u)
})

test('an oversized baseline is a per-file ceiling and never a blanket exemption', (t) => {
  const root = createFixture(t)
  writeFixture(root, 'tools/legacy.c', lines(333))
  const baseline: RepositoryBaseline = {
    allowedReplacementSignatures: [],
    oversizedLineCaps: { 'tools/legacy.c': 333 },
  }

  assert.deepEqual(inspectSourceSizes(root, ['tools/legacy.c'], baseline), [])

  writeFixture(root, 'tools/legacy.c', lines(334))
  const issues = inspectSourceSizes(root, ['tools/legacy.c'], baseline)
  assert.equal(issues.length, 1)
  assert.match(issues[0]?.message ?? '', /baseline ceiling 333/u)
})

test('accepts strict UTF-8 Chinese and rejects malformed byte sequences without leaking content', (t) => {
  const root = createFixture(t)
  writeFixture(root, 'docs/中文.md', '# 中文与 emoji 😀\n')
  writeFixture(root, 'src/broken.ts', Buffer.from([0x65, 0x78, 0x70, 0x6f, 0x72, 0x74, 0xff]))

  const issues = inspectUtf8Files(
    root,
    ['docs/中文.md', 'src/broken.ts'],
    EMPTY_REPOSITORY_BASELINE,
  )

  assert.equal(issues.length, 1)
  assert.equal(issues[0]?.kind, 'invalid-utf8')
  assert.match(issues[0]?.message ?? '', /src\/broken\.ts/u)
  assert.doesNotMatch(issues[0]?.message ?? '', /export/u)
})

test('replacement-character baseline is occurrence-exact and does not hide a new occurrence', (t) => {
  const root = createFixture(t)
  const replacement = String.fromCodePoint(0xfffd)
  writeFixture(root, 'scripts/audit.test.ts', `export const fixture = '损坏${replacement}'\n`)

  const first = inspectUtf8Files(root, ['scripts/audit.test.ts'], EMPTY_REPOSITORY_BASELINE)
  assert.equal(first.length, 1)
  assert.equal(first[0]?.kind, 'replacement-character')

  const baseline: RepositoryBaseline = {
    allowedReplacementSignatures: [first[0]!.signature],
    oversizedLineCaps: {},
  }
  assert.deepEqual(inspectUtf8Files(root, ['scripts/audit.test.ts'], baseline), [])

  writeFixture(
    root,
    'scripts/audit.test.ts',
    `export const fixture = '损坏${replacement}'\nexport const added = '新增${replacement}'\n`,
  )
  const second = inspectUtf8Files(root, ['scripts/audit.test.ts'], baseline)
  assert.equal(second.length, 1)
  assert.match(second[0]?.signature ?? '', /:2:/u)
})

test('privacy guard rejects tracked private paths while allowing public templates', () => {
  const issues = inspectPrivacyPaths([
    '.env.example',
    'docs/database-boundaries.md',
    'src/安全说明.ts',
    '.env.local',
    'data/wechat.db',
    'keys/private.pem',
    'tools/debug.exe',
  ])

  assert.deepEqual(
    issues.map((issue) => issue.path),
    ['.env.local', 'data/wechat.db', 'keys/private.pem', 'tools/debug.exe'],
  )
})

test('git candidate discovery includes tracked private files and untracked non-ignored files', (t) => {
  const root = createFixture(t)
  execFileSync('git', ['init', '--quiet'], { cwd: root })
  writeFixture(root, '.gitignore', 'data/\n')
  writeFixture(root, 'data/聊天.db', 'private')
  writeFixture(root, 'src/新增.ts', 'export const value = 1\n')
  execFileSync('git', ['add', '-f', 'data/聊天.db'], { cwd: root })

  assert.deepEqual(listGitCandidateFiles(root), ['.gitignore', 'data/聊天.db', 'src/新增.ts'])
})

test('content checks skip a candidate deleted from the working tree', (t) => {
  const root = createFixture(t)
  const deleted = ['src/deleted.ts']

  assert.deepEqual(inspectSourceSizes(root, deleted, EMPTY_REPOSITORY_BASELINE), [])
  assert.deepEqual(inspectUtf8Files(root, deleted, EMPTY_REPOSITORY_BASELINE), [])
})
