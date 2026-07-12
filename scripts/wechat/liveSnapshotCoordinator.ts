import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { runKeyScanner, ScannerRunError, type DeliveredScannerKey } from './keyScanner.js'
import {
  CipherSnapshotError,
  snapshotCipherDatabase,
} from './readOnlyCipherSnapshot.js'
import { ScannerProtocolError, resolveContainedDatabasePath } from './scannerProtocol.js'
import { WalStateError } from './walState.js'

export type LiveSnapshotErrorCode =
  | 'RUN_ID_INVALID'
  | 'DUPLICATE_DATABASE'
  | 'SCANNER_COUNT_MISMATCH'
  | 'RUN_IO_FAILED'
  | 'SNAPSHOT_FAILED'
  | string

export class LiveSnapshotError extends Error {
  readonly code: LiveSnapshotErrorCode

  constructor(code: LiveSnapshotErrorCode) {
    super(code)
    this.name = 'LiveSnapshotError'
    this.code = code
  }
}

export type SnapshotKeyScanner = (options: {
  executablePath: string
  pid: number
  accountRoot: string
  onKey(record: DeliveredScannerKey): Promise<void>
}) => Promise<number>

export type Snapshotter = typeof snapshotCipherDatabase

type ManifestEvent = {
  version: 1
  runId: string
  timestamp: string
  status: 'started' | 'database-complete' | 'validated' | 'complete' | 'failed'
  relativePath?: string
  databaseCount?: number
  schemaObjects?: number
  wal?: {
    kind: 'active' | 'reset'
    mxFrame: number
    nBackfill: number
    nBackfillAttempted: number
    pageSize: number
  }
  errorCode?: string
}

export interface LiveSnapshotIo {
  ensureOutputRoot(target: string): Promise<void>
  assertMissing(target: string): Promise<void>
  createStaging(target: string): Promise<void>
  ensureParent(target: string): Promise<void>
  appendManifest(target: string, event: ManifestEvent): Promise<void>
  publish(staging: string, final: string): Promise<void>
}

export const nodeLiveSnapshotIo: LiveSnapshotIo = {
  async ensureOutputRoot(target) {
    await fs.mkdir(target, { recursive: true })
  },
  async assertMissing(target) {
    try {
      await fs.access(target)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    throw new Error('target exists')
  },
  async createStaging(target) {
    await fs.mkdir(target, { recursive: false })
  },
  async ensureParent(target) {
    await fs.mkdir(target, { recursive: true })
  },
  async appendManifest(target, event) {
    await fs.appendFile(target, `${JSON.stringify(event)}\n`, { encoding: 'utf8', flag: 'a' })
  },
  async publish(staging, final) {
    await fs.rename(staging, final)
  },
}

function generatedRunId(now: Date) {
  const timestamp = now.toISOString().replaceAll(/[-:.]/gu, '')
  return `${timestamp}-${crypto.randomBytes(6).toString('hex')}`
}

function validateRunId(runId: string) {
  if (!/^[A-Za-z0-9_-]{1,80}$/u.test(runId)) throw new LiveSnapshotError('RUN_ID_INVALID')
}

function sanitizedErrorCode(error: unknown) {
  if (
    error instanceof LiveSnapshotError
    || error instanceof CipherSnapshotError
    || error instanceof ScannerRunError
    || error instanceof ScannerProtocolError
    || error instanceof WalStateError
  ) {
    return error.code
  }
  return 'SNAPSHOT_FAILED'
}

async function appendFailure(
  io: LiveSnapshotIo,
  targets: string[],
  event: ManifestEvent,
) {
  await Promise.allSettled(targets.map((target) => io.appendManifest(target, event)))
}

export async function runLiveSnapshot(options: {
  pid: number
  accountRoot: string
  outputRoot: string
  scannerPath: string
  runId?: string
  scanKeys?: SnapshotKeyScanner
  snapshotDatabase?: Snapshotter
  io?: LiveSnapshotIo
  now?: () => Date
}) {
  const now = options.now ?? (() => new Date())
  const runId = options.runId ?? generatedRunId(now())
  validateRunId(runId)
  const io = options.io ?? nodeLiveSnapshotIo
  const scanKeys = options.scanKeys ?? runKeyScanner
  const snapshotDatabase = options.snapshotDatabase ?? snapshotCipherDatabase
  const staging = path.join(options.outputRoot, `.incoming-${runId}`)
  const final = path.join(options.outputRoot, runId)
  const globalManifest = path.join(options.outputRoot, 'snapshot-runs.jsonl')
  const stagingManifest = path.join(staging, 'snapshot-manifest.jsonl')
  const manifestTargets: string[] = [globalManifest]
  let databaseCount = 0

  try {
    await io.ensureOutputRoot(options.outputRoot)
    await io.assertMissing(final)
    await io.assertMissing(staging)
    await io.createStaging(staging)
    manifestTargets.push(stagingManifest)
    const started: ManifestEvent = {
      version: 1,
      runId,
      timestamp: now().toISOString(),
      status: 'started',
    }
    await io.appendManifest(globalManifest, started)
    await io.appendManifest(stagingManifest, started)

    const seen = new Set<string>()
    const scanned = await scanKeys({
      executablePath: options.scannerPath,
      pid: options.pid,
      accountRoot: options.accountRoot,
      async onKey(record) {
        try {
          const sourcePath = resolveContainedDatabasePath(options.accountRoot, record.relativePath)
          const destinationPath = resolveContainedDatabasePath(staging, record.relativePath)
          const identity = path.relative(staging, destinationPath).replaceAll('/', '\\').toLowerCase()
          if (seen.has(identity)) throw new LiveSnapshotError('DUPLICATE_DATABASE')
          seen.add(identity)
          await io.ensureParent(path.dirname(destinationPath))
          const result = await snapshotDatabase({
            sourcePath,
            destinationPath,
            key: record.key,
          })
          databaseCount += 1
          await io.appendManifest(stagingManifest, {
            version: 1,
            runId,
            timestamp: now().toISOString(),
            status: 'database-complete',
            relativePath: record.relativePath,
            schemaObjects: result.schemaObjects,
            wal: {
              kind: result.wal.kind,
              mxFrame: result.wal.mxFrame,
              nBackfill: result.wal.nBackfill,
              nBackfillAttempted: result.wal.nBackfillAttempted,
              pageSize: result.wal.pageSize,
            },
          })
        } finally {
          record.key.fill(0)
        }
      },
    })
    if (scanned !== databaseCount) throw new LiveSnapshotError('SCANNER_COUNT_MISMATCH')

    await io.appendManifest(stagingManifest, {
      version: 1,
      runId,
      timestamp: now().toISOString(),
      status: 'validated',
      databaseCount,
    })
    await io.publish(staging, final)
    await io.appendManifest(globalManifest, {
      version: 1,
      runId,
      timestamp: now().toISOString(),
      status: 'complete',
      databaseCount,
    })
    return { runId, databaseCount }
  } catch (error) {
    const errorCode = sanitizedErrorCode(error)
    await appendFailure(io, manifestTargets, {
      version: 1,
      runId,
      timestamp: now().toISOString(),
      status: 'failed',
      databaseCount,
      errorCode,
    })
    throw new LiveSnapshotError(errorCode)
  }
}
