import fs from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

import { loadLocalEnv, type LocalEnvironment } from '../../scripts/localEnv.js'
import type { ChatArtifactAvailability } from '../../src/types/chat.js'
import { root } from '../utils/helpers.js'

export type ArtifactSourcePurpose = 'content' | 'thumbnail'

export type ArtifactSourceAsset = {
  id: string
  conversationId: string | null
  category: 'work' | 'document' | 'skill' | 'link'
  kind: string
  name: string
  preview: string
  url: string | null
  createdAt: number
  senderName: string
  size: number | null
  materialization: string
  previewStatus: string
}

type InternalArtifactRow = {
  asset_id: string
  conv_id: string | null
  category: ArtifactSourceAsset['category']
  kind: string
  name: string
  preview: string
  url: string | null
  source_relative_path: string | null
  source_size: number | null
  created_at: number
  sender_name: string
  materialization: string
  preview_status: string
}

export type ArtifactSourceResolution =
  | { status: 'malformed' }
  | { status: 'unknown' }
  | { status: 'unsupported'; state: ChatArtifactAvailability; asset: ArtifactSourceAsset }
  | { status: 'unavailable'; state: ChatArtifactAvailability; asset: ArtifactSourceAsset }
  | {
      status: 'configuration_unavailable'
      state: 'source_unavailable'
      asset: ArtifactSourceAsset
    }
  | {
      status: 'available'
      state: 'ready' | 'thumbnail_only'
      asset: ArtifactSourceAsset
      target: string
    }

export type ArtifactSourceResolver = {
  resolve: (id: string, purpose: ArtifactSourcePurpose) => ArtifactSourceResolution
}

export type ArtifactSourceResolverOptions = {
  assetDb: DatabaseSync
  accountRoot?: string
  accountRootProvider?: (assetDb: DatabaseSync) => string | null
  projectRoot?: string
  environment?: LocalEnvironment
}

export type ArtifactAccountRootProviderOptions = Omit<ArtifactSourceResolverOptions, 'assetDb' | 'accountRootProvider'>

const matchingFailureStates = new Set<ChatArtifactAvailability>([
  'missing_source',
  'decrypt_failed',
  'source_ambiguous',
  'hash_mismatch',
])

const dosDevice = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu

function publicAsset(row: InternalArtifactRow): ArtifactSourceAsset {
  return {
    id: row.asset_id,
    conversationId: row.conv_id,
    category: row.category,
    kind: row.kind,
    name: row.name,
    preview: row.preview,
    url: row.url,
    createdAt: Number(row.created_at),
    senderName: row.sender_name,
    size: row.source_size === null ? null : Number(row.source_size),
    materialization: row.materialization,
    previewStatus: row.preview_status,
  }
}

function stateFor(row: InternalArtifactRow): ChatArtifactAvailability {
  if (row.materialization === 'exported' && row.preview_status === 'ready') return 'ready'
  if (row.materialization === 'exported' && row.preview_status === 'unsupported_codec') return 'unsupported_codec'
  if (row.materialization === 'exported' && row.preview_status === 'unavailable') return 'source_unavailable'
  if (row.materialization === 'thumbnail_only' && row.preview_status === 'thumbnail_only') return 'thumbnail_only'
  if (
    row.materialization === row.preview_status
    && matchingFailureStates.has(row.preview_status as ChatArtifactAvailability)
  ) {
    return row.preview_status as ChatArtifactAvailability
  }
  return 'source_unavailable'
}

function canonicalDirectory(candidate: string) {
  const real = fs.realpathSync(candidate)
  return fs.statSync(real).isDirectory() ? real : null
}

function accountRootFromOptions(
  options: ArtifactAccountRootProviderOptions,
  assetDb?: DatabaseSync,
) {
  try {
    if (options.accountRoot !== undefined) return canonicalDirectory(options.accountRoot)
    const projectRoot = options.projectRoot ?? root
    const environment = options.environment ?? { ...process.env }
    loadLocalEnv({ filePath: path.join(projectRoot, '.env.local'), environment })
    const configured = environment.WECHAT_STORE?.trim()
    if (!configured) return null
    const store = path.resolve(configured)
    if (path.basename(store).toLowerCase().startsWith('wxid_')) return canonicalDirectory(store)
    if (!fs.statSync(store).isDirectory()) return null
    const accounts = fs.readdirSync(store, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().startsWith('wxid_'))
      .map((entry) => path.join(store, entry.name))
    if (accounts.length === 1) return canonicalDirectory(accounts[0])
    return assetDb ? accountRootFromBundleEvidence(accounts, assetDb) : null
  } catch {
    return null
  }
}

export function createArtifactAccountRootProvider(options: ArtifactAccountRootProviderOptions) {
  let selected = false
  let accountRoot: string | null = null
  return (assetDb: DatabaseSync) => {
    if (!selected) {
      accountRoot = accountRootFromOptions(options, assetDb)
      selected = true
    }
    return accountRoot
  }
}

function safeSegments(relativePath: string) {
  if (!relativePath || relativePath.includes('\u0000')) return null
  if (path.posix.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)) return null
  if (/^[a-z]:/iu.test(relativePath) || /^(?:\\\\[?.]\\|\\\?\?\\)/u.test(relativePath)) return null
  const segments = relativePath.split(/[\\/]/u)
  if (segments.some((segment) => (
    !segment
    || segment === '.'
    || segment === '..'
    || segment.includes(':')
    || segment.endsWith('.')
    || segment.endsWith(' ')
    || dosDevice.test(segment)
  ))) return null
  return segments
}

function isContained(parent: string, child: string) {
  const relative = path.relative(parent, child)
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
}

function resolveTarget(accountRoot: string | null, row: InternalArtifactRow) {
  if (!accountRoot || row.source_size === null || !Number.isSafeInteger(row.source_size) || row.source_size < 0) {
    return null
  }
  const segments = row.source_relative_path ? safeSegments(row.source_relative_path) : null
  if (!segments) return null
  try {
    const lexicalTarget = path.resolve(accountRoot, ...segments)
    if (!isContained(accountRoot, lexicalTarget)) return null
    const target = fs.realpathSync(lexicalTarget)
    if (!isContained(accountRoot, target)) return null
    const stat = fs.statSync(target)
    if (!stat.isFile() || stat.size !== row.source_size) return null
    return target
  } catch {
    return null
  }
}

function accountRootFromBundleEvidence(accounts: readonly string[], assetDb: DatabaseSync) {
  const rows = assetDb.prepare(`
    SELECT source_relative_path, source_size
    FROM artifacts
    WHERE source_relative_path IS NOT NULL AND source_size IS NOT NULL
    ORDER BY asset_id
    LIMIT 128
  `).all() as InternalArtifactRow[]
  if (rows.length === 0) return null

  const scored = accounts.flatMap((candidate) => {
    try {
      const accountRoot = canonicalDirectory(candidate)
      if (!accountRoot) return []
      const matches = rows.reduce(
        (count, row) => count + (resolveTarget(accountRoot, row) ? 1 : 0),
        0,
      )
      return [{ accountRoot, matches }]
    } catch {
      return []
    }
  }).sort((left, right) => right.matches - left.matches)
  const best = scored[0]
  const runnerUp = scored[1]
  const minimumEvidence = Math.min(8, rows.length)
  if (!best || best.matches < minimumEvidence || best.matches === runnerUp?.matches) return null
  return best.accountRoot
}

export function createArtifactSourceResolver(
  options: ArtifactSourceResolverOptions,
): ArtifactSourceResolver {
  let accountRoot: string | null
  try {
    if (options.accountRootProvider) {
      const providedRoot = options.accountRootProvider(options.assetDb)
      accountRoot = providedRoot ? canonicalDirectory(providedRoot) : null
    } else {
      accountRoot = accountRootFromOptions(options, options.assetDb)
    }
  } catch {
    accountRoot = null
  }
  const find = options.assetDb.prepare(`
    SELECT asset_id, conv_id, category, kind, name, preview, url,
           source_relative_path, source_size, created_at, sender_name,
           materialization, preview_status
    FROM artifacts WHERE asset_id=?
  `)

  return {
    resolve(id, purpose) {
      if (!/^[0-9a-f]{64}$/u.test(id)) return { status: 'malformed' }
      const row = find.get(id) as InternalArtifactRow | undefined
      if (!row) return { status: 'unknown' }
      const asset = publicAsset(row)
      const state = stateFor(row)
      if (row.kind !== 'resource') return { status: 'unsupported', state, asset }

      const canRead = purpose === 'content'
        ? row.materialization === 'exported' && row.preview_status === 'ready'
        : (row.preview === 'image' || row.preview === 'video')
          && (
            (row.materialization === 'exported' && row.preview_status === 'ready')
            || (row.materialization === 'thumbnail_only' && row.preview_status === 'thumbnail_only')
          )
      if (!canRead) {
        if (purpose === 'thumbnail' && row.preview !== 'image' && row.preview !== 'video') {
          return { status: 'unsupported', state, asset }
        }
        return { status: 'unavailable', state, asset }
      }

      if (!accountRoot) return { status: 'configuration_unavailable', state: 'source_unavailable', asset }
      const target = resolveTarget(accountRoot, row)
      if (!target) return { status: 'unavailable', state: 'source_unavailable', asset }
      return { status: 'available', state: state === 'thumbnail_only' ? 'thumbnail_only' : 'ready', asset, target }
    },
  }
}
