import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
export type SourceRow = {
  localId: number
  serverId: bigint
  rawType: bigint
  sortSeq: number
  realSenderId: number
  time: number
  content: string
}

export type OutputRow = {
  uid: string
  sourceDb: string
  sourceTable?: string
  localId: number
  serverId: bigint
  rawType: bigint
  sortSeq: number
  time: number
  sender: string
  senderName?: string
  senderPrefix?: string
  text?: string
}

const snapshot = 'snapshot-new'

export function messageTable(username: string) {
  return `Msg_${crypto.createHash('md5').update(username, 'utf8').digest('hex')}`
}

function createSourceContacts(root: string) {
  const contactDir = path.join(root, snapshot, 'db_storage', 'contact')
  fs.mkdirSync(contactDir, { recursive: true })
  const dbPath = path.join(contactDir, 'contact.db')
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE contact(username TEXT, nick_name TEXT, remark TEXT, alias TEXT);
    INSERT INTO contact VALUES ('wxid_owner', '机主', '', '');
    INSERT INTO contact VALUES ('wxid_peer', '陈同学', '', '');
    INSERT INTO contact VALUES ('wxid_alternate', '另一个联系人', '', '');
    INSERT INTO contact VALUES ('wxid_member', '群成员甲', '', '');
    INSERT INTO contact VALUES ('room@chatroom', '中文测试群', '', '');
  `)
  db.close()
  return dbPath
}

export function createSourceShard(
  root: string,
  filename: string,
  names: ReadonlyArray<readonly [number, string]>,
  rows: readonly SourceRow[],
  conversationUsername = 'wxid_peer',
) {
  const messageDir = path.join(root, snapshot, 'db_storage', 'message')
  fs.mkdirSync(messageDir, { recursive: true })
  const dbPath = path.join(messageDir, filename)
  const db = new DatabaseSync(dbPath)
  const table = messageTable(conversationUsername)
  db.exec(`
    CREATE TABLE Name2Id(user_name TEXT PRIMARY KEY, is_session INTEGER);
    CREATE TABLE ${table}(
      local_id INTEGER, server_id INTEGER, local_type INTEGER, sort_seq INTEGER,
      real_sender_id INTEGER, create_time INTEGER, message_content TEXT, compress_content BLOB
    );
  `)
  const insertName = db.prepare('INSERT INTO Name2Id(rowid, user_name, is_session) VALUES (?,?,0)')
  for (const [id, username] of names) insertName.run(id, username)
  const insertMessage = db.prepare(`INSERT INTO ${table} VALUES (?,?,?,?,?,?,?,NULL)`)
  for (const row of rows) {
    insertMessage.run(
      row.localId,
      row.serverId,
      row.rawType,
      row.sortSeq,
      row.realSenderId,
      row.time,
      row.content,
    )
  }
  db.close()
  return dbPath
}

export function createOutputDatabase(
  root: string,
  options: {
    owner?: string
    peer?: string
    display?: string
    id?: string
    isGroup?: boolean
    rows: readonly OutputRow[]
  },
) {
  const dbPath = path.join(root, 'wechat.db')
  const owner = options.owner ?? 'wxid_owner'
  const peer = options.peer ?? 'wxid_peer'
  const display = options.display ?? (peer === 'room@chatroom' ? '中文测试群' : peer === 'wxid_peer' ? '陈同学' : peer)
  const convId = options.id ?? `wx:${owner}:${peer}`
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE conversations(
      id TEXT PRIMARY KEY, account TEXT, owner TEXT, username TEXT, display TEXT, is_group INTEGER,
      msg_count INTEGER, text_count INTEGER, first_time INTEGER, last_time INTEGER, summary TEXT
    );
    CREATE TABLE messages(
      conv_id TEXT, message_uid TEXT, seq INTEGER, source_snapshot TEXT, source_db TEXT, source_table TEXT,
      local_id INTEGER, server_id TEXT, sort_seq INTEGER, time INTEGER, sender TEXT, sender_name TEXT,
      sender_prefix TEXT, is_own INTEGER, sender_source TEXT, sender_audit TEXT,
      raw_type INTEGER, type INTEGER, type_label TEXT, text TEXT
    );
    CREATE TABLE parse_runs(
      run_id TEXT, status TEXT, completed_at TEXT, selected_snapshot_count INTEGER,
      selected_source_count INTEGER, source_conversation_count INTEGER, source_message_count INTEGER,
      output_conversation_count INTEGER, output_message_count INTEGER, output_text_count INTEGER,
      deduplicated_message_count INTEGER
    );
  `)
  db.prepare('INSERT INTO conversations VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
    convId,
    snapshot,
    owner,
    peer,
    display,
    options.isGroup ? 1 : 0,
    options.rows.length,
    options.rows.length,
    Math.min(...options.rows.map((row) => row.time)),
    Math.max(...options.rows.map((row) => row.time)),
    '',
  )
  const insert = db.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  options.rows.forEach((row, index) => {
    insert.run(
      convId,
      row.uid,
      index,
      snapshot,
      row.sourceDb,
      row.sourceTable ?? messageTable(peer),
      row.localId,
      row.serverId.toString(),
      row.sortSeq,
      row.time,
      row.sender,
      row.senderName ?? row.sender,
      row.senderPrefix ?? '',
      row.sender === owner ? 1 : 0,
      'message-name2id',
      '',
      row.rawType,
      Number(BigInt.asUintN(32, row.rawType)),
      'text',
      row.text ?? '中文正文',
    )
  })
  const textCount = options.rows.filter(
    (row) => Number(BigInt.asUintN(32, row.rawType)) === 1,
  ).length
  db.prepare('INSERT INTO parse_runs VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
    'fixture-run',
    'complete',
    '2026-07-12T00:00:00.000Z',
    1,
    new Set(options.rows.map((row) => row.sourceDb)).size,
    1,
    options.rows.length,
    1,
    options.rows.length,
    textCount,
    0,
  )
  db.close()
  return dbPath
}

export function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatfiles-source-audit-'))
  const sourceRoot = path.join(dir, 'source')
  const contactPath = createSourceContacts(sourceRoot)
  const files = [contactPath]
  return {
    dir,
    sourceRoot,
    contactPath,
    track(file: string) {
      files.push(file)
      return file
    },
    cleanup() {
      for (const file of files.reverse()) {
        if (fs.existsSync(file)) fs.unlinkSync(file)
      }
      const messageDir = path.join(sourceRoot, snapshot, 'db_storage', 'message')
      const contactDir = path.join(sourceRoot, snapshot, 'db_storage', 'contact')
      const directories = [
        messageDir,
        contactDir,
        path.dirname(messageDir),
        path.dirname(path.dirname(messageDir)),
        path.join(sourceRoot, snapshot),
        sourceRoot,
        dir,
      ]
      for (const directory of directories) {
        if (fs.existsSync(directory)) fs.rmdirSync(directory)
      }
    },
  }
}
