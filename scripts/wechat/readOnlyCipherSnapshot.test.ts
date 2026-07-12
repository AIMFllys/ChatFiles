import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CipherSnapshotError,
  snapshotCipherDatabase,
  type CipherDatabase,
  type CipherSnapshotAdapter,
  type SnapshotFileIo,
} from './readOnlyCipherSnapshot.js'
import { SqlcipherSnapshotHelperError } from './sqlcipherSnapshotHelper.js'
import { WalStateError, type SafeWalState } from './walState.js'

const safeWal: SafeWalState = {
  kind: 'active',
  safeForReadonlyShm: true,
  mxFrame: 2,
  nBackfill: 2,
  nBackfillAttempted: 2,
  pageSize: 4096,
  physicalFrameSlots: 2,
  generationFingerprint: 'fixture-generation-a',
}

class FakeDatabase implements CipherDatabase {
  readonly events: string[]
  readonly schema: Array<Record<string, unknown>>
  readonly integrity: Array<Record<string, unknown>>
  readonly beginError?: Error
  keyReference?: Buffer

  constructor(options: {
    events: string[]
    schema?: Array<Record<string, unknown>>
    integrity?: Array<Record<string, unknown>>
    beginError?: Error
  }) {
    this.events = options.events
    this.schema = options.schema ?? [{ type: 'table', name: '消息', tbl_name: '消息', rootpage: 2, sql: 'CREATE TABLE 消息(id)' }]
    this.integrity = options.integrity ?? [{ integrity_check: 'ok' }]
    this.beginError = options.beginError
  }

  pragma(source: string) {
    this.events.push(`pragma:${source}`)
    if (source === 'integrity_check') return this.integrity
    return []
  }

  key(key: Buffer) {
    this.events.push('key')
    this.keyReference = key
    return 0
  }

  exec(source: string) {
    this.events.push(`exec:${source}`)
    if (source === 'BEGIN' && this.beginError) throw this.beginError
  }

  prepare(source: string) {
    this.events.push(source.includes('sqlite_schema') ? 'prepare:schema' : 'prepare:other')
    return { all: () => this.schema }
  }

  async backup(destination: string) {
    this.events.push(`backup:${destination}`)
    return { totalPages: 1, remainingPages: 0 }
  }

  close() {
    this.events.push('close')
  }
}

function fakeIo(events: string[]): SnapshotFileIo {
  return {
    async reserveNewFile(filePath) {
      events.push(`reserve:${filePath}`)
    },
  }
}

test('opens an encrypted file URI with readonly_shm, passes a mutable raw key, and validates plaintext', async () => {
  const events: string[] = []
  const source = new FakeDatabase({ events })
  const plain = new FakeDatabase({ events })
  const opens: Array<{ filename: string; options: { readonly: boolean; fileMustExist: boolean } }> = []
  const adapter: CipherSnapshotAdapter = {
    open(filename, options) {
      opens.push({ filename, options })
      events.push(`open:${opens.length}`)
      return opens.length === 1 ? source : plain
    },
  }
  const key = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 10))
  const expectedRawKey = Buffer.concat([Buffer.from('raw:', 'ascii'), key])

  const result = await snapshotCipherDatabase({
    sourcePath: 'C:\\微信数据\\db_storage\\message\\消息.db',
    destinationPath: 'D:\\staging\\db_storage\\message\\消息.db',
    key,
    adapter,
    fileIo: fakeIo(events),
    readWalState: async () => {
      events.push('wal-state')
      return safeWal
    },
  })

  assert.equal(result.schemaObjects, 1)
  assert.equal(result.wal.mxFrame, 2)
  assert.equal(opens[0]?.filename.startsWith('file:///C:/'), true)
  assert.equal(opens[0]?.filename.includes('readonly_shm=1'), true)
  assert.deepEqual(opens[0]?.options, { readonly: true, fileMustExist: true })
  assert.deepEqual(opens[1], {
    filename: 'D:\\staging\\db_storage\\message\\消息.db',
    options: { readonly: true, fileMustExist: true },
  })
  assert.deepEqual(source.keyReference, Buffer.alloc(36))
  assert.deepEqual(key, Buffer.alloc(32))
  assert.deepEqual(events, [
    'wal-state',
    'open:1',
    "pragma:cipher='sqlcipher'",
    'pragma:legacy=4',
    'key',
    'exec:BEGIN',
    'prepare:schema',
    'reserve:D:\\staging\\db_storage\\message\\消息.db',
    'backup:D:\\staging\\db_storage\\message\\消息.db',
    'open:2',
    'pragma:integrity_check',
    'prepare:schema',
    'close',
    'exec:ROLLBACK',
    'close',
  ])
  assert.equal(expectedRawKey.equals(Buffer.alloc(36)), false)
})

test('uses the native readonly_shm helper when an executable is supplied', async () => {
  const events: string[] = []
  const plain = new FakeDatabase({
    events,
    schema: Array.from({ length: 5 }, (_, index) => ({
      type: 'table',
      name: `表${index}`,
      tbl_name: `表${index}`,
      rootpage: index + 2,
      sql: `CREATE TABLE 表${index}(id)`,
    })),
  })
  let deliveredKey: Buffer | undefined
  const key = Buffer.alloc(32, 0x6d)
  const result = await snapshotCipherDatabase({
    sourcePath: 'C:\\微信数据\\消息.db',
    destinationPath: 'D:\\staging\\消息.db',
    key,
    helperPath: 'D:\\tools\\snapshot-helper.exe',
    runHelper: async (options) => {
      events.push(`helper:${options.executablePath}`)
      assert.equal(options.sourcePath, 'C:\\微信数据\\消息.db')
      assert.equal(options.destinationPath, 'D:\\staging\\消息.db')
      deliveredKey = options.key
      return { schemaObjects: 5 }
    },
    adapter: {
      open(filename, options) {
        assert.equal(filename, 'D:\\staging\\消息.db')
        assert.deepEqual(options, { readonly: true, fileMustExist: true })
        events.push('open:plain')
        return plain
      },
    },
    fileIo: fakeIo(events),
    readWalState: async () => safeWal,
  })

  assert.equal(result.schemaObjects, 5)
  assert.deepEqual(events, [
    'helper:D:\\tools\\snapshot-helper.exe',
    'open:plain',
    'pragma:integrity_check',
    'prepare:schema',
    'close',
  ])
  assert.deepEqual(deliveredKey, Buffer.alloc(32))
  assert.deepEqual(key, Buffer.alloc(32))
})

test('reopens and validates the plaintext file produced by the native helper', async () => {
  const events: string[] = []
  const plain = new FakeDatabase({ events })
  const opens: Array<{ filename: string; options: { readonly: boolean; fileMustExist: boolean } }> = []
  const adapter: CipherSnapshotAdapter = {
    open(filename, options) {
      opens.push({ filename, options })
      events.push('open:plain')
      return plain
    },
  }

  const result = await snapshotCipherDatabase({
    sourcePath: 'C:\\微信数据\\消息.db',
    destinationPath: 'D:\\staging\\消息.db',
    key: Buffer.alloc(32, 0x2b),
    helperPath: 'D:\\tools\\snapshot-helper.exe',
    runHelper: async () => ({ schemaObjects: 1 }),
    adapter,
    fileIo: fakeIo(events),
    readWalState: async () => safeWal,
  })

  assert.equal(result.schemaObjects, 1)
  assert.deepEqual(opens, [{
    filename: 'D:\\staging\\消息.db',
    options: { readonly: true, fileMustExist: true },
  }])
  assert.deepEqual(events, [
    'open:plain',
    'pragma:integrity_check',
    'prepare:schema',
    'close',
  ])
})

test('rejects a native snapshot if the live WAL generation changes during the helper window', async () => {
  const events: string[] = []
  let walReads = 0

  await assert.rejects(
    snapshotCipherDatabase({
      sourcePath: 'C:\\微信数据\\消息.db',
      destinationPath: 'D:\\staging\\消息.db',
      key: Buffer.alloc(32, 0x32),
      helperPath: 'D:\\tools\\snapshot-helper.exe',
      runHelper: async () => ({ schemaObjects: 1 }),
      adapter: {
        open() {
          return new FakeDatabase({ events })
        },
      },
      fileIo: fakeIo(events),
      readWalState: async () => {
        walReads += 1
        return walReads === 1
          ? safeWal
          : { ...safeWal, generationFingerprint: 'fixture-generation-b' }
      },
    }),
    (error: unknown) => (
      error instanceof CipherSnapshotError && error.code === 'WAL_GENERATION_CHANGED'
    ),
  )

  assert.equal(walReads, 2)
})

test('waits for a fully backfilled WAL before invoking the native helper', async () => {
  const events: string[] = []
  let walReads = 0
  let waits = 0

  const result = await snapshotCipherDatabase({
    sourcePath: 'C:\\微信数据\\消息.db',
    destinationPath: 'D:\\staging\\消息.db',
    key: Buffer.alloc(32, 0x41),
    helperPath: 'D:\\tools\\snapshot-helper.exe',
    runHelper: async () => {
      events.push('helper')
      return { schemaObjects: 1 }
    },
    adapter: {
      open() {
        return new FakeDatabase({ events })
      },
    },
    fileIo: fakeIo(events),
    readWalState: async () => {
      walReads += 1
      events.push(`wal:${walReads}`)
      if (walReads < 3) throw new WalStateError('WAL_NOT_FULLY_BACKFILLED')
      return safeWal
    },
    maxWalSafetyRetries: 2,
    waitForWalSafety: async () => {
      waits += 1
      events.push('wait')
    },
  })

  assert.equal(result.schemaObjects, 1)
  assert.equal(walReads, 4)
  assert.equal(waits, 2)
  assert.deepEqual(events.slice(0, 6), [
    'wal:1',
    'wait',
    'wal:2',
    'wait',
    'wal:3',
    'helper',
  ])
})

test('retries a pre-destination native source race without reusing a zeroed key', async () => {
  const events: string[] = []
  const deliveredKeys: Buffer[] = []
  let helperCalls = 0
  let waits = 0
  const key = Buffer.alloc(32, 0x52)

  const result = await snapshotCipherDatabase({
    sourcePath: 'C:\\微信数据\\消息.db',
    destinationPath: 'D:\\staging\\消息.db',
    key,
    helperPath: 'D:\\tools\\snapshot-helper.exe',
    runHelper: async (options) => {
      helperCalls += 1
      deliveredKeys.push(Buffer.from(options.key))
      options.key.fill(0)
      if (helperCalls === 1) {
        throw new SqlcipherSnapshotHelperError('HELPER_NATIVE_E_READ_SOURCE')
      }
      return { schemaObjects: 1 }
    },
    adapter: {
      open() {
        return new FakeDatabase({ events })
      },
    },
    fileIo: fakeIo(events),
    readWalState: async () => safeWal,
    maxWalSafetyRetries: 1,
    waitForWalSafety: async () => {
      waits += 1
    },
  })

  assert.equal(result.schemaObjects, 1)
  assert.equal(helperCalls, 2)
  assert.equal(waits, 1)
  assert.equal(events.some((event) => event.startsWith('reserve:')), false)
  assert.deepEqual(key, Buffer.alloc(32))
  assert.deepEqual(deliveredKeys, [Buffer.alloc(32, 0x52), Buffer.alloc(32, 0x52)])
})

test('retries only SQLITE_READONLY_CANTINIT before reserving an output', async () => {
  const events: string[] = []
  const cantInit = Object.assign(new Error('private source path'), { code: 'SQLITE_READONLY_CANTINIT' })
  const databases = [
    new FakeDatabase({ events, beginError: cantInit }),
    new FakeDatabase({ events }),
    new FakeDatabase({ events }),
  ]
  let walReads = 0
  const adapter: CipherSnapshotAdapter = {
    open() {
      const next = databases.shift()
      assert.ok(next)
      return next
    },
  }
  const key = Buffer.alloc(32, 7)

  await snapshotCipherDatabase({
    sourcePath: 'C:\\source\\message.db',
    destinationPath: 'D:\\staging\\message.db',
    key,
    adapter,
    fileIo: fakeIo(events),
    readWalState: async () => {
      walReads += 1
      return safeWal
    },
    maxCantInitRetries: 1,
  })

  assert.equal(walReads, 2)
  assert.equal(events.filter((event) => event.startsWith('reserve:')).length, 1)
})

test('does not retry other SQLite errors or reserve a destination after snapshot setup fails', async () => {
  const events: string[] = []
  const busy = Object.assign(new Error('contains sensitive path'), { code: 'SQLITE_BUSY' })
  let opens = 0
  const adapter: CipherSnapshotAdapter = {
    open() {
      opens += 1
      return new FakeDatabase({ events, beginError: busy })
    },
  }
  await assert.rejects(
    snapshotCipherDatabase({
      sourcePath: 'C:\\source\\message.db',
      destinationPath: 'D:\\staging\\message.db',
      key: Buffer.alloc(32, 8),
      adapter,
      fileIo: fakeIo(events),
      readWalState: async () => safeWal,
      maxCantInitRetries: 5,
    }),
    (error: unknown) => error instanceof CipherSnapshotError && error.code === 'DATABASE_READ_FAILED',
  )
  assert.equal(opens, 1)
  assert.equal(events.some((event) => event.startsWith('reserve:')), false)
})

test('rejects failed integrity and schema equality checks without retrying', async () => {
  const events: string[] = []
  const databases = [
    new FakeDatabase({ events }),
    new FakeDatabase({ events, integrity: [{ integrity_check: 'row 2 missing' }] }),
  ]
  const adapter: CipherSnapshotAdapter = {
    open() {
      const next = databases.shift()
      assert.ok(next)
      return next
    },
  }
  await assert.rejects(
    snapshotCipherDatabase({
      sourcePath: 'C:\\source\\message.db',
      destinationPath: 'D:\\staging\\message.db',
      key: Buffer.alloc(32, 9),
      adapter,
      fileIo: fakeIo(events),
      readWalState: async () => safeWal,
    }),
    (error: unknown) => error instanceof CipherSnapshotError && error.code === 'INTEGRITY_CHECK_FAILED',
  )
  assert.equal(events.filter((event) => event.startsWith('reserve:')).length, 1)
})
