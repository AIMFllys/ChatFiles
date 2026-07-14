import assert from 'node:assert/strict'
import test from 'node:test'

import type { ArtifactSourceAsset, ArtifactSourceResolver } from '../../wechat/artifactSourceResolver.js'
import { createArtifactFileProvider } from './artifactFileProvider.js'

const asset: ArtifactSourceAsset = {
  id: 'a'.repeat(64), conversationId: 'conv-a', category: 'document', kind: 'resource',
  name: '中文资料.zip', preview: 'archive', url: null, createdAt: 1, senderName: '张三', size: 12,
  materialization: 'ready', previewStatus: 'ready', associationStatus: 'exact',
  associationEvidence: 'fixture', sourcePresence: 'present',
}

test('derives artifact capabilities from resolver evidence and opens by operation purpose', async () => {
  const purposes: string[] = []
  const descriptions: string[] = []
  const resolver: ArtifactSourceResolver = {
    describe(id) {
      descriptions.push(id)
      return id === asset.id ? { status: 'known', asset } : { status: 'unknown' }
    },
    resolve(id, purpose) {
      purposes.push(purpose)
      if (id !== asset.id) return { status: 'unknown' }
      if (purpose === 'thumbnail') return { status: 'unavailable', state: 'source_missing', asset }
      return { status: 'available', state: 'ready', asset, target: 'C:\\private\\资料.zip' }
    },
  }
  const provider = createArtifactFileProvider(resolver)
  const described = await provider.describe(asset.id)
  assert.deepEqual(described?.artifactCapabilities, ['content', 'inspect', 'archive'])
  assert.equal((await provider.open(asset.id, 'archivePreview')).status, 'available')
  assert.equal((await provider.open(asset.id, 'thumbnail')).status, 'unavailable')
  assert.deepEqual(descriptions, [asset.id])
  assert.deepEqual(purposes, ['content', 'thumbnail'])
})

test('keeps malformed and unknown artifact IDs distinct', async () => {
  const resolver: ArtifactSourceResolver = {
    describe(id) { return id === 'bad' ? { status: 'malformed' } : { status: 'unknown' } },
    resolve(id) { return id === 'bad' ? { status: 'malformed' } : { status: 'unknown' } },
  }
  const provider = createArtifactFileProvider(resolver)
  assert.equal(await provider.describe('bad'), null)
  assert.equal((await provider.open('bad', 'content')).status, 'invalid')
  assert.equal((await provider.open('b'.repeat(64), 'content')).status, 'not_found')
})
