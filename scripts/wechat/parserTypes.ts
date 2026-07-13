import type { DatabaseSync } from 'node:sqlite'
import type { AccountSnapshot } from './messageModel.js'

export type Contact = {
  username: string
  display: string
  nick: string
  remark: string
  alias: string
  isGroup: boolean
}

export type Session = { summary: string; lastTime: number }

export type SnapshotDescriptor = {
  dir: string
  name: string
  owner: string
  contactMap: Map<string, Contact>
  sessionMap: Map<string, Session>
  selection: AccountSnapshot
  sourceCount: number
  sourceMessageCount: number
}

export type MessageSource = {
  db: DatabaseSync
  filename: string
  tables: Set<string>
  idToName: Map<number, string>
}

export type ParsedMessage = {
  messageUid: string
  sourceSnapshot: string
  sourceDb: string
  sourceTable: string
  localId: number
  serverId: string
  sortSeq: number
  time: number
  sender: string
  senderName: string
  senderPrefix: string
  isOwn: number
  senderSource: string
  senderAudit: string
  rawType: string
  type: number
  typeLabel: string
  text: string
}

export type ParserPaths = {
  root: string
  decryptRoot: string
  bundleDir: string
  outDbPath: string
  indexPath: string
  transcriptDir: string
  runId: string
}

export type ParserResult = {
  paths: ParserPaths
  conversations: number
  messages: number
  selectedSnapshots: string[]
  excludedSnapshots: string[]
}
