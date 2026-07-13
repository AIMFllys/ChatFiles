import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { TextDecoder } from 'node:util'

const MAX_SOURCE_LINES = 300
const SOURCE_ROOTS = new Set(['shared', 'src', 'server', 'scripts', 'tools'])
const SOURCE_EXTENSIONS = new Set([
  '.c',
  '.cjs',
  '.css',
  '.cts',
  '.go',
  '.h',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
])
const TEXT_EXTENSIONS = new Set([
  ...SOURCE_EXTENSIONS,
  '.example',
  '.html',
  '.json',
  '.md',
  '.mod',
  '.ps1',
  '.sh',
  '.sum',
  '.svg',
  '.toml',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
])
const TEXT_FILENAMES = new Set(['.gitignore', 'AGENTS.md', 'Dockerfile', 'LICENSE'])
const PRIVATE_ROOTS = new Set(['.uploads', 'archive', 'data', 'imports', 'secrets', 'work'])
const PRIVATE_EXTENSIONS = new Set([
  '.db',
  '.db-shm',
  '.db-wal',
  '.exe',
  '.key',
  '.keystore',
  '.p12',
  '.pem',
  '.pfx',
  '.sqlite',
  '.sqlite3',
])

export interface RepositoryBaseline {
  allowedReplacementSignatures: string[]
  oversizedLineCaps: Record<string, number>
}

export interface RepositoryIssue {
  kind: 'invalid-utf8' | 'privacy-path' | 'replacement-character' | 'source-size'
  path: string
  signature: string
  message: string
}

export const EMPTY_REPOSITORY_BASELINE: RepositoryBaseline = {
  allowedReplacementSignatures: [],
  oversizedLineCaps: {},
}

function portable(candidate: string) {
  return candidate.replaceAll('\\', '/').replace(/^\.\//u, '')
}

export function listGitCandidateFiles(root: string) {
  const output = execFileSync(
    'git',
    ['-c', 'core.quotepath=false', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'buffer' },
  )
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(output)
  return decoded.split('\0').filter(Boolean).map(portable).sort()
}

function isSourceFile(relativePath: string) {
  const normalized = portable(relativePath)
  const root = normalized.split('/')[0]
  return Boolean(root && SOURCE_ROOTS.has(root) && SOURCE_EXTENSIONS.has(path.extname(normalized).toLowerCase()))
}

function physicalLineCount(content: Buffer) {
  if (content.length === 0) return 0
  let newlines = 0
  for (const byte of content) {
    if (byte === 0x0a) newlines += 1
  }
  return content.at(-1) === 0x0a ? newlines : newlines + 1
}

function readRegularCandidate(root: string, relativePath: string) {
  const target = path.join(root, relativePath)
  try {
    if (!fs.lstatSync(target).isFile()) return undefined
    return fs.readFileSync(target)
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      return undefined
    }
    throw error
  }
}

export function inspectSourceSizes(
  root: string,
  relativePaths: readonly string[],
  baseline: RepositoryBaseline = EMPTY_REPOSITORY_BASELINE,
) {
  const issues: RepositoryIssue[] = []
  for (const candidate of [...new Set(relativePaths.map(portable))].sort()) {
    if (!isSourceFile(candidate)) continue
    const content = readRegularCandidate(root, candidate)
    if (!content) continue
    const lineCount = physicalLineCount(content)
    const baselineCap = baseline.oversizedLineCaps[candidate]
    const allowedLines = Math.max(MAX_SOURCE_LINES, baselineCap ?? MAX_SOURCE_LINES)
    if (lineCount <= allowedLines) continue
    const suffix = baselineCap ? `; baseline ceiling ${baselineCap}` : ''
    issues.push({
      kind: 'source-size',
      path: candidate,
      signature: `source-size:${candidate}:${lineCount}`,
      message: `${candidate} has ${lineCount} lines; maximum ${MAX_SOURCE_LINES}${suffix}`,
    })
  }
  return issues
}

function isTextFile(relativePath: string) {
  const basename = path.basename(relativePath)
  return TEXT_FILENAMES.has(basename) || TEXT_EXTENSIONS.has(path.extname(basename).toLowerCase())
}

function replacementIssues(relativePath: string, content: string) {
  const issues: RepositoryIssue[] = []
  let line = 1
  let column = 1
  for (const character of content) {
    if (character === '\uFFFD') {
      const signature = `replacement-character:${relativePath}:${line}:${column}`
      issues.push({
        kind: 'replacement-character',
        path: relativePath,
        signature,
        message: `${relativePath} contains U+FFFD at ${line}:${column}`,
      })
    }
    if (character === '\n') {
      line += 1
      column = 1
    } else {
      column += 1
    }
  }
  return issues
}

export function inspectUtf8Files(
  root: string,
  relativePaths: readonly string[],
  baseline: RepositoryBaseline = EMPTY_REPOSITORY_BASELINE,
) {
  const allowed = new Set(baseline.allowedReplacementSignatures)
  const issues: RepositoryIssue[] = []
  for (const candidate of [...new Set(relativePaths.map(portable))].sort()) {
    if (!isTextFile(candidate)) continue
    const source = readRegularCandidate(root, candidate)
    if (!source) continue
    let content: string
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(source)
    } catch {
      issues.push({
        kind: 'invalid-utf8',
        path: candidate,
        signature: `invalid-utf8:${candidate}`,
        message: `${candidate} is not valid UTF-8`,
      })
      continue
    }
    issues.push(...replacementIssues(candidate, content).filter((issue) => !allowed.has(issue.signature)))
  }
  return issues
}

function privacyReason(relativePath: string) {
  const normalized = portable(relativePath)
  const lower = normalized.toLowerCase()
  const segments = lower.split('/')
  const basename = segments.at(-1) ?? ''
  if (segments[0] && PRIVATE_ROOTS.has(segments[0])) return `private root ${segments[0]}`
  if (lower === 'docs/tmp' || lower.startsWith('docs/tmp/')) return 'private temporary documentation'
  if ((basename === '.env' || basename.startsWith('.env.')) && basename !== '.env.example') return 'private environment file'
  if (basename === 'image_key.json') return 'private image key'
  if (basename.startsWith('secrets.')) return 'private secrets file'
  if (PRIVATE_EXTENSIONS.has(path.extname(basename).toLowerCase())) return 'private file extension'
  if (/^scripts\/exportip.*\.mjs$/u.test(lower)) return 'private export helper'
  if (/^scripts\/(batch_.*_insights_data|missing.*_overrides)\.json$/u.test(lower)) return 'private local override'
  return undefined
}

export function inspectPrivacyPaths(relativePaths: readonly string[]) {
  return [...new Set(relativePaths.map(portable))].sort().flatMap((candidate): RepositoryIssue[] => {
    const reason = privacyReason(candidate)
    if (!reason) return []
    return [{
      kind: 'privacy-path',
      path: candidate,
      signature: `privacy-path:${candidate}`,
      message: `${candidate} must not be tracked or offered for commit (${reason})`,
    }]
  })
}
