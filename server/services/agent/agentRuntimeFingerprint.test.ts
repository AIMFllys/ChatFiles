import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const source = fs.readFileSync(
  path.resolve(process.cwd(), 'server/services/agent/agentRuntime.ts'),'utf8',
)

test('uses one active WeChat product fingerprint for agent queries and index rebuilds', () => {
  assert.doesNotMatch(source, /sourceFileIdentity|wechatSourceFingerprint/u)
  assert.match(source, /active\.status\.products\.wechat\.fingerprint/u)
  assert.match(source, /opened\.active\.status\.products\.wechat\.fingerprint/u)
  assert.match(source, /sourceFingerprint[,}]/u)
})
