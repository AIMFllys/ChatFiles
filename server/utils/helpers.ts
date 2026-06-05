import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import mime from 'mime'
import type { DeepFileIndex, LibraryManifest, SourceFileManifest } from '../../src/types.js'

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

export function library(): LibraryManifest {
  return readJson<LibraryManifest>(path.join(root, 'data', 'library.json'), {
    generatedAt: new Date(0).toISOString(),
    roots: [],
    files: [],
    stats: { discovered: 0, archived: 0, duplicatesSkipped: 0, bytes: 0 },
  })
}

export function sourceLibrary(): SourceFileManifest {
  const deepIndex = readJson<DeepFileIndex>(path.join(root, 'data', 'deep-index.json'), {
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

export function resolveFile(id: string) {
  const item = library().files.find((file) => file.id === id)
  if (!item) return null
  const target = path.resolve(root, item.archivePath)
  const archiveRoot = path.resolve(root, 'archive')
  if (!target.startsWith(archiveRoot)) return null
  return { item, target }
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
