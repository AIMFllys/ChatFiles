export type Category =
  | '过去'
  | '创业'
  | 'AI'
  | '树林'
  | '学业'
  | '专业'
  | '比赛'
  | '生活'
  | '健康'
  | '项目'
  | '财务'
  | '旅行'
  | '阅读'
  | '工具'
  | '人物'
  | '素材'
  | '未归类'

export type LibraryFile = {
  id: string
  name: string
  ext: string
  mime: string
  size: number
  modified: string
  category: Category
  subcategory: string[]
  archivePath: string
  sourcePath: string
  sourceApp: 'QQ' | '微信' | '企业微信' | '未知'
  preview:
    | 'image'
    | 'video'
    | 'audio'
    | 'voice'
    | 'pdf'
    | 'docx'
    | 'sheet'
    | 'text'
    | 'markdown'
    | 'code'
    | 'html'
    | 'json'
    | 'presentation'
    | 'archive'
    | 'database'
    | 'font'
    | 'download'
  sha256: string
}

export type DatabasePreview = {
  path: string
  size: number
  modified: string
  readable: boolean
  header: string
  error?: string
  tables: Array<{
    name: string
    rowCount?: number
    columns: Array<{
      name: string
      type: string
    }>
  }>
}

export type FileInspection = {
  path: string
  size: number
  modified: string
  mime: string
  ext: string
  headerHex: string
  headerAscii: string
  sampledBytes: number
  strings: Array<{
    offset: number
    encoding: 'utf8' | 'utf16le'
    text: string
  }>
}

export type ArchivePreview = {
  path: string
  size: number
  modified: string
  format: string
  readable: boolean
  error?: string
  entries: Array<{
    name: string
    size?: number
    directory: boolean
  }>
}

export type VoicePreview = {
  path: string
  size: number
  modified: string
  sourceFormat: string
  codecHint?: string
  playable: boolean
  durationSeconds?: number
  transcodedUrl?: string
  error?: string
}

export type LibraryManifest = {
  generatedAt: string
  roots: string[]
  files: LibraryFile[]
  stats: {
    discovered: number
    archived: number
    duplicatesSkipped: number
    bytes: number
  }
}

export type SourceIndexedFile = {
  id: string
  name: string
  ext: string
  mime: string
  size: number
  modified: string
  root: string
  relativePath: string
  sourcePath: string
  sourceApp: LibraryFile['sourceApp']
  preview: LibraryFile['preview']
}

export type SourceFileManifest = {
  generatedAt: string
  roots: string[]
  files: SourceIndexedFile[]
  stats: {
    files: number
    bytes: number
    databaseCandidates: number
    mediaCandidates: number
    textCandidates: number
  }
}

export type SourceDiscovery = {
  generatedAt: string
  roots: Array<{
    path: string
    exists: boolean
    candidateCount: number
    candidateBytes: number
    note: string
  }>
  directoryMap: Array<{
    path: string
    exists: boolean
    files: number
    bytes: number
    newest?: string
    focus: string
  }>
  databases: Array<{
    path: string
    exists: boolean
    size: number
    readable: boolean
    detail: string
  }>
  wideMatches?: Array<{
    path: string
    exists: boolean
    files: number
    bytes: number
    newest?: string
    depth: number
    reason: string
    focus: string
  }>
  topCandidates: Array<{
    path: string
    size: number
    modified: string
    kind: string
  }>
}

export type DeepFileIndex = {
  generatedAt: string
  roots: Array<{
    path: string
    exists: boolean
    files: number
    directories: number
    bytes: number
    newest?: string
    oldest?: string
  }>
  totals: {
    files: number
    directories: number
    bytes: number
    databaseCandidates: number
    textCandidates: number
    mediaCandidates: number
    attachmentCandidates: number
  }
  extensionStats: Array<{
    ext: string
    files: number
    bytes: number
  }>
  databaseCandidates: Array<{
    path: string
    size: number
    modified: string
    header: string
    readable: boolean
    detail: string
  }>
  largestFiles: Array<{
    path: string
    size: number
    modified: string
    ext: string
  }>
  newestFiles: Array<{
    path: string
    size: number
    modified: string
    ext: string
  }>
  files?: Array<{
    path: string
    root: string
    relativePath: string
    size: number
    modified: string
    ext: string
    preview: LibraryFile['preview']
    sourceApp: LibraryFile['sourceApp']
  }>
}
