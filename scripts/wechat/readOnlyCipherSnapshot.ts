import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import Database from 'better-sqlite3-multiple-ciphers'
import { readStableWalState, type SafeWalState } from './walState.js'

export type CipherSnapshotErrorCode =
  | 'KEY_LENGTH_INVALID'
  | 'DATABASE_READ_FAILED'
  | 'DESTINATION_RESERVE_FAILED'
  | 'BACKUP_FAILED'
  | 'VALIDATION_OPEN_FAILED'
  | 'INTEGRITY_CHECK_FAILED'
  | 'SCHEMA_MISMATCH'

export class CipherSnapshotError extends Error {
  readonly code: CipherSnapshotErrorCode

  constructor(code: CipherSnapshotErrorCode) {
    super(code)
    this.name = 'CipherSnapshotError'
    this.code = code
  }
}

export interface CipherStatement {
  all(...parameters: unknown[]): unknown[]
}

export interface CipherDatabase {
  pragma(source: string, options?: unknown): unknown
  key?(key: Buffer): number
  exec(source: string): unknown
  prepare(source: string): CipherStatement
  backup?(destination: string): Promise<unknown>
  close(): void
}

export interface CipherSnapshotAdapter {
  open(filename: string, options: { readonly: boolean; fileMustExist: boolean }): CipherDatabase
}

export interface SnapshotFileIo {
  reserveNewFile(filePath: string): Promise<void>
}

const schemaQuery = `
  SELECT type, name, tbl_name, rootpage, sql
  FROM sqlite_schema
  ORDER BY type, name, tbl_name, rootpage
`

function schemaSnapshot(database: CipherDatabase) {
  const rows = database.prepare(schemaQuery).all()
  const serialized = JSON.stringify(rows, (_key, value: unknown) => (
    typeof value === 'bigint' ? value.toString() : value
  ))
  return {
    count: rows.length,
    fingerprint: crypto.createHash('sha256').update(serialized, 'utf8').digest('base64url'),
  }
}

function integrityIsOk(result: unknown) {
  if (!Array.isArray(result) || result.length === 0) return false
  return result.every((row) => (
    row !== null
    && typeof row === 'object'
    && Object.values(row as Record<string, unknown>).every((value) => value === 'ok')
  ))
}

function isReadonlyCantInit(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const sqliteError = error as { code?: unknown; errno?: unknown }
  return sqliteError.code === 'SQLITE_READONLY_CANTINIT' || sqliteError.errno === 1288
}

export const nodeSnapshotFileIo: SnapshotFileIo = {
  async reserveNewFile(filePath) {
    const handle = await fs.open(filePath, 'wx')
    await handle.close()
  },
}

export const betterSqliteSnapshotAdapter: CipherSnapshotAdapter = {
  open(filename, options) {
    return new Database(filename, options) as unknown as CipherDatabase
  },
}

function encryptedFileUri(sourcePath: string) {
  const uri = pathToFileURL(sourcePath)
  uri.searchParams.set('readonly_shm', '1')
  return uri.href
}

export async function snapshotCipherDatabase(options: {
  sourcePath: string
  destinationPath: string
  key: Buffer
  adapter?: CipherSnapshotAdapter
  fileIo?: SnapshotFileIo
  readWalState?: (databasePath: string) => Promise<SafeWalState>
  maxCantInitRetries?: number
}) {
  const adapter = options.adapter ?? betterSqliteSnapshotAdapter
  const fileIo = options.fileIo ?? nodeSnapshotFileIo
  const inspectWal = options.readWalState ?? readStableWalState
  const maxCantInitRetries = options.maxCantInitRetries ?? 2
  if (!Number.isSafeInteger(maxCantInitRetries) || maxCantInitRetries < 0) {
    options.key.fill(0)
    throw new RangeError('maxCantInitRetries')
  }
  if (options.key.length !== 32) {
    options.key.fill(0)
    throw new CipherSnapshotError('KEY_LENGTH_INVALID')
  }

  let destinationReserved = false
  try {
    for (let attempt = 0; attempt <= maxCantInitRetries; attempt += 1) {
      const wal = await inspectWal(options.sourcePath)
      let source: CipherDatabase | undefined
      let transactionStarted = false
      const rawKey = Buffer.alloc(36)
      rawKey.write('raw:', 0, 'ascii')
      options.key.copy(rawKey, 4)
      try {
        source = adapter.open(encryptedFileUri(options.sourcePath), {
          readonly: true,
          fileMustExist: true,
        })
        source.pragma("cipher='sqlcipher'")
        source.pragma('legacy=4')
        if (!source.key) throw new CipherSnapshotError('DATABASE_READ_FAILED')
        source.key(rawKey)
        rawKey.fill(0)
        source.exec('BEGIN')
        transactionStarted = true
        const sourceSchema = schemaSnapshot(source)

        try {
          await fileIo.reserveNewFile(options.destinationPath)
          destinationReserved = true
        } catch {
          throw new CipherSnapshotError('DESTINATION_RESERVE_FAILED')
        }
        try {
          if (!source.backup) throw new Error('backup unavailable')
          await source.backup(options.destinationPath)
        } catch {
          throw new CipherSnapshotError('BACKUP_FAILED')
        }

        let plain: CipherDatabase
        try {
          plain = adapter.open(options.destinationPath, { readonly: true, fileMustExist: true })
        } catch {
          throw new CipherSnapshotError('VALIDATION_OPEN_FAILED')
        }
        try {
          if (!integrityIsOk(plain.pragma('integrity_check'))) {
            throw new CipherSnapshotError('INTEGRITY_CHECK_FAILED')
          }
          const destinationSchema = schemaSnapshot(plain)
          if (destinationSchema.fingerprint !== sourceSchema.fingerprint) {
            throw new CipherSnapshotError('SCHEMA_MISMATCH')
          }
        } finally {
          plain.close()
        }
        return {
          schemaObjects: sourceSchema.count,
          schemaFingerprint: sourceSchema.fingerprint,
          wal,
        }
      } catch (error) {
        if (!destinationReserved && isReadonlyCantInit(error) && attempt < maxCantInitRetries) {
          continue
        }
        if (error instanceof CipherSnapshotError) throw error
        throw new CipherSnapshotError('DATABASE_READ_FAILED')
      } finally {
        rawKey.fill(0)
        if (source) {
          if (transactionStarted) {
            try {
              source.exec('ROLLBACK')
            } catch {
              // The read handle is closed immediately below.
            }
          }
          source.close()
        }
      }
    }
    throw new CipherSnapshotError('DATABASE_READ_FAILED')
  } finally {
    options.key.fill(0)
  }
}
