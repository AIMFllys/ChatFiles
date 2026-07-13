import fs from 'node:fs'
import path from 'node:path'

export type SourceDomain = 'biz' | 'media' | 'regular' | 'resource' | 'unknown'

export type SourceDatabase = {
  absolutePath: string
  domain: SourceDomain
  filename: string
}

export function sourceDomain(filename: string): SourceDomain {
  if (/^biz_message_[0-9]+\.db$/u.test(filename)) return 'biz'
  if (/^media_[0-9]+\.db$/u.test(filename)) return 'media'
  if (/^message_[0-9]+\.db$/u.test(filename)) return 'regular'
  if (filename === 'message_resource.db') return 'resource'
  return 'unknown'
}

export function discoverSourceDatabases(snapshotDir: string): SourceDatabase[] {
  const messageDir = path.join(snapshotDir, 'db_storage', 'message')
  if (!fs.existsSync(messageDir)) return []
  return fs.readdirSync(messageDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.db'))
    .map((entry) => ({
      absolutePath: path.join(messageDir, entry.name),
      domain: sourceDomain(entry.name),
      filename: entry.name,
    }))
    .sort((left, right) => left.filename.localeCompare(right.filename))
}
