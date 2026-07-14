import assert from 'node:assert/strict'
import test from 'node:test'

import { createWechatRouter } from './wechat.js'
import type { WechatRouterDependencies } from './wechatRouteHelpers.js'
import { fixture, withServer } from './wechatRouteTestFixtures.js'

test('strictly rejects unsafe legacy message pagination values', async (t) => {
  const fixtureData = fixture(t)
  await withServer(createWechatRouter(fixtureData.dependencies), async (baseUrl) => {
    for (const query of [
      'limit=-1', 'limit=0', 'limit=2001', 'limit=NaN', 'limit=Infinity', 'limit=1.5',
      'offset=-1', 'offset=NaN', 'offset=Infinity', 'offset=1.5',
      `q=${encodeURIComponent('问'.repeat(501))}`,
    ]) {
      const response = await fetch(`${baseUrl}/api/wechat/conversation/conv-a/messages?${query}`)
      assert.equal(response.status, 400, query)
      assert.deepEqual(await response.json(), { error: 'Request failed', code: 'invalid_query' })
    }
  })
})

test('blocks only an oversized legacy artifact archive preview before resolving content', async (t) => {
  const fixtureData = fixture(t)
  const archive = fixtureData.addAsset({
    name: '超大资料.zip', preview: 'archive', relativePath: '超大资料.zip', content: 'small fixture',
  })
  fixtureData.assetDb.prepare('UPDATE artifacts SET source_size=? WHERE asset_id=?')
    .run(512 * 1024 * 1024 + 1, archive)

  await withServer(createWechatRouter(fixtureData.dependencies), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/wechat/artifact/${archive}/archive`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      path: '',
      size: 512 * 1024 * 1024 + 1,
      modified: new Date(0).toISOString(),
      format: '.zip',
      readable: false,
      blockedReason: 'archive_file_too_large',
      entries: [],
      error: '压缩包目录不可读',
    })
  })
})

test('distinguishes an unavailable conversation product from a real empty list', async (t) => {
  const fixtureData = fixture(t)
  const dependencies: WechatRouterDependencies = {
    ...fixtureData.dependencies,
    openWechatDatabase: () => ({ db: null, release() {} }),
  }

  await withServer(createWechatRouter(dependencies), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/wechat/conversations`)
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { error: 'Request failed', code: 'database_unavailable' })
  })
})
