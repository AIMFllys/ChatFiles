import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runConversationAssetBuilder } from './wechat/conversationAssetBuilder.js'
import { loadLocalEnv } from './localEnv.js'

type CliOptions = {
  sourceSnapshotRoot: string
  bundleDir: string
  runId: string
}

function parseArguments(args: readonly string[], root: string): CliOptions {
  const values = new Map<string, string>()
  const allowed = new Set(['--source-snapshot', '--bundle', '--run-id'])
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (!flag || !allowed.has(flag) || !value || values.has(flag)) {
      throw new Error('CLI_ARGUMENT_INVALID')
    }
    values.set(flag, value)
  }
  const source = values.get('--source-snapshot')
  const runId = values.get('--run-id')
  if (!source || !runId) throw new Error('CLI_ARGUMENT_INVALID')
  return {
    sourceSnapshotRoot: path.resolve(root, source),
    bundleDir: path.resolve(root, values.get('--bundle') ?? 'data/chat-assets.next'),
    runId,
  }
}

function accountCandidates(store: string) {
  const resolved = path.resolve(store)
  const roots = path.basename(resolved).toLowerCase().startsWith('wxid_')
    ? [resolved]
    : fs.readdirSync(resolved, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().startsWith('wxid_'))
      .map((entry) => path.join(resolved, entry.name))
  return roots.flatMap((accountRoot) => {
    const database = path.join(accountRoot, 'db_storage', 'message', 'message_0.db')
    if (!fs.existsSync(database)) return []
    return [{ accountRoot, databaseBytes: fs.statSync(database).size }]
  })
}

export function primaryAccountRoot(store: string) {
  const candidates = accountCandidates(store)
    .sort((left, right) => right.databaseBytes - left.databaseBytes)
  const selected = candidates[0]
  if (!selected) throw new Error('PRIMARY_WECHAT_ACCOUNT_NOT_FOUND')
  return selected.accountRoot
}

export function runConversationAssetCli(args = process.argv.slice(2), root = path.resolve(process.cwd())) {
  loadLocalEnv({ filePath: path.join(root, '.env.local') })
  const options = parseArguments(args, root)
  const wechatStore = process.env.WECHAT_STORE?.trim()
  if (!wechatStore) throw new Error('WECHAT_STORE is required in .env.local')
  const resourceDbPath = path.join(
    options.sourceSnapshotRoot,
    'db_storage',
    'message',
    'message_resource.db',
  )
  const result = runConversationAssetBuilder({
    wechatDbPath: path.join(root, 'data', 'wechat.current', 'wechat.db'),
    resourceDbPath,
    sourceSnapshotRoot: options.sourceSnapshotRoot,
    accountRoot: primaryAccountRoot(wechatStore),
    bundleDir: options.bundleDir,
    runId: options.runId,
  })
  process.stdout.write(`${JSON.stringify({
    status: 'complete',
    runId: options.runId,
    counts: result.counts,
    metrics: result.metrics,
  })}\n`)
  return result
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (entryPath === fileURLToPath(import.meta.url)) {
  try {
    runConversationAssetCli()
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      status: 'failed',
      errorCode: error instanceof Error ? error.message : 'ASSET_BUILD_FAILED',
    })}\n`)
    process.exitCode = 1
  }
}
