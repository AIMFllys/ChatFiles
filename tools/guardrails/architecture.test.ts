import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'

import {
  EMPTY_ARCHITECTURE_BASELINE,
  inspectArchitecture,
  type ArchitectureBaseline,
} from './architecture.js'

function createFixture(t: TestContext, files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatfiles-architecture-'))
  t.after(() => fs.rmSync(root, { force: true, recursive: true }))

  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(root, relativePath)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content, 'utf8')
  }

  return root
}

test('rejects frontend imports from server while allowing shared contracts', (t) => {
  const root = createFixture(t, {
    'shared/message.ts': 'export interface Message { text: string }\n',
    'server/read.ts': "import type { Message } from '../shared/message.js'\nexport const read = (): Message => ({ text: '好' })\n",
    'src/view.ts': "import { read } from '../server/read.js'\nimport type { Message } from '../shared/message.js'\nexport const view = (message: Message) => read().text + message.text\n",
  })

  const report = inspectArchitecture(root, EMPTY_ARCHITECTURE_BASELINE)
  const dependencyIssues = report.issues.filter((issue) => issue.kind === 'dependency-direction')

  assert.equal(dependencyIssues.length, 1)
  assert.match(dependencyIssues[0]?.message ?? '', /src\/view\.ts/u)
  assert.match(dependencyIssues[0]?.message ?? '', /server\/read\.ts/u)
})

test('resolves layer aliases before enforcing dependency direction', (t) => {
  const root = createFixture(t, {
    'server/read.ts': 'export const read = () => 1\n',
    'src/view.ts': "import { read } from '@server/read.js'\nexport const view = read()\n",
  })

  const issues = inspectArchitecture(root, EMPTY_ARCHITECTURE_BASELINE).issues

  assert.equal(issues.length, 1)
  assert.match(issues[0]?.message ?? '', /src\/view\.ts.*server\/read\.ts/u)
})

test('detects every import edge participating in a cycle', (t) => {
  const root = createFixture(t, {
    'server/a.ts': "import './b.js'\nexport const a = '甲'\n",
    'server/b.ts': "export { c } from './c.js'\nexport const b = '乙'\n",
    'server/c.ts': "import { a } from './a.js'\nexport const c = a\n",
  })

  const report = inspectArchitecture(root, EMPTY_ARCHITECTURE_BASELINE)
  const cycleIssues = report.issues.filter((issue) => issue.kind === 'cycle-edge')

  assert.equal(cycleIssues.length, 3)
  assert.deepEqual(
    cycleIssues.map((issue) => issue.signature),
    [...cycleIssues.map((issue) => issue.signature)].sort(),
  )
})

test('does not reinterpret a stylesheet import as a same-stem TypeScript module', (t) => {
  const root = createFixture(t, {
    'src/App.css': '.app { display: block; }\n',
    'src/App.tsx': "import './App.css'\nexport const App = () => null\n",
  })

  const report = inspectArchitecture(root, EMPTY_ARCHITECTURE_BASELINE)

  assert.deepEqual(report.issues, [])
})

test('an exact baseline suppresses only the matching historical violation', (t) => {
  const root = createFixture(t, {
    'server/legacy.ts': "import { localEnv } from '../scripts/localEnv.js'\nexport const value = localEnv\n",
    'scripts/localEnv.ts': "export const localEnv = '历史债'\n",
  })

  const firstReport = inspectArchitecture(root, EMPTY_ARCHITECTURE_BASELINE)
  const historical = firstReport.issues.find((issue) => issue.kind === 'dependency-direction')
  assert.ok(historical)

  const baseline: ArchitectureBaseline = { allowedIssueSignatures: [historical.signature] }
  assert.deepEqual(inspectArchitecture(root, baseline).issues, [])

  const newImporter = path.join(root, 'src', 'newView.ts')
  fs.mkdirSync(path.dirname(newImporter), { recursive: true })
  fs.writeFileSync(
    newImporter,
    "import { localEnv } from '../scripts/localEnv.js'\nexport const exposed = localEnv\n",
    'utf8',
  )

  const secondReport = inspectArchitecture(root, baseline)
  assert.equal(secondReport.issues.length, 1)
  assert.notEqual(secondReport.issues[0]?.signature, historical.signature)
  assert.match(secondReport.issues[0]?.message ?? '', /src\/newView\.ts/u)
})

test('checks only explicit Git candidate modules when a candidate list is provided', (t) => {
  const root = createFixture(t, {
    'scripts/tmp/local.ts': "import { read } from '../../server/read.js'\nexport const local = read()\n",
    'server/read.ts': 'export const read = () => 1\n',
    'src/view.ts': 'export const view = 1\n',
  })

  const report = inspectArchitecture(
    root,
    EMPTY_ARCHITECTURE_BASELINE,
    ['server/read.ts', 'src/view.ts'],
  )

  assert.deepEqual(report.issues, [])
})
