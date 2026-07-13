import { createHash } from 'node:crypto'
import path from 'node:path'
import {
  classifyArtifactCategory,
  createAssetEvidenceState,
  createAssetId,
  createResourceEvidenceSignature,
  evaluateResourceLinkEvidence,
  extractStructuredUrls,
  type ArtifactCategory,
  type CanonicalMessage,
  type ResourceMessageAlignment,
} from './assetEvidence.js'
import type { ResourceFileMatch } from './resourceFileMatcher.js'

export interface AssetCanonicalMessage extends CanonicalMessage {
  conv_id: string
  conversation_username: string
  sender_name: string
  text: string
}

export type ConversationArtifactRecord = {
  asset_id: string
  conv_id: string | null
  message_uid: string | null
  resource_message_id: string | null
  resource_id: string | null
  category: ArtifactCategory
  kind: 'resource' | 'link' | 'voice'
  name: string
  preview: string
  url: string | null
  source_relative_path: string | null
  source_size: number | null
  created_at: number
  sender_name: string
  text: string
  alignment_status: string
  link_status: string
  link_reason: string | null
  candidate_message_uids: string
  evidence_kind: string
  evidence_signature: string
  materialization: string
  preview_status: string
  failure_reason: string | null
}

function sha256(value: string | Uint8Array) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function hashFromName(name: string) {
  return name.match(/(?:^|[^0-9a-f])([0-9a-f]{32})(?=$|[^0-9a-f])/iu)?.[1]?.toLowerCase() ?? null
}

function previewFor(name: string, normalizedType: number) {
  if (normalizedType === 3) return 'image'
  if (normalizedType === 43) return 'video'
  if (normalizedType === 34) return 'voice'
  const extension = path.extname(name).toLowerCase()
  if (/\.(?:png|jpe?g|gif|webp|bmp|svg|ico|apng|avif)$/iu.test(extension)) return 'image'
  if (/\.(?:mp4|webm|mov|mkv)$/iu.test(extension)) return 'video'
  if (/\.(?:amr|silk)$/iu.test(extension)) return 'voice'
  if (/\.(?:mp3|wav|ogg|m4a)$/iu.test(extension)) return 'audio'
  if (extension === '.pdf') return 'pdf'
  if (/\.(?:docx?)$/iu.test(extension)) return 'docx'
  if (/\.(?:xlsx?|csv)$/iu.test(extension)) return 'sheet'
  if (/\.(?:pptx?|ppsx)$/iu.test(extension)) return 'presentation'
  if (/\.(?:html?)$/iu.test(extension)) return 'html'
  if (/\.(?:md|markdown)$/iu.test(extension)) return 'markdown'
  if (extension === '.json') return 'json'
  if (/\.(?:txt|log|xml|ya?ml|toml|ini|cfg|conf)$/iu.test(extension)) return 'text'
  if (/\.(?:zip|rar|7z)$/iu.test(extension)) return 'archive'
  if (/\.(?:py|js|jsx|ts|tsx|css|vue|c|h|cpp|java)$/iu.test(extension)) return 'code'
  return 'download'
}

function fallbackName(normalizedType: number) {
  if (normalizedType === 3) return '图片'
  if (normalizedType === 43) return '视频'
  if (normalizedType === 34) return '语音'
  return '聊天附件'
}

function stateForMatch(
  match: ResourceFileMatch,
  preview: string,
) {
  if (match.status === 'ambiguous') {
    return createAssetEvidenceState('source_ambiguous', 'source_ambiguous', 'multiple_local_candidates')
  }
  if (match.status === 'size_mismatch') {
    return createAssetEvidenceState('hash_mismatch', 'hash_mismatch', 'local_candidate_size_mismatch')
  }
  if (match.status === 'missing') {
    return createAssetEvidenceState('missing_source', 'missing_source', 'local_source_not_found')
  }
  const candidate = match.candidate
  if (!candidate) throw new Error('Matched resource must include one local candidate')
  const extension = path.extname(candidate.name).toLowerCase()
  if (extension === '.dat' && preview === 'image') {
    return createAssetEvidenceState(
      'decrypt_failed',
      'decrypt_failed',
      'encrypted_wechat_dat_requires_materialization',
    )
  }
  return createAssetEvidenceState('exported', 'ready')
}

export function createResourceArtifact(input: {
  message: AssetCanonicalMessage | null
  alignment: ResourceMessageAlignment
  resourceChatScope?: string
  resourceMessageId: string
  resourceId: string
  resourceType: string
  dataIndex: string
  expectedSize: number
  detailStatus: number
  messageHashes: readonly string[]
  filenames: readonly string[]
  packedInfoDigest: string
  fileMatch: ResourceFileMatch
}): ConversationArtifactRecord {
  const candidate = input.fileMatch.candidate
  const name = input.filenames[0] ?? candidate?.name ?? fallbackName(input.message?.normalized_type ?? 0)
  const preview = previewFor(name, input.message?.normalized_type ?? 0)
  const category = classifyArtifactCategory({
    name,
    preview,
    hasLocalFile: candidate !== null,
  })
  const candidateHash = candidate && input.fileMatch.status === 'hash_exact'
    ? hashFromName(candidate.name)
    : null
  const linkEvidence = evaluateResourceLinkEvidence({
    alignment: input.alignment,
    canonical_chat_scope: input.message?.conversation_username ?? '',
    resource_chat_scope: input.resourceChatScope ?? input.message?.conversation_username ?? '',
    message_resource_hash: input.messageHashes[0] ?? null,
    candidate_resource_hash: candidateHash,
    filename: input.filenames[0] ?? candidate?.name ?? null,
  })
  const signatureMessageUid = input.alignment.message_uid ?? `unlinked:${input.resourceMessageId}`
  const evidenceSignature = createResourceEvidenceSignature({
    message_uid: signatureMessageUid,
    canonical_chat_scope: input.resourceChatScope ?? input.message?.conversation_username ?? 'unlinked',
    resource_kind: `${input.resourceType}:${input.dataIndex}`,
    packed_info_digest: input.packedInfoDigest,
    resource_hash: input.messageHashes[0] ?? null,
  })
  const evidenceState = stateForMatch(input.fileMatch, preview)
  const failureReason = 'reason' in evidenceState ? evidenceState.reason ?? null : null

  return {
    asset_id: createAssetId(signatureMessageUid, evidenceSignature, input.resourceId),
    conv_id: input.message?.conv_id ?? null,
    message_uid: input.alignment.message_uid ?? null,
    resource_message_id: input.resourceMessageId,
    resource_id: input.resourceId,
    category,
    kind: 'resource',
    name,
    preview,
    url: null,
    source_relative_path: candidate?.relativePath ?? null,
    source_size: candidate?.size ?? null,
    created_at: input.message?.create_time ?? 0,
    sender_name: input.message?.sender_name ?? '',
    text: input.message?.text ?? '',
    alignment_status: input.alignment.status,
    link_status: linkEvidence.status,
    link_reason: linkEvidence.reason,
    candidate_message_uids: JSON.stringify(input.alignment.candidate_message_uids),
    evidence_kind: linkEvidence.evidence,
    evidence_signature: evidenceSignature,
    materialization: evidenceState.materialization,
    preview_status: evidenceState.preview,
    failure_reason: failureReason,
  }
}

export function createLinkArtifacts(
  message: AssetCanonicalMessage,
): ConversationArtifactRecord[] {
  return extractStructuredUrls({ text: message.text }).map((url, index) => {
    const evidenceSignature = createResourceEvidenceSignature({
      message_uid: message.message_uid,
      canonical_chat_scope: message.conversation_username,
      resource_kind: 'link',
      packed_info_digest: sha256(url),
    })
    return {
      asset_id: createAssetId(message.message_uid, evidenceSignature, `url:${index}`),
      conv_id: message.conv_id,
      message_uid: message.message_uid,
      resource_message_id: null,
      resource_id: null,
      category: 'link',
      kind: 'link',
      name: url,
      preview: 'link',
      url,
      source_relative_path: null,
      source_size: null,
      created_at: message.create_time,
      sender_name: message.sender_name,
      text: message.text,
      alignment_status: 'exact',
      link_status: 'confirmed',
      link_reason: null,
      candidate_message_uids: JSON.stringify([message.message_uid]),
      evidence_kind: 'message_text',
      evidence_signature: evidenceSignature,
      materialization: 'exported',
      preview_status: 'ready',
      failure_reason: null,
    }
  })
}

export function createVoiceArtifact(
  message: AssetCanonicalMessage,
): ConversationArtifactRecord {
  const evidenceSignature = createResourceEvidenceSignature({
    message_uid: message.message_uid,
    canonical_chat_scope: message.conversation_username,
    resource_kind: 'voice',
    packed_info_digest: sha256(`${message.message_uid}\0voice`),
  })
  return {
    asset_id: createAssetId(message.message_uid, evidenceSignature, 'voice'),
    conv_id: message.conv_id,
    message_uid: message.message_uid,
    resource_message_id: null,
    resource_id: null,
    category: 'work',
    kind: 'voice',
    name: '语音消息',
    preview: 'voice',
    url: null,
    source_relative_path: null,
    source_size: null,
    created_at: message.create_time,
    sender_name: message.sender_name,
    text: message.text,
    alignment_status: 'exact',
    link_status: 'unconfirmed',
    link_reason: 'voice_resource_not_available',
    candidate_message_uids: JSON.stringify([message.message_uid]),
    evidence_kind: 'none',
    evidence_signature: evidenceSignature,
    materialization: 'missing_source',
    preview_status: 'missing_source',
    failure_reason: 'voice_source_not_exposed_by_message_resource',
  }
}
