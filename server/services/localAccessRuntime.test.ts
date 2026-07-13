import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const source = fs.readFileSync(path.resolve(process.cwd(), 'server/services/localAccessRuntime.ts'), 'utf8')

test('validates a derived search index with the same source file identity used by rebuilds', () => {
  assert.match(source, /sourceFileIdentity\(wechat\.resolution\.selectedPath\)/u)
  assert.match(source, /wechatSourceFingerprint\(wechat\.db,\s*sourceFileIdentity/u)
})
