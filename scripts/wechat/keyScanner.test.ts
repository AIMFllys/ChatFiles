import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import test from 'node:test'
import {
  SCANNER_PROTOCOL_MAGIC,
  SCANNER_PROTOCOL_VERSION,
} from './scannerProtocol.js'
import {
  ScannerRunError,
  runKeyScanner,
  type ScannerChild,
  type ScannerSpawn,
} from './keyScanner.js'

function wire(relativePath: string, key: Buffer) {
  const pathBytes = Buffer.from(relativePath, 'utf8')
  const bytes = Buffer.alloc(SCANNER_PROTOCOL_MAGIC.length + 4 + 4 + pathBytes.length + 32 + 4)
  let offset = 0
  SCANNER_PROTOCOL_MAGIC.copy(bytes, offset)
  offset += SCANNER_PROTOCOL_MAGIC.length
  bytes.writeUInt32LE(SCANNER_PROTOCOL_VERSION, offset)
  offset += 4
  bytes.writeUInt32LE(pathBytes.length, offset)
  offset += 4
  pathBytes.copy(bytes, offset)
  offset += pathBytes.length
  key.copy(bytes, offset)
  offset += 32
  bytes.writeUInt32LE(0, offset)
  return bytes
}

class FakeChild extends EventEmitter implements ScannerChild {
  stdout: Readable
  stderr: Readable
  killed = false

  constructor(stdoutChunks: Buffer[], stderrChunks: Buffer[], exitCode = 0) {
    super()
    this.stdout = Readable.from(stdoutChunks)
    this.stderr = Readable.from(stderrChunks)
    queueMicrotask(() => this.emit('close', exitCode, null))
  }

  kill() {
    this.killed = true
    return true
  }
}

test('spawns with pipes, consumes Chinese records one at a time, and zeroes keys and pipe chunks', async () => {
  const key = Buffer.alloc(32, 0x5a)
  const encoded = wire('db_storage\\message\\中文消息.db', key)
  const stdoutChunks = [Buffer.from(encoded.subarray(0, 11)), Buffer.from(encoded.subarray(11))]
  const stderrChunks = [Buffer.from('OK 1', 'utf8')]
  let spawnArgs: readonly string[] = []
  let spawnOptions: Record<string, unknown> = {}
  const spawn: ScannerSpawn = (_command, args, options) => {
    spawnArgs = args
    spawnOptions = options as unknown as Record<string, unknown>
    return new FakeChild(stdoutChunks, stderrChunks)
  }
  let keyReference: Buffer | undefined

  const count = await runKeyScanner({
    executablePath: 'C:\\fixture\\scanner.exe',
    pid: 4321,
    accountRoot: 'C:\\微信数据\\wxid_fixture',
    spawn,
    async onKey(record) {
      assert.equal(record.relativePath, 'db_storage\\message\\中文消息.db')
      assert.equal(record.databasePath, 'C:\\微信数据\\wxid_fixture\\db_storage\\message\\中文消息.db')
      assert.deepEqual(record.key, key)
      keyReference = record.key
    },
  })

  assert.equal(count, 1)
  assert.deepEqual(spawnArgs, ['4321', 'C:\\微信数据\\wxid_fixture'])
  assert.deepEqual(spawnOptions.stdio, ['ignore', 'pipe', 'pipe'])
  assert.equal(spawnOptions.shell, false)
  assert.equal(spawnOptions.windowsHide, true)
  assert.deepEqual(keyReference, Buffer.alloc(32))
  for (const chunk of [...stdoutChunks, ...stderrChunks]) assert.deepEqual(chunk, Buffer.alloc(chunk.length))
})

test('discards stderr content and exposes only a stable code for scanner failure', async () => {
  const secret = 'C:\\私人目录\\wxid_secret ' + 'ab'.repeat(32)
  const spawn: ScannerSpawn = () => new FakeChild(
    [wire('db_storage\\message\\message.db', Buffer.alloc(32, 0xab))],
    [Buffer.from(secret, 'utf8')],
    2,
  )
  await assert.rejects(
    runKeyScanner({
      executablePath: 'scanner.exe',
      pid: 1,
      accountRoot: 'C:\\fixture',
      spawn,
      async onKey() {},
    }),
    (error: unknown) => {
      assert.equal(error instanceof ScannerRunError && error.code === 'SCANNER_EXIT_NONZERO', true)
      assert.equal(String((error as Error).message).includes('私人目录'), false)
      assert.equal(String((error as Error).message).includes('abab'), false)
      return true
    },
  )
})

test('sanitizes consumer failures and zeroes the delivered key', async () => {
  const key = Buffer.alloc(32, 0xcd)
  let delivered: Buffer | undefined
  const child = new FakeChild([wire('db_storage\\message\\message.db', key)], [])
  const spawn: ScannerSpawn = () => child
  await assert.rejects(
    runKeyScanner({
      executablePath: 'scanner.exe',
      pid: 1,
      accountRoot: 'C:\\fixture',
      spawn,
      async onKey(record) {
        delivered = record.key
        throw new Error('C:\\private ' + 'cd'.repeat(32))
      },
    }),
    (error: unknown) => error instanceof ScannerRunError && error.code === 'KEY_CONSUMER_FAILED',
  )
  assert.deepEqual(delivered, Buffer.alloc(32))
  assert.equal(child.killed, true)
})
