import type { AgentContextSummary, AgentSummarySections } from '../types/aiAgent'

const sectionNames: Array<keyof AgentSummarySections> = [
  'facts', 'people', 'dates', 'quotes', 'decisions', 'disputes', 'openItems',
]

function shortText(value: unknown, maximum: number) {
  return typeof value === 'string' && value.length > 0 && [...value].length <= maximum
}

export function parseAgentContextSummary(value: unknown): AgentContextSummary | undefined {
  if (!value || typeof value !== 'object') return undefined
  const summary = value as Record<string, unknown>
  const range = summary.sourceRange as Record<string, unknown> | undefined
  const sections = summary.sections as Record<string, unknown> | undefined
  if (summary.version !== 1 || typeof summary.sourceHash !== 'string' || !/^[a-f0-9]{64}$/u.test(summary.sourceHash)) return undefined
  if (!range || !shortText(range.firstUid, 128) || !shortText(range.lastUid, 128)) return undefined
  if (!Number.isInteger(range.count) || Number(range.count) < 1 || Number(range.count) > 60) return undefined
  if (!sections) return undefined
  const normalized = {} as AgentSummarySections
  for (const name of sectionNames) {
    const items = sections[name]
    if (!Array.isArray(items) || items.length > 64) return undefined
    normalized[name] = []
    for (const value of items) {
      if (!value || typeof value !== 'object') return undefined
      const item = value as Record<string, unknown>
      if (!shortText(item.text, 2_000) || !Array.isArray(item.sourceUids) || item.sourceUids.length < 1 || item.sourceUids.length > 32) return undefined
      if (item.sourceUids.some((uid) => !shortText(uid, 128))) return undefined
      normalized[name].push({ text: item.text as string, sourceUids: [...new Set(item.sourceUids as string[])] })
    }
  }
  return {
    version: 1,
    sourceHash: summary.sourceHash,
    sourceRange: {
      firstUid: range.firstUid as string,
      lastUid: range.lastUid as string,
      count: Number(range.count),
    },
    sections: normalized,
  }
}
