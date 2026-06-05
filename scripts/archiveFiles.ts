import fs from 'node:fs'
import path from 'node:path'
import type { LibraryFile, LibraryManifest } from '../src/types.js'
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

function removePreviousArchive() {
  const manifestPath = path.join(dataDir, 'library.json')
  if (!fs.existsSync(manifestPath)) return
  const archiveRoot = path.resolve(archiveDir)
  try {
    const previous = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as LibraryManifest
    const dirs = new Set<string>()
    for (const item of previous.files) {
      const target = path.resolve(root, item.archivePath)
      if (!target.startsWith(`${archiveRoot}${path.sep}`)) continue
      if (fs.existsSync(target) && fs.statSync(target).isFile()) {
        dirs.add(path.dirname(target))
        fs.unlinkSync(target)
      }
    }
    for (const dir of [...dirs].sort((a, b) => b.length - a.length)) {
      let cursor = dir
      while (cursor.startsWith(archiveRoot) && cursor !== archiveRoot) {
        try {
          fs.rmdirSync(cursor)
        } catch {
          break
        }
        cursor = path.dirname(cursor)
      }
    }
  } catch {
    return
  }
}

ensureDir(archiveDir)
ensureDir(dataDir)
removePreviousArchive()

const sourceRoots = syncRoots.filter((dir) => fs.existsSync(dir))
const discovered = sourceRoots.flatMap((dir) => walkFiles(dir))
const eligible = chooseLatestSerial(discovered.filter(isSyncableChatAsset))

const seenHashes = new Set<string>()
const files: LibraryFile[] = []
let duplicateCount = discovered.length - eligible.length
let totalBytes = 0

for (const file of eligible) {
  const stat = fs.statSync(file)
  if (stat.size === 0) continue
  const hash = sha256(file)
  if (seenHashes.has(hash)) {
    duplicateCount += 1
    continue
  }
  seenHashes.add(hash)
  const { category, subcategory } = classify(file)
  const ext = path.extname(file).toLowerCase()
  const cleanName = safeName(path.basename(file))
  const destDir = path.join(archiveDir, category, ...subcategory)
  ensureDir(destDir)
  let dest = path.join(destDir, cleanName)
  if (fs.existsSync(dest) && sha256(dest) !== hash) {
    dest = path.join(destDir, `${path.basename(cleanName, ext)}-${hash.slice(0, 8)}${ext}`)
  }
  if (!fs.existsSync(dest)) fs.copyFileSync(file, dest)
  fs.utimesSync(dest, stat.atime, stat.mtime)
  totalBytes += stat.size
  files.push({
    id: hash.slice(0, 20),
    name: path.basename(dest),
    ext,
    mime: mimeFor(dest),
    size: stat.size,
    modified: stat.mtime.toISOString(),
    category,
    subcategory,
    archivePath: path.relative(root, dest).replace(/\\/g, '/'),
    sourcePath: file,
    sourceApp: sourceApp(file),
    preview: previewFor(dest),
    sha256: hash,
  })
}

const manifest: LibraryManifest = {
  generatedAt: new Date().toISOString(),
  roots: sourceRoots,
  files: files.sort((a, b) => a.category.localeCompare(b.category, 'zh-CN') || a.name.localeCompare(b.name, 'zh-CN')),
  stats: {
    discovered: discovered.length,
    archived: files.length,
    duplicatesSkipped: duplicateCount,
    bytes: totalBytes,
  },
}

writeJson(path.join(dataDir, 'library.json'), manifest)

const report = `# 微信 / QQ 文件深度同步报告

生成时间：${manifest.generatedAt}

## 只读同步源

${manifest.roots.map((item) => `- ${item}`).join('\n') || '- 未找到可用根目录'}

## 同步策略

- 原始微信/QQ文件没有删除，脚本只复制到本项目 archive 目录。
- 源目录从部分候选目录升级为所有已知微信/QQ根：Tencent Files、Roaming QQ、Tencent/QQ、xwechat、WeChat、临时 WeChat Files。
- 文件名形如 name、name(1)、name(2) 时，在同一目录内保留序号最高的版本。
- 相同 SHA-256 的文件只保留一份。
- 排除数据库、日志、程序缓存、安装组件、前端包、头像/表情资源和明显应用资源；保留图片、视频、语音、文档、表格、演示、压缩包、代码/文本等可预览资产。

## 结果

- 扫描源文件：${manifest.stats.discovered}
- 同步文件：${manifest.stats.archived}
- 去重/跳过：${manifest.stats.duplicatesSkipped}
- 同步体积：${(manifest.stats.bytes / 1024 / 1024).toFixed(2)} MB
`

fs.writeFileSync(path.join(dataDir, 'discovery.md'), report, 'utf8')
console.log(report)
