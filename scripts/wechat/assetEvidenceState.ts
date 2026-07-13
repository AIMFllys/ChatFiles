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


function hasNonemptyValue(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

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
