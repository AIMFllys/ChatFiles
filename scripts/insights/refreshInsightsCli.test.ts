import assert from 'node:assert/strict'
import test from 'node:test'
import { parseInsightRefreshArgs } from '../refreshInsights.js'

test('parses explicit insight refresh paths without changing Chinese characters', () => {
  assert.deepEqual(parseInsightRefreshArgs([
    'prepare',
    '--run-id',
    'live-20260712',
    '--source',
    'data/旧洞察',
    '--bundle',
    'data/洞察.next',
    '--db',
    'data/微信.current/wechat.db',
  ]), {
    command: 'prepare',
    runId: 'live-20260712',
    sourceDir: 'data/旧洞察',
    bundleDir: 'data/洞察.next',
    databasePath: 'data/微信.current/wechat.db',
  })
})

test('rejects unknown insight refresh flags', () => {
  assert.throws(() => parseInsightRefreshArgs(['audit', '--force']), /Unknown option/u)
})
