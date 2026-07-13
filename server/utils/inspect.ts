import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import mime from 'mime'
import JSZip from 'jszip'
import type { ArchivePreview, DatabasePreview, FileInspection } from '../../shared/contracts/index.js'
import { printableAscii } from './helpers.js'

function fileHeader(filePath: string) {
  const fd = fs.openSync(filePath, 'r')
  try {
    const buffer = Buffer.alloc(96)
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0)
    return [...buffer.subarray(0, bytesRead)].map((byte) => byte.toString(16).padStart(2, '0')).join(' ')
  } finally {
    fs.closeSync(fd)
  }
}

function cleanVisibleText(value: string) {
  return value
    .split('\u0000')
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

function collectStrings(decoded: string, encoding: FileInspection['strings'][number]['encoding'], limit: number) {
  const out: FileInspection['strings'] = []
  const pattern = new RegExp('[\\u4e00-\\u9fffA-Za-z0-9_@#:/?&=.,;，。！？、（）()《》【】\\[\\]+ "\'\\n\\r\\t-]{10,360}', 'g')
  let match: RegExpExecArray | null
  while ((match = pattern.exec(decoded)) && out.length < limit) {
    const text = cleanVisibleText(match[0])
    const compact = text.replace(/\s+/g, '')
    if (compact.length < 10) continue
    if (/^[0-9a-f_:\-./\\]{20,}$/i.test(compact)) continue
    if (/(.)\1{18,}/.test(compact)) continue
    out.push({ offset: match.index, encoding, text: text.slice(0, 260) })
  }
  return out
}

export function inspectFile(filePath: string): FileInspection {
  const stat = fs.statSync(filePath)
  const sampleSize = Math.min(stat.size, 2 * 1024 * 1024)
  const fd = fs.openSync(filePath, 'r')
  try {
    const sample = Buffer.alloc(sampleSize)
    const bytesRead = sampleSize ? fs.readSync(fd, sample, 0, sampleSize, 0) : 0
    const data = sample.subarray(0, bytesRead)
    const header = data.subarray(0, 128)
    const strings = [
      ...collectStrings(data.toString('utf8'), 'utf8', 36),
      ...collectStrings(data.toString('utf16le'), 'utf16le', 24),
    ]
    const seen = new Set<string>()
    return {
      path: filePath,
      size: stat.size,
      modified: stat.mtime.toISOString(),
      mime: mime.getType(filePath) ?? 'application/octet-stream',
      ext: path.extname(filePath).toLowerCase() || '[none]',
      headerHex: [...header].map((byte) => byte.toString(16).padStart(2, '0')).join(' '),
      headerAscii: printableAscii(header),
      sampledBytes: bytesRead,
      strings: strings.filter((item) => {
        const key = `${item.encoding}:${item.text}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      }).slice(0, 48),
    }
  } finally {
    fs.closeSync(fd)
  }
}

export async function inspectArchive(filePath: string): Promise<ArchivePreview> {
  const stat = fs.statSync(filePath)
  const ext = path.extname(filePath).toLowerCase()
  const base = {
    path: filePath,
    size: stat.size,
    modified: stat.mtime.toISOString(),
    format: ext || '[none]',
  }
  if (ext === '.zip') {
    try {
      const zip = await JSZip.loadAsync(fs.readFileSync(filePath))
      return {
        ...base,
        readable: true,
        entries: Object.values(zip.files)
          .slice(0, 600)
          .map((entry) => ({
            name: entry.name,
            size: (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize,
            directory: entry.dir,
          })),
      }
    } catch (error) {
      return {
        ...base,
        readable: false,
        error: error instanceof Error ? error.message : String(error),
        entries: [],
      }
    }
  }

  try {
    const output = execFileSync('tar', ['-tf', filePath], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: 15000,
      windowsHide: true,
    })
    return {
      ...base,
      readable: true,
      entries: output
        .split(/\r?\n/)
        .map((name) => name.trim())
        .filter(Boolean)
        .slice(0, 600)
        .map((name) => ({
          name,
          directory: name.endsWith('/'),
        })),
    }
  } catch (error) {
    return {
      ...base,
      readable: false,
      error: error instanceof Error ? error.message : String(error),
      entries: [],
    }
  }
}

function quoteIdent(value: string) {
  return `"${value.replace(/"/g, '""')}"`
}

export function inspectSqlite(filePath: string): DatabasePreview {
  const stat = fs.statSync(filePath)
  const base = {
    path: filePath,
    size: stat.size,
    modified: stat.mtime.toISOString(),
    header: fileHeader(filePath),
    tables: [],
  }
  try {
    const db = new DatabaseSync(filePath, { readOnly: true })
    const tableRows = db
      .prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name limit 80")
      .all() as Array<{ name: string }>
    const tables = tableRows.map((table) => {
      const columns = db.prepare(`pragma table_info(${quoteIdent(table.name)})`).all() as Array<{ name: string; type: string }>
      let rowCount: number | undefined
      try {
        const row = db.prepare(`select count(*) as count from ${quoteIdent(table.name)}`).get() as { count: number }
        rowCount = Number(row.count)
      } catch {
        rowCount = undefined
      }
      return {
        name: table.name,
        rowCount,
        columns: columns.map((column) => ({ name: column.name, type: column.type || 'UNKNOWN' })),
      }
    })
    db.close()
    return { ...base, readable: true, tables }
  } catch (error) {
    return {
      ...base,
      readable: false,
      error: error instanceof Error ? error.message : String(error),
      tables: [],
    }
  }
}
