import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const source = fs.readFileSync(path.resolve(process.cwd(), 'server/services/localAccessRuntime.ts'), 'utf8')

test('binds derived search health and queries to the active WeChat product fingerprint', () => {
  assert.match(source, /const active = readActiveProductSet\(projectRoot\)/u)
  assert.match(source, /inspectSearchIndexStatus\([\s\S]*active\.status\.products\.wechat\.fingerprint/u)
  assert.match(source, /sourceFingerprint:\s*fingerprint/u)
  assert.doesNotMatch(source, /sourceFileIdentity|wechatSourceFingerprint|state:\s*'unavailable'/u)
})
