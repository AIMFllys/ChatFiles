import fs from 'node:fs'
import path from 'node:path'
import type { LibraryFile, LibraryManifest } from '../src/types.js'
import { appendHash8, planAppendOnlyArchive } from './archivePlan.js'
import {
  archiveDir,
  classify,
  dataDir,
  duplicateStem,
  ensureDir,
  home,
  mimeFor,
  previewFor,
  root,
  safeName,
  sha256,
  sourceApp,
  walkFiles,
  writeJson,
} from './shared.js'

// The WeChat 4.0 store may be relocated off C:\ — set WECHAT_STORE (e.g. in the
// gitignored .env.local) to that path. We enumerate its per-account msg/ folders
// (received documents, media, attachments). db_storage/ and encrypted .dat
// images are intentionally NOT swept here.
const wechatStores = [
  ...(process.env.WECHAT_STORE ? [process.env.WECHAT_STORE] : []),
  path.join(home, 'xwechat_files'),
  path.join(home, 'Documents', 'xwechat_files'),
]
const wechatMsgRoots = wechatStores.flatMap((store) => {
  if (!fs.existsSync(store)) return []
  return fs
    .readdirSync(store, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^wxid_/i.test(d.name))
    .map((d) => path.join(store, d.name, 'msg'))
    .filter((p) => fs.existsSync(p))
})

const syncRoots = [
  ...wechatMsgRoots,
  path.join(home, 'Documents', 'Tencent Files'),
  path.join(home, 'Documents', 'WeChat Files'),
  path.join(home, 'AppData', 'Roaming', 'QQ'),
  path.join(home, 'AppData', 'Roaming', 'Tencent', 'QQ'),
  path.join(home, 'AppData', 'Roaming', 'Tencent', 'xwechat'),
  path.join(home, 'AppData', 'Roaming', 'Tencent', 'WeChat'),
  path.join(home, 'AppData', 'Local', 'Temp', 'WeChat Files'),
].filter((item, index, arr) => item && arr.indexOf(item) === index)

function chooseLatestSerial(files: string[]) {
  const byName = new Map<string, string>()
  const serials = new Map<string, number>()
  for (const file of files) {
    const { key, serial } = duplicateStem(path.basename(file))
    const scopedKey = `${path.dirname(file).toLowerCase()}\\${key}`
    const previous = serials.get(scopedKey) ?? -1
    if (serial >= previous) {
      byName.set(scopedKey, file)
      serials.set(scopedKey, serial)
    }
  }
  return [...byName.values()]
}

const syncableExt =
  /\.(pdf|docx?|pptx?|xlsx?|csv|txt|md|zip|rar|7z|py|ipynb|cpp|c|h|java|js|ts|tsx|html?|css|png|jpe?g|gif|webp|bmp|svg|ico|apng|avif|heic|heif|mp4|mov|mkv|webm|avi|m4v|3gp|mp3|wav|ogg|m4a|aac|flac|wma|silk|amr)$/i
const syncNoisePath =
  /\\(avatar|Emoji|baseemojisyastems|emoji-recv|emojirecv|emojirelated|OnlineStatus|log-cache|logs?|xlog|cache|CacheStorage|Code Cache|Service Worker|Local Storage|Session Storage|IndexedDB|leveldb|blob_storage|Crashpad|GPUCache|DawnGraphiteCache|DawnWebGPUCache|dictionaries|DynamicResource|DynamicResourcePackage|dynamic_module|dynamic_package|packages|patch|upgrade|xplugin|XPlugin|xworker|publicLib|tbs|themes?|locales?|resources?|node_modules|miniapp\\temps|arks|qqex|shared dictionary)\\/i
const syncNoiseFile = /\.(log|xlog|qqxlog|dat|db|db-shm|db-wal|ldb|sst|tmp|bak|ini|map|dmp|pak|bin|dll|exe)$/i

function isSyncableChatAsset(filePath: string) {
  if (!syncableExt.test(filePath)) return false
  if (syncNoisePath.test(filePath)) return false
  if (syncNoiseFile.test(filePath)) return false
  const preview = previewFor(filePath)
  if (preview === 'download' || preview === 'font' || preview === 'database') return false
  return true
}

function readPreviousManifest(manifestPath: string) {
  if (!fs.existsSync(manifestPath)) return undefined
  const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as LibraryManifest
  if (!Array.isArray(parsed.files) || !Array.isArray(parsed.roots)) {
    throw new Error(`旧归档清单格式无效，已停止更新以避免覆盖：${manifestPath}`)
  }
  return parsed
}

function resolveArchiveTarget(archivePath: string) {
  const archiveRoot = path.resolve(archiveDir)
  const target = path.resolve(root, archivePath)
  if (!target.startsWith(`${archiveRoot}${path.sep}`)) {
    throw new Error(`拒绝访问 archive 目录外的归档路径：${archivePath}`)
  }
  return target
}

ensureDir(archiveDir)
ensureDir(dataDir)
const manifestPath = path.join(dataDir, 'library.json')
const previousManifest = readPreviousManifest(manifestPath)

const sourceRoots = syncRoots.filter((dir) => fs.existsSync(dir))
const discovered = sourceRoots.flatMap((dir) => walkFiles(dir))
const eligible = chooseLatestSerial(discovered.filter(isSyncableChatAsset))

const candidates: LibraryFile[] = []

for (const file of eligible) {
  const stat = fs.statSync(file)
  if (stat.size === 0) continue
  const hash = sha256(file)
  const { category, subcategory } = classify(file)
  const ext = path.extname(file).toLowerCase()
  const cleanName = safeName(path.basename(file))
  const preferredDest = path.join(archiveDir, category, ...subcategory, cleanName)
  candidates.push({
    id: hash.slice(0, 20),
    name: cleanName,
    ext,
    mime: mimeFor(preferredDest),
    size: stat.size,
    modified: stat.mtime.toISOString(),
    category,
    subcategory,
    archivePath: path.relative(root, preferredDest).replace(/\\/g, '/'),
    sourcePath: file,
    sourceApp: sourceApp(file),
    preview: previewFor(preferredDest),
    sha256: hash,
  })
}

const pathsToInspect = new Set(previousManifest?.files.map((file) => file.archivePath) ?? [])
for (const candidate of candidates) {
  pathsToInspect.add(candidate.archivePath)
  pathsToInspect.add(appendHash8(candidate.archivePath, candidate.sha256))
}

const existingCopies: Array<{ archivePath: string; sha256: string }> = []
for (const archivePath of pathsToInspect) {
  let target: string
  try {
    target = resolveArchiveTarget(archivePath)
  } catch {
    continue
  }
  if (!fs.existsSync(target) || !fs.lstatSync(target).isFile()) continue
  existingCopies.push({ archivePath, sha256: sha256(target) })
}

const plan = planAppendOnlyArchive({
  previousManifest,
  candidates,
  existingCopies,
  generatedAt: new Date().toISOString(),
  roots: sourceRoots,
  discovered: discovered.length,
  duplicatesSkipped: discovered.length - eligible.length,
})

for (const operation of plan.copyOperations) {
  const target = resolveArchiveTarget(operation.archivePath)
  ensureDir(path.dirname(target))
  fs.copyFileSync(operation.sourcePath, target, fs.constants.COPYFILE_EXCL)
  const modified = new Date(operation.modified)
  fs.utimesSync(target, modified, modified)
}

const manifest = plan.manifest
writeJson(manifestPath, manifest)

const issueReport = plan.integrityIssues
  .map((issue) => {
    if (issue.kind === 'missing-previous-copy') {
      return `- 旧清单副本缺失（仅报告）：${issue.archivePath}`
    }
    if (issue.kind === 'changed-previous-copy') {
      return `- 旧清单副本内容异常（仅报告）：${issue.archivePath}`
    }
    return `- 目标路径冲突，未覆盖也未归档：${issue.archivePath}`
  })
  .join('\n')

const report = `# 微信 / QQ 文件深度同步报告

生成时间：${manifest.generatedAt}

## 只读同步源

${manifest.roots.map((item) => `- ${item}`).join('\n') || '- 未找到可用根目录'}

## 同步策略

- 原始微信/QQ文件没有删除，脚本只复制到本项目 archive 目录。
- 源目录从部分候选目录升级为所有已知微信/QQ根：Tencent Files、Roaming QQ、Tencent/QQ、xwechat、WeChat、临时 WeChat Files。
- 文件名形如 name、name(1)、name(2) 时，在同一目录内保留序号最高的版本。
- 归档采用只追加策略：旧清单条目与旧副本不删除、不覆盖；相同 SHA-256 直接复用。
- 同名不同内容追加 SHA-256 前 8 位；新增副本使用排他复制，目标已存在时拒绝覆盖。
- 排除数据库、日志、程序缓存、安装组件、前端包、头像/表情资源和明显应用资源；保留图片、视频、语音、文档、表格、演示、压缩包、代码/文本等可预览资产。

## 结果

- 扫描源文件：${manifest.stats.discovered}
- 清单累计文件：${manifest.stats.archived}
- 本轮新增副本：${plan.copyOperations.length}
- 本轮复用旧哈希：${plan.reusedHashes.length}
- 去重/跳过：${manifest.stats.duplicatesSkipped}
- 同步体积：${(manifest.stats.bytes / 1024 / 1024).toFixed(2)} MB

## 完整性报告

${issueReport || '- 未发现缺失、内容异常或目标冲突。'}
`

fs.writeFileSync(path.join(dataDir, 'discovery.md'), report, 'utf8')
console.log(report)
