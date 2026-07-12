import { createHash } from 'node:crypto'
import path from 'node:path'

export const RESOURCE_MESSAGE_PRIMARY_KEY = 'message_id' as const
export const CANONICAL_MESSAGE_PRIMARY_KEY = 'message_uid' as const

export const RESOURCE_LOCATOR_FIELDS = [
  'chat_table',
  'message_table',
  'local_id',
  'normalized_type',
  'raw_type',
  'create_time',
  'server_id',
  'message_origin_source',
] as const

export type ResourceLocatorField = typeof RESOURCE_LOCATOR_FIELDS[number]
export type ResourceAlignmentField = typeof CANONICAL_MESSAGE_PRIMARY_KEY | ResourceLocatorField

export interface ResourceMessageLocator {
  chat_table: string
  message_table: string
  local_id: number
  normalized_type: number
  raw_type: string
  create_time: number
  server_id: string | null
  message_origin_source: number | null
}

export interface CanonicalMessage extends ResourceMessageLocator {
  message_uid: string
  source_db: string
}

export interface ResourceMessageProbe extends Partial<ResourceMessageLocator> {
  message_id: string
  message_uid?: string
}

export type ResourceAlignmentStatus = 'exact' | 'partial' | 'missing' | 'conflict'

export interface ResourceMessageAlignment {
  status: ResourceAlignmentStatus
  resource_message_id: string
  message_uid: string | null
  candidate_message_uids: string[]
  matched_fields: ResourceAlignmentField[]
  missing_fields: ResourceLocatorField[]
  conflicting_fields: ResourceAlignmentField[]
}

type MatchableMessageField = keyof ResourceMessageLocator | typeof CANONICAL_MESSAGE_PRIMARY_KEY

function isSupplied<K extends keyof ResourceMessageProbe>(
  probe: ResourceMessageProbe,
  field: K,
): probe is ResourceMessageProbe & Required<Pick<ResourceMessageProbe, K>> {
  return Object.prototype.hasOwnProperty.call(probe, field) && probe[field] !== undefined
}

function uniqueMessageUids(messages: readonly CanonicalMessage[]): string[] {
  return [...new Set(messages.map((message) => message.message_uid))]
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
}

function matchesField(
  message: CanonicalMessage,
  probe: ResourceMessageProbe,
  field: MatchableMessageField,
): boolean {
  return !isSupplied(probe, field) || Object.is(message[field], probe[field])
}

function matchesFields(
  message: CanonicalMessage,
  probe: ResourceMessageProbe,
  fields: readonly MatchableMessageField[],
): boolean {
  return fields.every((field) => matchesField(message, probe, field))
}

function hasNonzeroServerId(
  probe: ResourceMessageProbe,
): probe is ResourceMessageProbe & { server_id: string } {
  if (!isSupplied(probe, 'server_id') || probe.server_id === null) return false
  const serverId = probe.server_id.trim()
  return serverId !== '' && serverId !== '0'
}

function selectIdentityCandidates(
  probe: ResourceMessageProbe,
  messages: readonly CanonicalMessage[],
): CanonicalMessage[] {
  const candidateGroups: CanonicalMessage[][] = []

  if (isSupplied(probe, CANONICAL_MESSAGE_PRIMARY_KEY)) {
    candidateGroups.push(messages.filter((message) => message.message_uid === probe.message_uid))
  }

  const positionalFields = ['chat_table', 'message_table', 'local_id'] as const
  if (positionalFields.every((field) => isSupplied(probe, field))) {
    candidateGroups.push(messages.filter((message) => matchesFields(message, probe, positionalFields)))
  }

  const serverScopeFields = ['chat_table', 'message_table'] as const
  const hasServerLocator = hasNonzeroServerId(probe)
    && serverScopeFields.every((field) => isSupplied(probe, field))
  if (hasServerLocator) {
    candidateGroups.push(messages.filter((message) => (
      matchesFields(message, probe, serverScopeFields) && message.server_id === probe.server_id
    )))
  }

  if (candidateGroups.length === 0) return []
  const selected = new Set(candidateGroups.flat())
  return messages.filter((message) => selected.has(message))
}

function conflictFieldsFor(
  probe: ResourceMessageProbe,
  candidates: readonly CanonicalMessage[],
): ResourceAlignmentField[] {
  const conflicts: ResourceAlignmentField[] = []
  const conflictsWithMessageUid = isSupplied(probe, CANONICAL_MESSAGE_PRIMARY_KEY)
    && candidates.some((candidate) => candidate.message_uid !== probe.message_uid)
  if (candidates.length > 1 || conflictsWithMessageUid) {
    conflicts.push(CANONICAL_MESSAGE_PRIMARY_KEY)
  }

  for (const field of RESOURCE_LOCATOR_FIELDS) {
    const candidateValues = new Set(candidates.map((candidate) => candidate[field]))
    const conflictsWithProbe = isSupplied(probe, field)
      && candidates.some((candidate) => !Object.is(candidate[field], probe[field]))
    if (candidateValues.size > 1 || conflictsWithProbe) conflicts.push(field)
  }

  return conflicts
}

function fieldsMatchingEveryCandidate(
  probe: ResourceMessageProbe,
  candidates: readonly CanonicalMessage[],
  suppliedFields: readonly ResourceAlignmentField[],
): ResourceAlignmentField[] {
  return suppliedFields.filter((field) => (
    candidates.every((candidate) => Object.is(candidate[field], probe[field]))
  ))
}

export function alignResourceMessage(
  probe: ResourceMessageProbe,
  messages: readonly CanonicalMessage[],
): ResourceMessageAlignment {
  const suppliedFields: ResourceAlignmentField[] = [
    ...(isSupplied(probe, CANONICAL_MESSAGE_PRIMARY_KEY) ? [CANONICAL_MESSAGE_PRIMARY_KEY] : []),
    ...RESOURCE_LOCATOR_FIELDS.filter((field) => isSupplied(probe, field)),
  ]
  const missingFields = RESOURCE_LOCATOR_FIELDS.filter((field) => !isSupplied(probe, field))
  const candidates = selectIdentityCandidates(probe, messages)

  if (candidates.length === 0) {
    return {
      status: 'missing',
      resource_message_id: probe.message_id,
      message_uid: null,
      candidate_message_uids: [],
      matched_fields: [],
      missing_fields: missingFields,
      conflicting_fields: [],
    }
  }

  const conflictFields = conflictFieldsFor(probe, candidates)
  if (candidates.length > 1 || conflictFields.length > 0) {
    return {
      status: 'conflict',
      resource_message_id: probe.message_id,
      message_uid: null,
      candidate_message_uids: uniqueMessageUids(candidates),
      matched_fields: fieldsMatchingEveryCandidate(probe, candidates, suppliedFields),
      missing_fields: missingFields,
      conflicting_fields: conflictFields,
    }
  }

  const candidate = candidates[0]
  if (!candidate) throw new Error('Unreachable: a unique candidate was expected')

  return {
    status: missingFields.length === 0 ? 'exact' : 'partial',
    resource_message_id: probe.message_id,
    message_uid: candidate.message_uid,
    candidate_message_uids: [candidate.message_uid],
    matched_fields: suppliedFields,
    missing_fields: missingFields,
    conflicting_fields: [],
  }
}

export type ResourceLinkEvidenceKind =
  | 'resource_hash'
  | 'xml_file_identifier'
  | 'filename_only'
  | 'none'

export type ResourceLinkUnconfirmedReason =
  | 'message_alignment_not_exact'
  | 'chat_scope_mismatch'
  | 'stable_resource_evidence_mismatch'
  | 'stable_resource_evidence_missing'
  | 'filename_only'

export interface ResourceLinkEvidenceInput {
  alignment: ResourceMessageAlignment
  canonical_chat_scope: string
  resource_chat_scope: string
  message_resource_hash?: string | null
  candidate_resource_hash?: string | null
  message_xml_file_identifier?: string | null
  candidate_xml_file_identifier?: string | null
  filename?: string | null
}

export type ResourceLinkEvidenceResult =
  | {
      status: 'confirmed'
      message_uid: string
      evidence: 'resource_hash' | 'xml_file_identifier'
      reason: null
    }
  | {
      status: 'unconfirmed'
      message_uid: string | null
      evidence: ResourceLinkEvidenceKind
      reason: ResourceLinkUnconfirmedReason
    }

function hasNonemptyValue(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function suppliedResourceEvidence(input: ResourceLinkEvidenceInput): ResourceLinkEvidenceKind {
  if (hasNonemptyValue(input.message_resource_hash) || hasNonemptyValue(input.candidate_resource_hash)) {
    return 'resource_hash'
  }
  if (
    hasNonemptyValue(input.message_xml_file_identifier)
    || hasNonemptyValue(input.candidate_xml_file_identifier)
  ) {
    return 'xml_file_identifier'
  }
  return hasNonemptyValue(input.filename) ? 'filename_only' : 'none'
}

function exactEvidencePair(left: string | null | undefined, right: string | null | undefined): boolean {
  return hasNonemptyValue(left) && hasNonemptyValue(right) && left === right
}

export function evaluateResourceLinkEvidence(
  input: ResourceLinkEvidenceInput,
): ResourceLinkEvidenceResult {
  const evidence = suppliedResourceEvidence(input)
  const messageUid = input.alignment.message_uid
  if (input.alignment.status !== 'exact' || messageUid === null) {
    return {
      status: 'unconfirmed',
      message_uid: messageUid,
      evidence,
      reason: 'message_alignment_not_exact',
    }
  }

  const exactChatScope = hasNonemptyValue(input.canonical_chat_scope)
    && hasNonemptyValue(input.resource_chat_scope)
    && input.canonical_chat_scope === input.resource_chat_scope
  if (!exactChatScope) {
    return {
      status: 'unconfirmed',
      message_uid: messageUid,
      evidence,
      reason: 'chat_scope_mismatch',
    }
  }

  if (exactEvidencePair(input.message_resource_hash, input.candidate_resource_hash)) {
    return {
      status: 'confirmed',
      message_uid: messageUid,
      evidence: 'resource_hash',
      reason: null,
    }
  }
  if (exactEvidencePair(input.message_xml_file_identifier, input.candidate_xml_file_identifier)) {
    return {
      status: 'confirmed',
      message_uid: messageUid,
      evidence: 'xml_file_identifier',
      reason: null,
    }
  }

  if (evidence === 'filename_only') {
    return {
      status: 'unconfirmed',
      message_uid: messageUid,
      evidence,
      reason: 'filename_only',
    }
  }
  return {
    status: 'unconfirmed',
    message_uid: messageUid,
    evidence,
    reason: evidence === 'none'
      ? 'stable_resource_evidence_missing'
      : 'stable_resource_evidence_mismatch',
  }
}

export type ArtifactCategory = 'work' | 'document' | 'skill' | 'link' | 'chatText'

export interface ArtifactClassificationInput {
  name: string
  preview?: string | null
  url?: string | null
  hasLocalFile?: boolean
  chatText?: boolean
}

const DOCUMENT_PREVIEWS = new Set([
  'pdf',
  'docx',
  'sheet',
  'presentation',
  'markdown',
  'text',
  'json',
])
const WORK_PREVIEWS = new Set(['image', 'video', 'audio', 'voice', 'html', 'code'])
const DOCUMENT_EXTENSION = /\.(?:pdf|docx?|pptx?|ppsx|xlsx?|csv|md|markdown|txt|rtf)$/iu
const WORK_EXTENSION = /\.(?:avif|bmp|gif|heic|jpe?g|png|svg|webp|mp4|mov|mkv|webm|mp3|wav|m4a|ogg|html?|css|jsx?|tsx?)$/iu
const SKILL_SIGNAL = /(?:^|[\s/_.-])skills?(?:[\s/_.-]|$)|skill\.md|技能包|技能工具/iu

export function classifyArtifactCategory(candidate: ArtifactClassificationInput): ArtifactCategory {
  const name = candidate.name.trim()
  const preview = candidate.preview?.trim().toLowerCase() ?? ''

  if (preview === 'skill' || SKILL_SIGNAL.test(name)) return 'skill'
  if (DOCUMENT_PREVIEWS.has(preview) || DOCUMENT_EXTENSION.test(name)) return 'document'
  if (WORK_PREVIEWS.has(preview) || WORK_EXTENSION.test(name) || candidate.hasLocalFile) return 'work'
  if (hasNonemptyValue(candidate.url)) return 'link'
  if (candidate.chatText) return 'chatText'
  return 'work'
}

export function isIncludedInAll(category: ArtifactCategory): boolean {
  return category === 'work'
    || category === 'document'
    || category === 'skill'
    || category === 'link'
}

export interface StructuredUrlInput {
  text?: string | null
  application_xml?: string | null
}

const STRUCTURED_URL_PATTERN = /https?:\/\/[^\s<>"'`，。！？；：、（）【】《》「」『』]+/giu
const TRAILING_URL_PUNCTUATION = /[.,!?;:)\]}]+$/u

function decodeXmlUrlEntities(value: string): string {
  return value
    .replace(/&amp;/giu, '&')
    .replace(/&#38;/giu, '&')
    .replace(/&#x26;/giu, '&')
}

function canonicalHttpUrl(value: string): string | null {
  const candidate = value.replace(TRAILING_URL_PUNCTUATION, '')
  try {
    const parsed = new URL(candidate)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.href
  } catch {
    return null
  }
}

export function extractStructuredUrls(input: StructuredUrlInput): string[] {
  const sources = [input.text ?? '', decodeXmlUrlEntities(input.application_xml ?? '')]
  const urls: string[] = []
  const seen = new Set<string>()
  for (const source of sources) {
    for (const match of source.matchAll(STRUCTURED_URL_PATTERN)) {
      const canonical = canonicalHttpUrl(match[0])
      if (canonical === null || seen.has(canonical)) continue
      seen.add(canonical)
      urls.push(canonical)
    }
  }
  return urls
}

export const RESOURCE_EVIDENCE_SIGNATURE_FIELDS = [
  'message_uid',
  'canonical_chat_scope',
  'resource_kind',
  'packed_info_digest',
  'resource_hash',
  'xml_file_identifier',
] as const

export interface ResourceEvidenceSignatureInput {
  message_uid: string
  canonical_chat_scope: string
  resource_kind: string
  packed_info_digest?: string | null
  resource_hash?: string | null
  xml_file_identifier?: string | null
}

function requireSignatureValue(label: string, value: string): void {
  if (!hasNonemptyValue(value)) throw new TypeError(`${label} must not be empty`)
}

export function createResourceEvidenceSignature(
  input: ResourceEvidenceSignatureInput,
): string {
  requireSignatureValue('message_uid', input.message_uid)
  requireSignatureValue('canonical_chat_scope', input.canonical_chat_scope)
  requireSignatureValue('resource_kind', input.resource_kind)

  const stableEvidence = [
    input.packed_info_digest,
    input.resource_hash,
    input.xml_file_identifier,
  ] as const
  for (const [index, value] of stableEvidence.entries()) {
    if (value === null || value === undefined) continue
    requireSignatureValue(RESOURCE_EVIDENCE_SIGNATURE_FIELDS[index + 3] ?? 'resource evidence', value)
  }
  if (!stableEvidence.some(hasNonemptyValue)) {
    throw new TypeError('At least one stable resource evidence value is required')
  }

  const canonicalPayload = RESOURCE_EVIDENCE_SIGNATURE_FIELDS.map((field) => [
    field,
    input[field] ?? null,
  ])
  const digest = createHash('sha256')
    .update(JSON.stringify(canonicalPayload), 'utf8')
    .digest('hex')
  return `sha256:${digest}`
}

function validateAssetIdPart(label: string, value: string): void {
  if (!value.trim()) throw new TypeError(`${label} must not be empty`)
  if (value.includes('|')) throw new TypeError(`${label} must not contain |`)
}

export function createAssetId(
  messageUid: string,
  resourceEvidenceSignature: string,
  variant: string,
): string {
  const parts = [messageUid, resourceEvidenceSignature, variant] as const
  const labels = ['message_uid', 'resource_evidence_signature', 'variant'] as const
  parts.forEach((part, index) => validateAssetIdPart(labels[index] ?? 'asset_id part', part))
  return createHash('sha256').update(parts.join('|'), 'utf8').digest('hex')
}

export type AssetMaterializationStatus =
  | 'exported'
  | 'thumbnail_only'
  | 'missing_source'
  | 'decrypt_failed'
  | 'source_ambiguous'
  | 'hash_mismatch'

export type AssetPreviewStatus =
  | 'ready'
  | 'thumbnail_only'
  | 'unavailable'
  | 'missing_source'
  | 'decrypt_failed'
  | 'unsupported_codec'
  | 'source_ambiguous'
  | 'hash_mismatch'

export type AssetEvidenceState =
  | { materialization: 'exported'; preview: 'ready' | 'unavailable'; reason?: never }
  | { materialization: 'thumbnail_only'; preview: 'thumbnail_only'; reason?: never }
  | { materialization: 'exported'; preview: 'unsupported_codec'; reason: string }
  | { materialization: 'missing_source'; preview: 'missing_source'; reason: string }
  | { materialization: 'decrypt_failed'; preview: 'decrypt_failed'; reason: string }
  | { materialization: 'source_ambiguous'; preview: 'source_ambiguous'; reason: string }
  | { materialization: 'hash_mismatch'; preview: 'hash_mismatch'; reason: string }

const ALLOWED_PREVIEW_STATUSES: Readonly<Record<AssetMaterializationStatus, readonly AssetPreviewStatus[]>> = {
  exported: ['ready', 'unavailable', 'unsupported_codec'],
  thumbnail_only: ['thumbnail_only'],
  missing_source: ['missing_source'],
  decrypt_failed: ['decrypt_failed'],
  source_ambiguous: ['source_ambiguous'],
  hash_mismatch: ['hash_mismatch'],
}

const FAILURE_PREVIEW_STATUSES = new Set<AssetPreviewStatus>([
  'missing_source',
  'decrypt_failed',
  'unsupported_codec',
  'source_ambiguous',
  'hash_mismatch',
])

export function createAssetEvidenceState(
  materialization: AssetMaterializationStatus,
  preview: AssetPreviewStatus,
  reason?: string,
): AssetEvidenceState {
  if (!ALLOWED_PREVIEW_STATUSES[materialization].includes(preview)) {
    throw new TypeError(`Invalid asset evidence state: ${materialization} cannot use ${preview}`)
  }
  if (FAILURE_PREVIEW_STATUSES.has(preview)) {
    if (!hasNonemptyValue(reason)) {
      throw new TypeError(`A nonempty reason is required for ${preview}`)
    }
    return { materialization, preview, reason: reason.trim() } as AssetEvidenceState
  }
  if (reason !== undefined) {
    throw new TypeError(`A reason is not allowed for ${materialization}/${preview}`)
  }
  return { materialization, preview } as AssetEvidenceState
}

export type UnsafeRealPathReason =
  | 'path_not_absolute'
  | 'unc_path'
  | 'device_path'
  | 'alternate_data_stream'
  | 'outside_root'

export type SafeRealPathResult =
  | { safe: true; relative_path: string }
  | { safe: false; reason: UnsafeRealPathReason }

function windowsPath(value: string): string {
  return value.replaceAll('/', '\\')
}

function isDeviceNamespace(value: string): boolean {
  const normalized = windowsPath(value)
  return normalized.startsWith('\\\\?\\')
    || normalized.startsWith('\\\\.\\')
    || normalized.startsWith('\\??\\')
    || normalized.startsWith('\\\\??\\')
}

function isUncPath(value: string): boolean {
  return windowsPath(value).startsWith('\\\\')
}

function hasAlternateDataStream(value: string): boolean {
  const normalized = windowsPath(value)
  const withoutDrive = /^[A-Za-z]:/.test(normalized) ? normalized.slice(2) : normalized
  return withoutDrive.includes(':')
}

function hasDosDeviceSegment(value: string): boolean {
  const normalized = windowsPath(value).replace(/^[A-Za-z]:\\?/, '')
  return normalized.split('\\').some((segment) => {
    const withoutTrailingDotsOrSpaces = segment.replace(/[. ]+$/u, '')
    const baseName = withoutTrailingDotsOrSpaces.split('.')[0]?.trimEnd().toUpperCase() ?? ''
    return /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9]|CONIN\$|CONOUT\$)$/u.test(baseName)
  })
}

function isDriveAbsolute(value: string): boolean {
  return /^[A-Za-z]:[\\/]/u.test(value)
}

// Both arguments are expected to be canonical paths returned by realpath at the I/O boundary.
export function relativePathWithinRoot(
  rootRealPath: string,
  targetRealPath: string,
): SafeRealPathResult {
  if (isDeviceNamespace(rootRealPath) || isDeviceNamespace(targetRealPath)) {
    return { safe: false, reason: 'device_path' }
  }
  if (isUncPath(rootRealPath) || isUncPath(targetRealPath)) {
    return { safe: false, reason: 'unc_path' }
  }
  if (hasAlternateDataStream(rootRealPath) || hasAlternateDataStream(targetRealPath)) {
    return { safe: false, reason: 'alternate_data_stream' }
  }
  if (hasDosDeviceSegment(rootRealPath) || hasDosDeviceSegment(targetRealPath)) {
    return { safe: false, reason: 'device_path' }
  }
  if (!isDriveAbsolute(rootRealPath) || !isDriveAbsolute(targetRealPath)) {
    return { safe: false, reason: 'path_not_absolute' }
  }

  const relative = path.win32.relative(rootRealPath, targetRealPath)
  const isOutside = relative === '..'
    || relative.startsWith(`..${path.win32.sep}`)
    || path.win32.isAbsolute(relative)
  if (isOutside) return { safe: false, reason: 'outside_root' }

  return { safe: true, relative_path: relative || '.' }
}
