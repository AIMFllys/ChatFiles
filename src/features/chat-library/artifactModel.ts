export type ArtifactKind = 'work' | 'document' | 'skill' | 'link' | 'chatText'

export type ChatLibrarySelection =
  | { kind: 'collection'; id: 'library' | 'outputs' }
  | { kind: 'conversation'; id: string }

export type ArtifactCandidate = {
  name: string
  preview?: string
  url?: string
  hasLocalFile?: boolean
  chatText?: boolean
}

export type ChatArtifact = {
  id: string
  kind: ArtifactKind
  available: boolean
}

const artifactTabOrder = ['all', 'work', 'document', 'skill', 'link', 'chatText'] as const
export type ArtifactTabId = typeof artifactTabOrder[number]

export type ArtifactCounts = Record<ArtifactKind, number> & {
  all: number
  available: number
  missing: number
}

const artifactAvailabilityLabels: Record<string, string> = {
  ready: '可预览',
  thumbnail_only: '仅可预览缩略图',
  missing_source: '未找到源文件',
  decrypt_failed: '待解密',
  source_ambiguous: '来源待确认',
  hash_mismatch: '文件校验不一致',
  unsupported_codec: '格式暂不支持',
  source_unavailable: '源文件不可用',
}

export function artifactAvailabilityLabel(availability: string) {
  return artifactAvailabilityLabels[availability] ?? '状态未知'
}

export function firstCodePoint(value: string, fallback: string) {
  return [...value.trim()][0] ?? fallback
}

const documentPreviews = new Set(['pdf', 'docx', 'sheet', 'presentation', 'markdown', 'text', 'json'])
const workPreviews = new Set(['image', 'video', 'audio', 'voice', 'html', 'code'])
const documentExtensions = /\.(?:pdf|docx?|pptx?|ppsx|xlsx?|csv|md|markdown|txt|rtf)$/i
const skillSignal = /(?:^|[\s/_.-])skills?(?:[\s/_.-]|$)|skill\.md|技能包|技能工具/i

const extensionPreviews: Array<[RegExp, string]> = [
  [/\.(?:png|jpe?g|gif|webp|bmp|svg|ico|apng|avif)$/iu, 'image'],
  [/\.(?:mp4|webm|mov|mkv)$/iu, 'video'],
  [/\.(?:amr|silk)$/iu, 'voice'],
  [/\.(?:mp3|wav|ogg|m4a)$/iu, 'audio'],
  [/\.pdf$/iu, 'pdf'],
  [/\.(?:docx?)$/iu, 'docx'],
  [/\.(?:xlsx?|csv)$/iu, 'sheet'],
  [/\.(?:pptx?|ppsx)$/iu, 'presentation'],
  [/\.(?:html?)$/iu, 'html'],
  [/\.(?:md|markdown)$/iu, 'markdown'],
  [/\.json$/iu, 'json'],
  [/\.(?:txt|log|xml|ya?ml|toml|ini|cfg|conf)$/iu, 'text'],
  [/\.(?:zip|rar|7z)$/iu, 'archive'],
  [/\.(?:py|js|jsx|ts|tsx|css|vue|c|h|cpp|java)$/iu, 'code'],
]

export function previewForArtifactName(name: string, claimedPreview: string) {
  return extensionPreviews.find(([pattern]) => pattern.test(name.trim()))?.[1] ?? claimedPreview
}

export function safeExternalUrl(value: string) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null
  } catch {
    return null
  }
}

export function nextArtifactTab(current: ArtifactTabId, key: string): ArtifactTabId {
  if (key === 'Home') return artifactTabOrder[0]
  if (key === 'End') return artifactTabOrder[artifactTabOrder.length - 1]
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return current
  const direction = key === 'ArrowRight' ? 1 : -1
  const index = artifactTabOrder.indexOf(current)
  return artifactTabOrder[(index + direction + artifactTabOrder.length) % artifactTabOrder.length]
}

export function classifyArtifact(candidate: ArtifactCandidate): ArtifactKind {
  const name = candidate.name.trim()
  const preview = candidate.preview?.toLowerCase() ?? ''

  if (skillSignal.test(name)) return 'skill'
  if (documentPreviews.has(preview) || documentExtensions.test(name)) return 'document'
  if (workPreviews.has(preview)) return 'work'
  if (candidate.url) return 'link'
  if (candidate.chatText) return 'chatText'
  return 'work'
}

export function countArtifacts(artifacts: readonly ChatArtifact[]): ArtifactCounts {
  const counts: ArtifactCounts = {
    all: 0,
    work: 0,
    document: 0,
    skill: 0,
    link: 0,
    chatText: 0,
    available: 0,
    missing: 0,
  }

  for (const artifact of artifacts) {
    counts[artifact.kind] += 1
    if (artifact.kind !== 'chatText') counts.all += 1
    if (artifact.available) counts.available += 1
    else counts.missing += 1
  }
  return counts
}

export function artifactRequestUrl(input: {
  selection: ChatLibrarySelection
  tab: 'all' | ArtifactKind
  query: string
  offset: number
  limit: number
}) {
  const base = input.selection.kind === 'conversation'
    ? `/api/wechat/conversation/${encodeURIComponent(input.selection.id)}/artifacts`
    : '/api/wechat/artifacts'
  const params = new URLSearchParams({ tab: input.tab })
  if (input.query) params.set('q', input.query)
  params.set('offset', String(input.offset))
  params.set('limit', String(input.limit))
  return `${base}?${params.toString()}`
}
