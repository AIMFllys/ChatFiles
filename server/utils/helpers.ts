import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import mime from 'mime'
import type { DeepFileIndex, LibraryFile, LibraryManifest, SourceFileManifest } from '../../shared/contracts/index.js'
import { readActiveProductSet } from '../data/catalogReader.js'
import { readCatalogLibrary } from '../data/productReaders.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const root = path.resolve(__dirname, '..', '..')
export const audioCacheDir = path.join(root, 'work', 'audio-cache')

export function readJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
  } catch {
    return fallback
  }
}

export function library(projectRoot = root): LibraryManifest {
  return readCatalogLibrary(readActiveProductSet(projectRoot))
}

export function sourceLibrary(projectRoot = root): SourceFileManifest {
  const deepIndex = readJson<DeepFileIndex>(path.join(projectRoot, 'data', 'deep-index.json'), {
    generatedAt: new Date(0).toISOString(),
    roots: [],
    totals: {
      files: 0,
      directories: 0,
      bytes: 0,
      databaseCandidates: 0,
      textCandidates: 0,
      mediaCandidates: 0,
      attachmentCandidates: 0,
    },
    extensionStats: [],
    databaseCandidates: [],
    largestFiles: [],
    newestFiles: [],
    files: [],
  })
  const files = (deepIndex.files ?? []).map((item) => ({
    id: crypto.createHash('sha1').update(item.path).digest('hex').slice(0, 20),
    name: path.basename(item.path) || item.relativePath || item.path,
    ext: item.ext,
    mime: mime.getType(item.path) ?? 'application/octet-stream',
    size: item.size,
    modified: item.modified,
    root: item.root,
    relativePath: item.relativePath,
    sourcePath: item.path,
    sourceApp: item.sourceApp,
    preview: item.preview,
  }))
  return {
    generatedAt: deepIndex.generatedAt,
    roots: deepIndex.roots.filter((item) => item.exists).map((item) => item.path),
    files,
    stats: {
      files: deepIndex.totals.files,
      bytes: deepIndex.totals.bytes,
      databaseCandidates: deepIndex.totals.databaseCandidates,
      mediaCandidates: deepIndex.totals.mediaCandidates,
      textCandidates: deepIndex.totals.textCandidates,
    },
  }
}

export function resolveFile(id: string, projectRoot = root) {
  const item = library(projectRoot).files.find((file) => file.id === id)
  if (!item) return null
  const target = resolveArchiveTarget(projectRoot, item)
  if (!target) return null
  return { item, target }
}

function digestRegularFile(filename: string) {
  const hash = crypto.createHash('sha256')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  const handle = fs.openSync(filename, 'r')
  try {
    let read = 0
    do {
      read = fs.readSync(handle, buffer, 0, buffer.length, null)
      if (read > 0) hash.update(buffer.subarray(0, read))
    } while (read > 0)
  } finally { fs.closeSync(handle) }
  return hash.digest('hex')
}

export function resolveArchiveTarget(projectRoot: string, item: LibraryFile) {
  try {
    const archiveRoot = path.resolve(projectRoot, 'archive')
    const archiveStat = fs.lstatSync(archiveRoot)
    if (!archiveStat.isDirectory() || archiveStat.isSymbolicLink()) return null
    const archiveReal = fs.realpathSync(archiveRoot)
    const target = path.resolve(projectRoot, ...item.archivePath.split('/'))
    const lexicalRelative = path.relative(archiveRoot, target)
    if (!lexicalRelative || lexicalRelative === '..' || lexicalRelative.startsWith(`..${path.sep}`)
      || path.isAbsolute(lexicalRelative)) return null
    const targetStat = fs.lstatSync(target)
    if (!targetStat.isFile() || targetStat.isSymbolicLink() || targetStat.size !== item.size) return null
    const targetReal = fs.realpathSync(target)
    const realRelative = path.relative(archiveReal, targetReal)
    if (!realRelative || realRelative === '..' || realRelative.startsWith(`..${path.sep}`)
      || path.isAbsolute(realRelative) || digestRegularFile(targetReal) !== item.sha256) return null
    return targetReal
  } catch { return null }
}

export function resolveSourceFile(id: string) {
  const manifest = sourceLibrary()
  const item = manifest.files.find((file) => file.id === id)
  if (!item) return null
  const target = path.resolve(item.sourcePath)
  const allowedRoots = manifest.roots.map((itemRoot) => path.resolve(itemRoot))
  if (!allowedRoots.some((itemRoot) => target === itemRoot || target.startsWith(`${itemRoot}${path.sep}`))) return null
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return null
  return { item, target }
}

export function printableAscii(buffer: Buffer) {
  return [...buffer].map((byte) => (byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.')).join('')
}
