import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createAssetEvidenceState,
  type AssetMaterializationStatus,
  type AssetPreviewStatus,
} from './assetEvidence.js'
test('keeps materialization evidence separate from browser preview capability', () => {
  assert.deepEqual(createAssetEvidenceState(
    'exported',
    'unsupported_codec',
    '浏览器不支持 SILK 编码',
  ), {
    materialization: 'exported',
    preview: 'unsupported_codec',
    reason: '浏览器不支持 SILK 编码',
  })
  assert.deepEqual(createAssetEvidenceState('thumbnail_only', 'thumbnail_only'), {
    materialization: 'thumbnail_only',
    preview: 'thumbnail_only',
  })
})
test('models every required failure status on the appropriate evidence axis', () => {
  const failurePairs = [
    ['missing_source', 'missing_source'],
    ['decrypt_failed', 'decrypt_failed'],
    ['source_ambiguous', 'source_ambiguous'],
    ['hash_mismatch', 'hash_mismatch'],
    ['exported', 'unsupported_codec'],
  ] as const satisfies readonly (readonly [AssetMaterializationStatus, AssetPreviewStatus])[]

  for (const [materialization, preview] of failurePairs) {
    assert.deepEqual(createAssetEvidenceState(materialization, preview, `原因：${preview}`), {
      materialization,
      preview,
      reason: `原因：${preview}`,
    })
  }
})

test('requires a nonempty reason for every export or preview failure state', () => {
  const failurePairs = [
    ['missing_source', 'missing_source'],
    ['decrypt_failed', 'decrypt_failed'],
    ['source_ambiguous', 'source_ambiguous'],
    ['hash_mismatch', 'hash_mismatch'],
    ['exported', 'unsupported_codec'],
  ] as const satisfies readonly (readonly [AssetMaterializationStatus, AssetPreviewStatus])[]

  for (const [materialization, preview] of failurePairs) {
    assert.throws(
      () => createAssetEvidenceState(materialization, preview),
      new RegExp(`A nonempty reason is required for ${preview}`),
    )
    assert.throws(
      () => createAssetEvidenceState(materialization, preview, '   '),
      new RegExp(`A nonempty reason is required for ${preview}`),
    )
  }
})

test('keeps successful and capability-only states free of failure reasons', () => {
  const successPairs = [
    ['exported', 'ready'],
    ['exported', 'unavailable'],
    ['thumbnail_only', 'thumbnail_only'],
  ] as const satisfies readonly (readonly [AssetMaterializationStatus, AssetPreviewStatus])[]

  for (const [materialization, preview] of successPairs) {
    assert.equal('reason' in createAssetEvidenceState(materialization, preview), false)
    assert.throws(
      () => createAssetEvidenceState(materialization, preview, '不应存在的原因'),
      new RegExp(`A reason is not allowed for ${materialization}/${preview}`),
    )
  }
})

test('rejects impossible materialization and preview status combinations', () => {
  const invalidPairs = [
    ['missing_source', 'ready'],
    ['exported', 'decrypt_failed'],
    ['thumbnail_only', 'unavailable'],
    ['hash_mismatch', 'unsupported_codec'],
  ] as const satisfies readonly (readonly [AssetMaterializationStatus, AssetPreviewStatus])[]

  for (const [materialization, preview] of invalidPairs) {
    assert.throws(
      () => createAssetEvidenceState(materialization, preview),
      new RegExp(`Invalid asset evidence state: ${materialization} cannot use ${preview}`),
    )
  }
})

test('accepts every supported successful or degraded preview combination', () => {
  const validPairs = [
    ['exported', 'ready', undefined],
    ['exported', 'unavailable', undefined],
    ['exported', 'unsupported_codec', '不支持的编码'],
    ['thumbnail_only', 'thumbnail_only', undefined],
    ['missing_source', 'missing_source', '源文件不存在'],
    ['decrypt_failed', 'decrypt_failed', '解密失败'],
    ['source_ambiguous', 'source_ambiguous', '存在多个候选源'],
    ['hash_mismatch', 'hash_mismatch', '资源哈希不匹配'],
  ] as const satisfies readonly (readonly [
    AssetMaterializationStatus,
    AssetPreviewStatus,
    string | undefined,
  ])[]

  for (const [materialization, preview, reason] of validPairs) {
    const state = createAssetEvidenceState(materialization, preview, reason)
    assert.equal(state.materialization, materialization)
    assert.equal(state.preview, preview)
    assert.equal('reason' in state ? state.reason : undefined, reason)
  }
})
