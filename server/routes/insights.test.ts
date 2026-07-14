import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

test('reads every overview product from one active catalog snapshot', () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), 'server/routes/insights.ts'), 'utf8')
  assert.match(source, /readCatalogLibrary\(active\)/u)
  assert.doesNotMatch(source, /library\(projectRoot\)/u)
})
