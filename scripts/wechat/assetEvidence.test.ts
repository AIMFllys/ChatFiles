import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CANONICAL_MESSAGE_PRIMARY_KEY,
  RESOURCE_EVIDENCE_SIGNATURE_FIELDS,
  RESOURCE_LOCATOR_FIELDS,
  RESOURCE_MESSAGE_PRIMARY_KEY,
  alignResourceMessage,
  classifyArtifactCategory,
  createAssetEvidenceState,
  createAssetId,
  createResourceEvidenceSignature,
  evaluateResourceLinkEvidence,
  extractStructuredUrls,
  isIncludedInAll,
  relativePathWithinRoot,
  type AssetMaterializationStatus,
  type AssetPreviewStatus,
  type CanonicalMessage,
  type ResourceEvidenceSignatureInput,
  type ResourceMessageProbe,
} from './assetEvidence.js'

const exactMessage: CanonicalMessage = {
  message_uid: 'wxm:canonical-message-42',
  source_db: 'message_0.db',
  chat_table: 'Chat_2f10',
  message_table: 'Msg_2f10',
  local_id: 42,
  normalized_type: 49,
  raw_type: '25769803825',
  create_time: 1_720_000_000,
  server_id: 'server-9001',
  message_origin_source: 2,
}

const exactProbe: ResourceMessageProbe = {
  message_id: 'resource-message-7',
  chat_table: exactMessage.chat_table,
  message_table: exactMessage.message_table,
  local_id: exactMessage.local_id,
  normalized_type: exactMessage.normalized_type,
  raw_type: exactMessage.raw_type,
  create_time: exactMessage.create_time,
  server_id: exactMessage.server_id,
  message_origin_source: exactMessage.message_origin_source,
}

test('keeps resource message_id separate from canonical message_uid and requires raw_type', () => {
  assert.equal(RESOURCE_MESSAGE_PRIMARY_KEY, 'message_id')
  assert.equal(CANONICAL_MESSAGE_PRIMARY_KEY, 'message_uid')
  assert.deepEqual(RESOURCE_LOCATOR_FIELDS, [
    'chat_table',
    'message_table',
    'local_id',
    'normalized_type',
    'raw_type',
    'create_time',
    'server_id',
    'message_origin_source',
  ])

  const result = alignResourceMessage(exactProbe, [exactMessage])

  assert.deepEqual(result, {
    status: 'exact',
    resource_message_id: 'resource-message-7',
    message_uid: 'wxm:canonical-message-42',
    candidate_message_uids: ['wxm:canonical-message-42'],
    matched_fields: [...RESOURCE_LOCATOR_FIELDS],
    missing_fields: [],
    conflicting_fields: [],
  })
})

test('returns partial only for one uniquely matching incomplete locator', () => {
  const partialLocator = {
    ...exactProbe,
    create_time: undefined,
    server_id: undefined,
  }

  const result = alignResourceMessage(partialLocator, [exactMessage])

  assert.equal(result.status, 'partial')
  assert.equal(result.message_uid, 'wxm:canonical-message-42')
  assert.deepEqual(result.candidate_message_uids, ['wxm:canonical-message-42'])
  assert.deepEqual(result.missing_fields, ['create_time', 'server_id'])
  assert.deepEqual(result.conflicting_fields, [])
})

test('returns missing when no canonical message matches the locator', () => {
  const result = alignResourceMessage({
    message_id: 'resource-message-missing',
    chat_table: 'Chat_missing',
    message_table: 'Msg_missing',
    local_id: 404,
  }, [exactMessage])

  assert.deepEqual(result, {
    status: 'missing',
    resource_message_id: 'resource-message-missing',
    message_uid: null,
    candidate_message_uids: [],
    matched_fields: [],
    missing_fields: [
      'normalized_type',
      'raw_type',
      'create_time',
      'server_id',
      'message_origin_source',
    ],
    conflicting_fields: [],
  })
})

test('does not treat server_id zero as a strong locator', () => {
  const zeroServerMessage: CanonicalMessage = {
    ...exactMessage,
    server_id: '0',
  }

  const result = alignResourceMessage({
    message_id: 'resource-message-zero-server',
    server_id: '0',
    message_origin_source: zeroServerMessage.message_origin_source,
  }, [zeroServerMessage])

  assert.equal(result.status, 'missing')
  assert.equal(result.message_uid, null)
  assert.deepEqual(result.candidate_message_uids, [])
})

test('does not confirm a unique candidate from weak fields alone', () => {
  const result = alignResourceMessage({
    message_id: 'resource-message-weak-only',
    normalized_type: exactMessage.normalized_type,
    raw_type: exactMessage.raw_type,
    create_time: exactMessage.create_time,
  }, [exactMessage])

  assert.equal(result.status, 'missing')
  assert.equal(result.message_uid, null)
  assert.deepEqual(result.candidate_message_uids, [])
})

test('uses canonical message_uid only when it is explicitly supplied', () => {
  const coincidentalResourceId = alignResourceMessage({
    message_id: exactMessage.message_uid,
  }, [exactMessage])
  assert.equal(coincidentalResourceId.status, 'missing')

  const explicitCanonicalUid = alignResourceMessage({
    message_id: 'resource-message-by-uid',
    message_uid: exactMessage.message_uid,
  }, [exactMessage])
  assert.equal(explicitCanonicalUid.status, 'partial')
  assert.equal(explicitCanonicalUid.resource_message_id, 'resource-message-by-uid')
  assert.equal(explicitCanonicalUid.message_uid, exactMessage.message_uid)
  assert.deepEqual(explicitCanonicalUid.matched_fields, ['message_uid'])
})

test('does not guess when one complete locator maps to more than one message_uid', () => {
  const duplicateLocator: CanonicalMessage = {
    ...exactMessage,
    message_uid: 'wxm:canonical-message-duplicate',
    source_db: 'message_1.db',
  }

  const result = alignResourceMessage(exactProbe, [
    exactMessage,
    duplicateLocator,
  ])

  assert.equal(result.status, 'conflict')
  assert.equal(result.message_uid, null)
  assert.deepEqual(result.candidate_message_uids, [
    'wxm:canonical-message-42',
    'wxm:canonical-message-duplicate',
  ])
  assert.deepEqual(result.conflicting_fields, ['message_uid'])
})

test('sorts unique candidate message UIDs independently of input permutation', () => {
  const alpha = { ...exactMessage, message_uid: 'wxm:alpha', source_db: 'message_0.db' }
  const middle = { ...exactMessage, message_uid: 'wxm:middle', source_db: 'message_1.db' }
  const zeta = { ...exactMessage, message_uid: 'wxm:zeta', source_db: 'message_2.db' }

  const first = alignResourceMessage(exactProbe, [zeta, alpha, middle])
  const second = alignResourceMessage(exactProbe, [middle, zeta, alpha])

  assert.deepEqual(first.candidate_message_uids, ['wxm:alpha', 'wxm:middle', 'wxm:zeta'])
  assert.deepEqual(second.candidate_message_uids, first.candidate_message_uids)
})

test('preserves duplicate row occurrences as one-to-many evidence even for the same object reference', () => {
  const result = alignResourceMessage(exactProbe, [
    exactMessage,
    exactMessage,
  ])

  assert.equal(result.status, 'conflict')
  assert.equal(result.message_uid, null)
  assert.deepEqual(result.candidate_message_uids, ['wxm:canonical-message-42'])
  assert.deepEqual(result.conflicting_fields, ['message_uid'])
})

test('distinguishes high 64-bit app subtypes that share the same normalized type', () => {
  const result = alignResourceMessage({
    ...exactProbe,
    raw_type: '34359738417',
  }, [exactMessage])

  assert.deepEqual(result, {
    status: 'conflict',
    resource_message_id: 'resource-message-7',
    message_uid: null,
    candidate_message_uids: ['wxm:canonical-message-42'],
    matched_fields: [
      'chat_table',
      'message_table',
      'local_id',
      'normalized_type',
      'create_time',
      'server_id',
      'message_origin_source',
    ],
    missing_fields: [],
    conflicting_fields: ['raw_type'],
  })
})

test('reports every conflicting locator field instead of accepting a positional near-match', () => {
  const result = alignResourceMessage({
    ...exactProbe,
    normalized_type: 43,
    raw_type: '43',
    create_time: exactMessage.create_time + 1,
  }, [exactMessage])

  assert.equal(result.status, 'conflict')
  assert.deepEqual(result.conflicting_fields, ['normalized_type', 'raw_type', 'create_time'])
})

test('reports conflict when independent strong locators point at different messages', () => {
  const otherMessage: CanonicalMessage = {
    ...exactMessage,
    message_uid: 'wxm:canonical-message-99',
    source_db: 'message_1.db',
    local_id: 99,
    server_id: 'server-other',
  }

  const result = alignResourceMessage({
    ...exactProbe,
    message_uid: exactMessage.message_uid,
    local_id: otherMessage.local_id,
    server_id: otherMessage.server_id,
  }, [exactMessage, otherMessage])

  assert.equal(result.status, 'conflict')
  assert.equal(result.message_uid, null)
  assert.deepEqual(result.candidate_message_uids, [
    'wxm:canonical-message-42',
    'wxm:canonical-message-99',
  ])
  assert.deepEqual(result.conflicting_fields, [
    'message_uid',
    'local_id',
    'server_id',
  ])
})

test('treats duplicate message_uid rows as a primary-key conflict', () => {
  const conflictingDuplicate: CanonicalMessage = {
    ...exactMessage,
    normalized_type: 43,
    raw_type: '43',
  }

  const result = alignResourceMessage({
    message_id: 'resource-message-duplicate-uid',
    message_uid: exactMessage.message_uid,
  }, [
    exactMessage,
    conflictingDuplicate,
  ])

  assert.equal(result.status, 'conflict')
  assert.equal(result.message_uid, null)
  assert.deepEqual(result.candidate_message_uids, ['wxm:canonical-message-42'])
  assert.deepEqual(result.conflicting_fields, ['message_uid', 'normalized_type', 'raw_type'])
})

test('does not let a positional match override a conflicting message_uid', () => {
  const result = alignResourceMessage({
    ...exactProbe,
    message_uid: 'wxm:canonical-message-stale',
  }, [exactMessage])

  assert.equal(result.status, 'conflict')
  assert.equal(result.message_uid, null)
  assert.deepEqual(result.candidate_message_uids, ['wxm:canonical-message-42'])
  assert.deepEqual(result.conflicting_fields, ['message_uid'])
})

test('does not use message_origin_source to choose a canonical shard', () => {
  const otherShardMessage: CanonicalMessage = {
    ...exactMessage,
    message_uid: 'wxm:canonical-message-other-shard',
    source_db: 'message_1.db',
    message_origin_source: 1,
  }

  const result = alignResourceMessage({
    ...exactProbe,
    message_origin_source: 1,
  }, [exactMessage, otherShardMessage])

  assert.equal(result.status, 'conflict')
  assert.equal(result.message_uid, null)
  assert.deepEqual(result.candidate_message_uids, [
    'wxm:canonical-message-42',
    'wxm:canonical-message-other-shard',
  ])
  assert.deepEqual(result.conflicting_fields, ['message_uid', 'message_origin_source'])
})

test('confirms a resource link only with exact message, chat, and hash evidence', () => {
  const result = evaluateResourceLinkEvidence({
    alignment: alignResourceMessage(exactProbe, [exactMessage]),
    canonical_chat_scope: 'chat:project-room',
    resource_chat_scope: 'chat:project-room',
    message_resource_hash: 'sha256:resource-content',
    candidate_resource_hash: 'sha256:resource-content',
  })

  assert.deepEqual(result, {
    status: 'confirmed',
    message_uid: exactMessage.message_uid,
    evidence: 'resource_hash',
    reason: null,
  })
})

test('accepts an exact application XML file identifier as stable link evidence', () => {
  const result = evaluateResourceLinkEvidence({
    alignment: alignResourceMessage(exactProbe, [exactMessage]),
    canonical_chat_scope: 'chat:project-room',
    resource_chat_scope: 'chat:project-room',
    message_xml_file_identifier: 'xml-file-id:42',
    candidate_xml_file_identifier: 'xml-file-id:42',
  })

  assert.equal(result.status, 'confirmed')
  assert.equal(result.evidence, 'xml_file_identifier')
})

test('rejects a resource link with the wrong chat scope or resource hash', () => {
  const alignment = alignResourceMessage(exactProbe, [exactMessage])
  const wrongChat = evaluateResourceLinkEvidence({
    alignment,
    canonical_chat_scope: 'chat:project-room',
    resource_chat_scope: 'chat:other-room',
    message_resource_hash: 'sha256:resource-content',
    candidate_resource_hash: 'sha256:resource-content',
  })
  const wrongHash = evaluateResourceLinkEvidence({
    alignment,
    canonical_chat_scope: 'chat:project-room',
    resource_chat_scope: 'chat:project-room',
    message_resource_hash: 'sha256:resource-content',
    candidate_resource_hash: 'sha256:different-content',
  })

  assert.deepEqual(wrongChat, {
    status: 'unconfirmed',
    message_uid: exactMessage.message_uid,
    evidence: 'resource_hash',
    reason: 'chat_scope_mismatch',
  })
  assert.deepEqual(wrongHash, {
    status: 'unconfirmed',
    message_uid: exactMessage.message_uid,
    evidence: 'resource_hash',
    reason: 'stable_resource_evidence_mismatch',
  })
})

test('keeps filename-only resource candidates explicitly unconfirmed', () => {
  const result = evaluateResourceLinkEvidence({
    alignment: alignResourceMessage(exactProbe, [exactMessage]),
    canonical_chat_scope: 'chat:project-room',
    resource_chat_scope: 'chat:project-room',
    filename: '项目交付.pdf',
  })

  assert.deepEqual(result, {
    status: 'unconfirmed',
    message_uid: exactMessage.message_uid,
    evidence: 'filename_only',
    reason: 'filename_only',
  })
})

test('does not confirm a resource link from partial message alignment', () => {
  const partialProbe = {
    ...exactProbe,
    create_time: undefined,
  }
  const result = evaluateResourceLinkEvidence({
    alignment: alignResourceMessage(partialProbe, [exactMessage]),
    canonical_chat_scope: 'chat:project-room',
    resource_chat_scope: 'chat:project-room',
    message_resource_hash: 'sha256:resource-content',
    candidate_resource_hash: 'sha256:resource-content',
  })

  assert.deepEqual(result, {
    status: 'unconfirmed',
    message_uid: exactMessage.message_uid,
    evidence: 'resource_hash',
    reason: 'message_alignment_not_exact',
  })
})

test('classifies artifact categories with deterministic evidence precedence', () => {
  const cases = [
    [{ name: 'apple-design SKILL.md', preview: 'markdown', url: 'https://example.com' }, 'skill'],
    [{ name: '课程讲义.pdf', preview: 'image', url: 'https://example.com' }, 'document'],
    [{ name: '交互作品.html', preview: 'html', url: 'https://example.com' }, 'work'],
    [{ name: 'OpenAI 文档', url: 'https://example.com', chatText: true }, 'link'],
    [{ name: '普通聊天消息', chatText: true }, 'chatText'],
    [{ name: '无扩展名的本地作品', hasLocalFile: true }, 'work'],
  ] as const

  for (const [candidate, expected] of cases) {
    assert.equal(classifyArtifactCategory(candidate), expected)
  }
})

test('defines all as work, document, skill, and link while excluding chat text', () => {
  assert.deepEqual(
    (['work', 'document', 'skill', 'link', 'chatText'] as const).map((category) => (
      [category, isIncludedInAll(category)]
    )),
    [
      ['work', true],
      ['document', true],
      ['skill', true],
      ['link', true],
      ['chatText', false],
    ],
  )
})

test('extracts and deduplicates structured URLs from Chinese text and application XML', () => {
  const urls = extractStructuredUrls({
    text: [
      '中文包围（https://Example.com/report?id=42），请查看。',
      '重复链接：https://example.com:443/report?id=42。',
      '另一个：https://docs.example.cn/guide#开始；结束。',
    ].join(''),
    application_xml: [
      '<appmsg>',
      '<url>https://files.example.com/download?id=7&amp;from=xml</url>',
      '<sourceurl><![CDATA[https://example.com/report?id=42]]></sourceurl>',
      '</appmsg>',
    ].join(''),
  })

  assert.deepEqual(urls, [
    'https://example.com/report?id=42',
    'https://docs.example.cn/guide#%E5%BC%80%E5%A7%8B',
    'https://files.example.com/download?id=7&from=xml',
  ])
})

test('ignores unsupported or malformed URL-like values', () => {
  assert.deepEqual(extractStructuredUrls({
    text: 'ftp://example.com/file 以及 https://[invalid',
    application_xml: '<url>javascript:alert(1)</url>',
  }), [])
})

test('creates a stable resource evidence signature in canonical field order', () => {
  assert.deepEqual(RESOURCE_EVIDENCE_SIGNATURE_FIELDS, [
    'message_uid',
    'canonical_chat_scope',
    'resource_kind',
    'packed_info_digest',
    'resource_hash',
    'xml_file_identifier',
  ])

  const ordered: ResourceEvidenceSignatureInput = {
    message_uid: exactMessage.message_uid,
    canonical_chat_scope: 'chat:中文项目群',
    resource_kind: 'document',
    packed_info_digest: 'sha256:packed-info',
    resource_hash: 'sha256:resource-content',
    xml_file_identifier: 'xml-file-id:42',
  }
  const reordered: ResourceEvidenceSignatureInput = {
    xml_file_identifier: 'xml-file-id:42',
    resource_hash: 'sha256:resource-content',
    packed_info_digest: 'sha256:packed-info',
    resource_kind: 'document',
    canonical_chat_scope: 'chat:中文项目群',
    message_uid: exactMessage.message_uid,
  }

  const signature = createResourceEvidenceSignature(ordered)
  assert.equal(signature, createResourceEvidenceSignature(reordered))
  assert.match(signature, /^sha256:[a-f0-9]{64}$/u)
})

test('keeps snapshot and resource row audit coordinates out of the evidence signature', () => {
  const stableEvidence: ResourceEvidenceSignatureInput = {
    message_uid: exactMessage.message_uid,
    canonical_chat_scope: 'chat:project-room',
    resource_kind: 'document',
    resource_hash: 'sha256:resource-content',
  }
  const firstAuditRecord = {
    ...stableEvidence,
    snapshot: 'snapshot-01',
    resource_message_id: '7',
    resource_id: '91',
  }
  const movedAuditRecord = {
    ...stableEvidence,
    snapshot: 'snapshot-02',
    resource_message_id: '8042',
    resource_id: '12001',
  }

  assert.equal(
    createResourceEvidenceSignature(firstAuditRecord),
    createResourceEvidenceSignature(movedAuditRecord),
  )
})

test('changes the resource signature when canonical or stable evidence changes', () => {
  const input: ResourceEvidenceSignatureInput = {
    message_uid: exactMessage.message_uid,
    canonical_chat_scope: 'chat:project-room',
    resource_kind: 'document',
    resource_hash: 'sha256:resource-content',
  }
  const base = createResourceEvidenceSignature(input)

  assert.notEqual(base, createResourceEvidenceSignature({
    ...input,
    message_uid: 'wxm:canonical-message-99',
  }))
  assert.notEqual(base, createResourceEvidenceSignature({
    ...input,
    resource_hash: 'sha256:different-content',
  }))
  assert.notEqual(base, createResourceEvidenceSignature({
    ...input,
    xml_file_identifier: 'xml-file-id:added-evidence',
  }))
})

test('requires at least one stable resource evidence value for a signature', () => {
  assert.throws(() => createResourceEvidenceSignature({
    message_uid: exactMessage.message_uid,
    canonical_chat_scope: 'chat:project-room',
    resource_kind: 'document',
  }), /At least one stable resource evidence value is required/u)
})

test('keeps snapshot and resource row coordinates out of stable asset identity', () => {
  const firstAuditRecord = {
    snapshot: 'snapshot-01',
    resource_message_id: '7',
    resource_id: '91',
    message_uid: 'wxm:canonical-message-42',
    resource_evidence_signature: 'sha256:stable-resource-evidence',
    variant: 'original',
  }
  const movedAuditRecord = {
    ...firstAuditRecord,
    snapshot: 'snapshot-02',
    resource_message_id: '8042',
    resource_id: '12001',
  }
  const assetIdFor = (record: typeof firstAuditRecord) => createAssetId(
    record.message_uid,
    record.resource_evidence_signature,
    record.variant,
  )

  assert.equal(assetIdFor(firstAuditRecord), assetIdFor(movedAuditRecord))
  assert.match(assetIdFor(firstAuditRecord), /^[a-f0-9]{64}$/u)
})

test('changes asset_id when canonical message, resource evidence, or variant changes', () => {
  const base = createAssetId(
    'wxm:canonical-message-42',
    'sha256:stable-resource-evidence',
    'original',
  )

  assert.notEqual(base, createAssetId(
    'wxm:canonical-message-99',
    'sha256:stable-resource-evidence',
    'original',
  ))
  assert.notEqual(base, createAssetId(
    'wxm:canonical-message-42',
    'sha256:different-resource-evidence',
    'original',
  ))
  assert.notEqual(base, createAssetId(
    'wxm:canonical-message-42',
    'sha256:stable-resource-evidence',
    'thumbnail',
  ))
})

test('validates every stable asset identity part and rejects ambiguous separators', () => {
  const invalidCases = [
    [['', 'sha256:evidence', 'original'], /message_uid must not be empty/u],
    [['wxm:message', ' ', 'original'], /resource_evidence_signature must not be empty/u],
    [['wxm:message', 'sha256:evidence', ''], /variant must not be empty/u],
    [['wxm:message|other', 'sha256:evidence', 'original'], /message_uid must not contain \|/u],
    [['wxm:message', 'sha256:evidence|other', 'original'], /resource_evidence_signature must not contain \|/u],
    [['wxm:message', 'sha256:evidence', 'original|thumbnail'], /variant must not contain \|/u],
  ] as const

  for (const [parts, expectedError] of invalidCases) {
    assert.throws(() => createAssetId(parts[0], parts[1], parts[2]), expectedError)
  }
})

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

test('returns a relative path only when canonical Windows paths remain within the root', () => {
  assert.deepEqual(
    relativePathWithinRoot(
      'D:\\ChatFiles\\archive',
      'd:\\chatfiles\\archive\\snapshot-01\\image.webp',
    ),
    { safe: true, relative_path: 'snapshot-01\\image.webp' },
  )

  assert.deepEqual(
    relativePathWithinRoot('D:\\ChatFiles\\archive', 'D:\\ChatFiles\\outside\\image.webp'),
    { safe: false, reason: 'outside_root' },
  )
  assert.deepEqual(
    relativePathWithinRoot('D:\\ChatFiles\\archive', 'D:\\ChatFiles\\archive-copy\\image.webp'),
    { safe: false, reason: 'outside_root' },
  )
})

test('uses canonical-target semantics so a resolved symlink escape is rejected', () => {
  const canonicalRoot = 'D:\\ChatFiles\\archive'
  const canonicalTargetAfterRealpath = 'D:\\private-source\\secret.dat'

  assert.deepEqual(relativePathWithinRoot(canonicalRoot, canonicalTargetAfterRealpath), {
    safe: false,
    reason: 'outside_root',
  })
})

test('rejects UNC, device namespace, DOS device, ADS, relative, and cross-volume paths', () => {
  const root = 'D:\\ChatFiles\\archive'
  const cases = [
    ['\\\\server\\share\\image.webp', 'unc_path'],
    ['//server/share/image.webp', 'unc_path'],
    ['\\\\?\\D:\\ChatFiles\\archive\\image.webp', 'device_path'],
    ['\\\\.\\PhysicalDrive0', 'device_path'],
    ['D:\\ChatFiles\\archive\\NUL.txt', 'device_path'],
    ['D:\\ChatFiles\\archive\\image.webp:Zone.Identifier', 'alternate_data_stream'],
    ['archive\\image.webp', 'path_not_absolute'],
    ['E:\\ChatFiles\\archive\\image.webp', 'outside_root'],
  ] as const

  for (const [target, reason] of cases) {
    assert.deepEqual(relativePathWithinRoot(root, target), { safe: false, reason }, target)
  }
})
