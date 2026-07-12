import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { LibraryFile, LibraryManifest } from '../src/types.js'
import type { ArchiveIntegrityIssue } from './archivePlan.js'
import type { ArchiveSourceIssue } from './archiveSources.js'
import { sha256File } from './shared.js'

export type LibraryManifestSource = 'current' | 'legacy' | 'none'

export type LibraryBundleReceiptInput = {
  generatedAt: string
  previousSource: LibraryManifestSource
  previousManifestSha256?: string
  plannedCopies: number
  completedCopies: number
  reusedHashes: number
  reusedCopies: number
  sourceIssues: ArchiveSourceIssue[]
  integrityIssues: ArchiveIntegrityIssue[]
}

export type LibraryBundleReceipt = LibraryBundleReceiptInput & {
  formatVersion: 1
  bundle: 'library.next'
  runId: string
  manifestFile: 'manifest.json'
  manifestSha256: string
}

export type LibraryManifestResolution = {
  source: LibraryManifestSource
  selectedPath: string | null
  currentPath: string
  legacyPath: string
  manifest?: LibraryManifest
  manifestSha256?: string
}

export type StagedLibraryBundle = {
  stagingDirectory: string
  manifestPath: string
  receiptPath: string
  expectedManifestSha256: string
}

type PublishLibraryBundleInput = {
  dataDirectory: string
  runId: string
  manifest: LibraryManifest
  receipt: LibraryBundleReceiptInput
}

const categories = new Set([
  '过去',
  '创业',
  'AI',
  '树林',
  '学业',
  '专业',
  '比赛',
  '生活',
  '健康',
  '项目',
  '财务',
  '旅行',
  '阅读',
  '工具',
  '人物',
  '素材',
  '未归类',
])
const sourceApps = new Set(['QQ', '微信', '企业微信', '未知'])
const previews = new Set([
  'image',
  'video',
  'audio',
  'voice',
  'pdf',
  'docx',
  'sheet',
  'text',
  'markdown',
  'code',
  'html',
  'json',
  'presentation',
  'archive',
  'database',
  'font',
  'download',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function validArchivePath(value: string) {
  if (value.includes('\\') || !value.startsWith('archive/')) return false
  const normalized = path.posix.normalize(value)
  return normalized === value && !normalized.split('/').includes('..')
}

function assertLibraryFile(value: unknown, index: number): asserts value is LibraryFile {
  if (!isRecord(value)) throw new Error(`Library file ${index} is invalid`)
  const strings = ['id', 'name', 'ext', 'mime', 'modified', 'archivePath', 'sourcePath', 'sha256'] as const
  if (strings.some((key) => typeof value[key] !== 'string')) throw new Error(`Library file ${index} is invalid`)
  if (!isNonNegativeInteger(value.size)) throw new Error(`Library file ${index} is invalid`)
  if (!categories.has(value.category as string) || !isStringArray(value.subcategory)) {
    throw new Error(`Library file ${index} is invalid`)
  }
  if (!sourceApps.has(value.sourceApp as string) || !previews.has(value.preview as string)) {
    throw new Error(`Library file ${index} is invalid`)
  }
  if (!/^[a-f0-9]{64}$/.test(value.sha256 as string) || !validArchivePath(value.archivePath as string)) {
    throw new Error(`Library file ${index} is invalid`)
  }
  if (Number.isNaN(Date.parse(value.modified as string))) throw new Error(`Library file ${index} is invalid`)
}

export function validateLibraryManifest(value: unknown): LibraryManifest {
  if (!isRecord(value) || typeof value.generatedAt !== 'string' || Number.isNaN(Date.parse(value.generatedAt))) {
    throw new Error('Library manifest metadata is invalid')
  }
  if (!isStringArray(value.roots) || !Array.isArray(value.files) || !isRecord(value.stats)) {
    throw new Error('Library manifest structure is invalid')
  }
  value.files.forEach(assertLibraryFile)
  const files = value.files as LibraryFile[]
  const { discovered, archived, duplicatesSkipped, bytes } = value.stats
  if (
    !isNonNegativeInteger(discovered) ||
    !isNonNegativeInteger(archived) ||
    !isNonNegativeInteger(duplicatesSkipped) ||
    !isNonNegativeInteger(bytes) ||
    archived !== files.length ||
    bytes !== files.reduce((sum, file) => sum + file.size, 0)
  ) {
    throw new Error('Library manifest statistics are invalid')
  }

  const hashes = new Set<string>()
  const archivePaths = new Set<string>()
  for (const file of files) {
    const archiveKey = file.archivePath.toLowerCase()
    if (hashes.has(file.sha256) || archivePaths.has(archiveKey)) {
      throw new Error('Library manifest contains duplicate files')
    }
    hashes.add(file.sha256)
    archivePaths.add(archiveKey)
  }
  return value as LibraryManifest
}

function assertSafeDirectory(candidate: string) {
  const stat = fs.lstatSync(candidate)
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Unsafe directory: ${candidate}`)
  return fs.realpathSync(candidate)
}

function assertContained(baseRealPath: string, candidateRealPath: string) {
  const relative = path.relative(baseRealPath, candidateRealPath)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Library path escapes its data directory')
  }
}

function readStrictJsonFile(filePath: string, containedBy: string) {
  const stat = fs.lstatSync(filePath)
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Library manifest path is not a regular file')
  assertContained(containedBy, fs.realpathSync(filePath))
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(filePath))
  } catch {
    throw new Error('Library JSON must be valid UTF-8')
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error('Library JSON is malformed')
  }
}

function manifestJson(manifest: LibraryManifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

function jsonSha256(value: string) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex')
}

function validateReceiptInput(receipt: LibraryBundleReceiptInput, manifest: LibraryManifest) {
  if (receipt.generatedAt !== manifest.generatedAt || Number.isNaN(Date.parse(receipt.generatedAt))) {
    throw new Error('Library receipt timestamp does not match its manifest')
  }
  if (!new Set<LibraryManifestSource>(['current', 'legacy', 'none']).has(receipt.previousSource)) {
    throw new Error('Library receipt previous source is invalid')
  }
  for (const value of [
    receipt.plannedCopies,
    receipt.completedCopies,
    receipt.reusedHashes,
    receipt.reusedCopies,
  ]) {
    if (!isNonNegativeInteger(value)) throw new Error('Library receipt counters are invalid')
  }
  if (receipt.completedCopies !== receipt.plannedCopies) {
    throw new Error('Library receipt cannot publish an incomplete copy plan')
  }
  if (!Array.isArray(receipt.sourceIssues) || !Array.isArray(receipt.integrityIssues)) {
    throw new Error('Library receipt issues are invalid')
  }
  if (receipt.previousManifestSha256 !== undefined && !/^[a-f0-9]{64}$/.test(receipt.previousManifestSha256)) {
    throw new Error('Library receipt previous manifest hash is invalid')
  }
}

function writeExclusive(filePath: string, value: unknown) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
}

async function validateStagedLibraryBundle(bundle: StagedLibraryBundle) {
  const stagingRealPath = assertSafeDirectory(bundle.stagingDirectory)
  const manifest = validateLibraryManifest(readStrictJsonFile(bundle.manifestPath, stagingRealPath))
  const receiptValue = readStrictJsonFile(bundle.receiptPath, stagingRealPath)
  if (!isRecord(receiptValue)) throw new Error('Library receipt is invalid')
  const actualManifestSha256 = await sha256File(bundle.manifestPath)
  if (
    actualManifestSha256 !== bundle.expectedManifestSha256 ||
    receiptValue.manifestSha256 !== actualManifestSha256 ||
    receiptValue.generatedAt !== manifest.generatedAt ||
    receiptValue.formatVersion !== 1 ||
    receiptValue.bundle !== 'library.next' ||
    receiptValue.manifestFile !== 'manifest.json'
  ) {
    throw new Error('Staged library bundle failed validation')
  }
}

export async function publishLibraryNextBundle(
  input: PublishLibraryBundleInput,
  additionalValidation?: (bundle: StagedLibraryBundle) => void | Promise<void>,
) {
  if (!/^[0-9A-Za-z._-]+$/.test(input.runId)) throw new Error('Library run id contains unsafe path characters')
  const manifest = validateLibraryManifest(input.manifest)
  validateReceiptInput(input.receipt, manifest)
  const dataDirectory = path.resolve(input.dataDirectory)
  const dataRealPath = assertSafeDirectory(dataDirectory)
  const finalDirectory = path.join(dataDirectory, 'library.next')
  const stagingDirectory = path.join(dataDirectory, `.library.next.${input.runId}.staging`)
  assertContained(dataRealPath, path.resolve(finalDirectory))
  assertContained(dataRealPath, path.resolve(stagingDirectory))
  if (fs.existsSync(finalDirectory)) throw new Error(`Library final bundle already exists: ${finalDirectory}`)
  if (fs.existsSync(stagingDirectory)) throw new Error(`Library staging bundle already exists: ${stagingDirectory}`)

  const serializedManifest = manifestJson(manifest)
  const manifestSha256 = jsonSha256(serializedManifest)
  const receipt: LibraryBundleReceipt = {
    ...input.receipt,
    formatVersion: 1,
    bundle: 'library.next',
    runId: input.runId,
    manifestFile: 'manifest.json',
    manifestSha256,
  }
  fs.mkdirSync(stagingDirectory)
  const manifestPath = path.join(stagingDirectory, 'manifest.json')
  const receiptPath = path.join(stagingDirectory, 'receipt.json')
  fs.writeFileSync(manifestPath, serializedManifest, { encoding: 'utf8', flag: 'wx' })
  writeExclusive(receiptPath, receipt)
  const staged = { stagingDirectory, manifestPath, receiptPath, expectedManifestSha256: manifestSha256 }
  await validateStagedLibraryBundle(staged)
  await additionalValidation?.(staged)
  if (fs.existsSync(finalDirectory)) throw new Error(`Library final bundle already exists: ${finalDirectory}`)
  fs.renameSync(stagingDirectory, finalDirectory)
  return { finalDirectory, manifestPath: path.join(finalDirectory, 'manifest.json'), receipt }
}

export function readLibraryManifestForArchive(dataDirectoryInput: string): LibraryManifestResolution {
  const dataDirectory = path.resolve(dataDirectoryInput)
  const currentDirectory = path.join(dataDirectory, 'library.current')
  const currentPath = path.join(currentDirectory, 'manifest.json')
  const legacyPath = path.join(dataDirectory, 'library.json')
  const dataRealPath = assertSafeDirectory(dataDirectory)

  if (fs.existsSync(currentDirectory)) {
    let manifest: LibraryManifest
    try {
      const currentRealPath = assertSafeDirectory(currentDirectory)
      assertContained(dataRealPath, currentRealPath)
      if (!fs.existsSync(currentPath)) throw new Error('Current manifest is missing')
      manifest = validateLibraryManifest(readStrictJsonFile(currentPath, currentRealPath))
    } catch (error) {
      throw new Error('Current manifest is invalid; refusing legacy fallback', { cause: error })
    }
    const serialized = manifestJson(manifest)
    return {
      source: 'current',
      selectedPath: currentPath,
      currentPath,
      legacyPath,
      manifest,
      manifestSha256: jsonSha256(serialized),
    }
  }

  if (fs.existsSync(legacyPath)) {
    let manifest: LibraryManifest
    try {
      manifest = validateLibraryManifest(readStrictJsonFile(legacyPath, dataRealPath))
    } catch (error) {
      throw new Error('Legacy manifest is invalid', { cause: error })
    }
    return {
      source: 'legacy',
      selectedPath: legacyPath,
      currentPath,
      legacyPath,
      manifest,
      manifestSha256: jsonSha256(manifestJson(manifest)),
    }
  }

  return { source: 'none', selectedPath: null, currentPath, legacyPath }
}
