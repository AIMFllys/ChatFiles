import { createHash } from 'node:crypto'

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

function hasNonemptyValue(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim() !== ''
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
