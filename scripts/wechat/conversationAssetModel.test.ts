import assert from 'node:assert/strict'
import test from 'node:test'
import { alignResourceMessage, type CanonicalMessage } from './assetEvidence.js'
import {
  createLinkArtifacts,
  createResourceArtifact,
  createVoiceArtifact,
  type AssetCanonicalMessage,
} from './conversationAssetModel.js'

const canonical: CanonicalMessage = {
  message_uid: 'wxm:message-42',
  source_db: 'message_0.db',
  chat_table: 'wxid_peer',
  message_table: 'Msg_0123456789abcdef0123456789abcdef',
  local_id: 42,
  normalized_type: 49,
  raw_type: '25769803825',
  create_time: 1_783_800_000,
  server_id: '9223372036854770000',
  message_origin_source: 1,
}

const message: AssetCanonicalMessage = {
  ...canonical,
  conv_id: 'wx:owner:wxid_peer',
  conversation_username: 'wxid_peer',
  sender_name: '陈同学',
  text: '课程讲义 https://example.com/path?a=1',
}

function exactAlignment() {
  return alignResourceMessage({
    message_id: '100',
    chat_table: canonical.chat_table,
    message_table: canonical.message_table,
    local_id: canonical.local_id,
    normalized_type: canonical.normalized_type,
    raw_type: canonical.raw_type,
    create_time: canonical.create_time,
    server_id: canonical.server_id,
    message_origin_source: canonical.message_origin_source,
  }, [canonical])
}

test('creates a confirmed document artifact from stable hash and local file evidence', () => {
  const artifact = createResourceArtifact({
    message,
    alignment: exactAlignment(),
    resourceMessageId: '100',
    resourceId: '501',
    resourceType: '3342339',
    dataIndex: '0',
    expectedSize: 4096,
    detailStatus: 1,
    messageHashes: ['0123456789abcdef0123456789abcdef'],
    filenames: ['课程讲义.pdf'],
    packedInfoDigest: 'sha256:packed-info',
    fileMatch: {
      status: 'hash_exact',
      candidate: {
        relativePath: 'msg\\file\\2026-07\\0123456789abcdef0123456789abcdef.pdf',
        name: '0123456789abcdef0123456789abcdef.pdf',
        size: 4096,
      },
      candidates: [],
    },
  })

  assert.equal(artifact.category, 'document')
  assert.equal(artifact.name, '课程讲义.pdf')
  assert.equal(artifact.link_status, 'confirmed')
  assert.equal(artifact.link_reason, null)
  assert.equal(artifact.evidence_kind, 'resource_hash')
  assert.equal(artifact.materialization, 'exported')
  assert.equal(artifact.preview_status, 'ready')
  assert.equal(artifact.failure_reason, null)
  assert.equal(artifact.source_relative_path?.endsWith('.pdf'), true)
})

test('keeps filename-only local matches explicitly unconfirmed', () => {
  const artifact = createResourceArtifact({
    message,
    alignment: exactAlignment(),
    resourceMessageId: '100',
    resourceId: '502',
    resourceType: '3342339',
    dataIndex: '0',
    expectedSize: 4096,
    detailStatus: 1,
    messageHashes: [],
    filenames: ['课程讲义.pdf'],
    packedInfoDigest: 'sha256:packed-info',
    fileMatch: {
      status: 'filename_only',
      candidate: {
        relativePath: 'msg\\file\\2026-07\\课程讲义.pdf',
        name: '课程讲义.pdf',
        size: 4096,
      },
      candidates: [],
    },
  })

  assert.equal(artifact.link_status, 'unconfirmed')
  assert.equal(artifact.evidence_kind, 'filename_only')
  assert.equal(artifact.link_reason, 'filename_only')
  assert.equal(artifact.failure_reason, null)
})

test('records encrypted image payloads as explicit decrypt attempts', () => {
  const imageMessage: AssetCanonicalMessage = {
    ...message,
    normalized_type: 3,
    raw_type: '3',
  }
  const artifact = createResourceArtifact({
    message: imageMessage,
    alignment: { ...exactAlignment(), message_uid: imageMessage.message_uid },
    resourceMessageId: '101',
    resourceId: '503',
    resourceType: '65537',
    dataIndex: '0',
    expectedSize: 2048,
    detailStatus: 1,
    messageHashes: ['41dc6069a2c1d5a8757704fc3dea0701'],
    filenames: [],
    packedInfoDigest: 'sha256:image-packed-info',
    fileMatch: {
      status: 'hash_exact',
      candidate: {
        relativePath: 'msg\\attach\\room\\2026-07\\Img\\41dc6069a2c1d5a8757704fc3dea0701.dat',
        name: '41dc6069a2c1d5a8757704fc3dea0701.dat',
        size: 2048,
      },
      candidates: [],
    },
  })

  assert.equal(artifact.category, 'work')
  assert.equal(artifact.preview, 'image')
  assert.equal(artifact.materialization, 'decrypt_failed')
  assert.equal(artifact.preview_status, 'decrypt_failed')
  assert.equal(artifact.failure_reason, 'encrypted_wechat_dat_requires_materialization')
})

test('extracts canonical links as separate ready artifacts', () => {
  const links = createLinkArtifacts(message)

  assert.equal(links.length, 1)
  assert.equal(links[0]?.category, 'link')
  assert.equal(links[0]?.url, 'https://example.com/path?a=1')
  assert.equal(links[0]?.materialization, 'exported')
  assert.equal(links[0]?.preview_status, 'ready')
})

test('creates a visible voice export attempt with a required failure reason', () => {
  const voice = createVoiceArtifact({
    ...message,
    normalized_type: 34,
    raw_type: '34',
    text: '[语音 3秒]',
  })

  assert.equal(voice.preview, 'voice')
  assert.equal(voice.materialization, 'missing_source')
  assert.equal(voice.preview_status, 'missing_source')
  assert.equal(voice.failure_reason, 'voice_source_not_exposed_by_message_resource')
  assert.equal(voice.link_reason, 'voice_resource_not_available')
})
