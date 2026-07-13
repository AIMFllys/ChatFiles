import assert from 'node:assert/strict'
import test from 'node:test'

import { alignResourceMessage, evaluateResourceLinkEvidence } from './assetEvidence.js'
import { exactMessage, exactProbe } from './assetEvidenceTestFixtures.js'
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
