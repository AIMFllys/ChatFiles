import crypto from 'node:crypto'
import type { AssetBundleBinding } from './assetBundleBinding.js'
import type {
  ConversationAssetCounts,
  ConversationAssetMetrics,
} from './conversationAssetBuilderSupport.js'

export function createAssetRunReceipt(input: {
  runId: string
  completedAt: string
  binding: AssetBundleBinding
  counts: ConversationAssetCounts
  metrics: ConversationAssetMetrics
}) {
  const payload = stableJson({
    schemaVersion: 2,
    runId: input.runId,
    completedAt: input.completedAt,
    binding: input.binding,
    counts: input.counts,
    metrics: input.metrics,
  })
  return `sha256:${crypto.createHash('sha256').update(payload, 'utf8').digest('hex')}`
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([key, item]) => [key, canonicalValue(item)]))
  }
  return value
}

export function stableJson(value: unknown) {
  return JSON.stringify(canonicalValue(value))
}
