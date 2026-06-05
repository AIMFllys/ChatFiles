# 05 · 文件归档规格：微信/QQ 附件 → `archive/` + `data/library.json`

> 本文是 **午夜书斋 / ChatFiles** 复刻规格的「文件归档」分册。
> 目标：把机主微信/QQ 散落各处的**真实文件附件**（文档、图片、视频、语音、代码、压缩包…）**只读扫描 → 去重 → 关键词分类 → 复制**到本项目 `archive/<一级分类>/<次级>/`，并写出文件清单 `data/library.json`（每文件含路径/大小/预览类型/sha256/分类），原文件**绝不**移动或修改。
> 权威实现：`scripts/archiveFiles.ts` + `scripts/shared.ts`（用 `tsx` 运行）。本文描述代码**实际行为**；凡冲突以代码为准。
> 规模锚点（本项目实测）：**扫描 87,052 文件 → 归档 5,907（去重/跳过 81,145）→ 33.7GB**。

本文用 RFC 2119 关键词（**MUST / MUST NOT / SHOULD / SHOULD NOT / MAY**）。机器/账号值用 `{{占位符}}`。

关联文档：
- 解密产出与微信存储被迁移的事实：见 [`03_decryption.md`](./03_decryption.md)。
- 解析（聊天文本侧，不归档媒体）：见 [`04_parsing.md`](./04_parsing.md)。
- 提炼/重分类增强：见 [`06_insights.md`](./06_insights.md)。
- 边界（`.dat` 加密图、QQ 正文）：见 [`10_data-products-and-boundaries.md`](./10_data-products-and-boundaries.md)。
- 运行顺序：见 [`../RUNBOOK.md`](../RUNBOOK.md)。

---

## 1. 安全不变量（最高优先，先读）

归档管线 **MUST** 满足以下铁律，违反任意一条即视为不合格：

1. **只复制，不移动**：对源文件只用 `fs.copyFileSync`，**MUST NOT** 移动 / 重命名 / 删除任何源文件。
2. **原文件零修改**：不写、不截断、不改属性源文件；复制后 **MAY** 用 `fs.utimesSync(dest, atime, mtime)` 把**副本**时间对齐源（这只动副本）。
3. **跳过加密 `.dat`**：微信 `.dat` 是加密图片（本项目 69,820 个），**MUST** 在噪声过滤里排除，**MUST NOT** 尝试解密或归档。
4. **不上传**：`archive/`、`data/library.json` 属本地敏感数据，**MUST** 在 `.gitignore`，**MUST NOT** 推送到任何远端。
5. **清理只动自己**：重跑前清理旧归档时，**MUST** 只删 `archive/` 内、且**被上一次 manifest 记录过**的文件（见 §7），**MUST NOT** 误删 `archive/` 之外的东西。

---

## 2. 源根定位（最关键、最易踩坑）

### 2.1 原项目的真实 Bug（复刻 MUST 修对）

原项目前 42 个排查阶段把微信存储默认当成在 `C:\Users\{{你}}\xwechat_files\`，但机主**在微信设置里把存储迁到了 D 盘**（`D:\{{微信迁移目录}}\xwechat_files\`），导致 `C:` 下为空 → **一个微信文件都没归档**。
**复刻 MUST** 把（可能被迁移到 D: 的）微信存储根纳入源根，并**枚举 `xwechat_files\*\msg`**（每个 `wxid_*` 账号目录下的 `msg/` 子目录才是收到的文件/媒体）。

### 2.2 微信源根枚举

`home = process.env.USERPROFILE`。微信存储候选根 `wechatStores` **MUST** 至少包含：

```
D:\{{微信迁移目录}}\xwechat_files          ← {{微信存储根（被迁移）}}
<home>\xwechat_files
<home>\Documents\xwechat_files
```

对每个**存在**的 store，**MUST** 读其一级目录，筛出名字匹配 `/^wxid_/i` 的账号目录，取 `<store>\<wxid_*>\msg`，并**只保留存在的 `msg/`**，得到 `wechatMsgRoots`。

> 占位符提示：`{{微信存储根}}` 是机器相关的硬路径。复刻到别的机器时，**MUST** 先按 [`03_decryption.md`](./03_decryption.md) 的定位法（全盘搜 `xwechat_files` / 含 `db_storage\session\session.db` 的目录 / 读运行中微信进程句柄）找到真实存储根，再替换此处。

### 2.3 完整源根集合 `syncRoots`

最终扫描源根 **MUST** 为去重后的：

```
…wechatMsgRoots（§2.2，每账号 msg/）
<home>\Documents\Tencent Files                         ← QQ：含 {{QQ号}}\nt_qq\nt_data 明文附件
<home>\Documents\WeChat Files
<home>\AppData\Roaming\QQ
<home>\AppData\Roaming\Tencent\QQ
<home>\AppData\Roaming\Tencent\xwechat
<home>\AppData\Roaming\Tencent\WeChat
<home>\AppData\Local\Temp\WeChat Files
```

- 去重 **MUST** 用 `filter((item,i,arr)=>item && arr.indexOf(item)===i)`。
- 实际扫描前 **MUST** 再用 `fs.existsSync` 过滤掉不存在的根（`sourceRoots`），并把这份**最终生效根列表**写进 manifest 的 `roots`（见 §8）。
- QQ 的明文附件位于 `…\Tencent Files\{{QQ号}}\nt_qq\nt_data`（图片/视频/语音/文件，**明文**，可直接归档）；QQ 聊天**正文**库不在归档范围（见边界分册）。

### 2.4 目录递归 `walkFiles(dir)`

- **MUST** 用 `fs.readdirSync(dir, { withFileTypes: true })` 递归：目录则递归、文件则收集，返回全部文件绝对路径。
- 根不存在 **MUST** 返回空数组（不抛错）。

---

## 3. 资格判定：哪些文件「值得归档」

对每个扫描到的路径用 `isSyncableChatAsset(filePath)` 判定，**MUST** 同时满足三关：扩展名白名单 ∧ 路径非噪声 ∧ 文件名非噪声 ∧ 预览类型非「无用大件」。

### 3.1 可同步扩展名白名单 `syncableExt`

**MUST** 命中以下扩展名（大小写不敏感），否则淘汰：

```
文档：pdf docx doc pptx ppt xlsx xls csv txt md
压缩：zip rar 7z
代码：py ipynb cpp c h java js ts tsx html htm css
图片：png jpg jpeg gif webp bmp svg ico apng avif heic heif
视频：mp4 mov mkv webm avi m4v 3gp
音频：mp3 wav ogg m4a aac flac wma silk amr
```

### 3.2 噪声路径排除 `syncNoisePath`

路径**含**以下任一目录段（大小写不敏感、两侧 `\`）**MUST** 淘汰——头像/表情/日志/各类缓存/动态资源/安装升级/前端包/小程序临时等：

```
avatar  Emoji  baseemojisyastems  emoji-recv  emojirecv  emojirelated  OnlineStatus
log-cache  log/logs  xlog  cache  CacheStorage  Code Cache  Service Worker
Local Storage  Session Storage  IndexedDB  leveldb  blob_storage  Crashpad
GPUCache  DawnGraphiteCache  DawnWebGPUCache  dictionaries
DynamicResource  DynamicResourcePackage  dynamic_module  dynamic_package
packages  patch  upgrade  xplugin/XPlugin  xworker  publicLib  tbs  themes
locales  resources  node_modules  miniapp\temps  arks  qqex  shared dictionary
```

### 3.3 噪声文件名/扩展排除 `syncNoiseFile`

扩展名为以下任一 **MUST** 淘汰（含**加密 `.dat`**、数据库、各类日志、二进制/可执行/安装件）：

```
log  xlog  qqxlog  dat  db  db-shm  db-wal  ldb  sst
tmp  bak  ini  map  dmp  pak  bin  dll  exe
```

> `.dat` 在此被排除 = §1 第 3 条「跳过加密 `.dat`」的落点。`.db*` 被排除 = 不把聊天数据库当文件归档（聊天走解析管线）。

### 3.4 预览类型兜底排除

通过上面三关后，**MUST** 再算 `previewFor(filePath)`（见 §5），若结果属 `download` / `font` / `database` 则 **MUST** 淘汰（无预览价值的下载占位、字体、数据库）。

---

## 4. 去重（两级）

### 4.1 同目录同名「序号最大」`chooseLatestSerial`

微信/QQ 落盘常生成 `name`、`name(1)`、`name(2)` 这类同内容多副本。**MUST** 在**同一目录内**按「去序号的基名」分组，只保留序号最大者。

- `duplicateStem(name)`：用 `/^(.*?)(?:\((\d+)\))?$/` 拆基名与括号序号，`key = <基名小写><扩展小写>`，`serial = 括号内数字（无则 0）`。
- 分组键 **MUST** 含目录：`scopedKey = <dirname 小写>\<key>`（即**仅**同目录内去重，不同目录的同名文件各自保留）。
- 同 `scopedKey` 下 **MUST** 保留 `serial` 最大的那个文件路径（`serial >= previous` 时覆盖，确保取到最高序号）。

### 4.2 全局 sha256 去重

- 对通过资格+序号去重的文件，**MUST** 计算 `sha256(file)`（读全文件做 SHA-256 十六进制）。
- 维护 `seenHashes` 集合；**内容完全相同**（hash 已见过）**MUST** 跳过、`duplicateCount++`。
- 这一步跨目录、跨 app 去重（同一文件存在于微信和 QQ 两处时只留一份）。

### 4.3 去重计数

- `duplicateCount` 初值 **MUST** = `discovered.length - eligible.length`（序号去重淘汰的数量），再加上 sha256 命中的数量与空文件，最终写入 manifest 的 `duplicatesSkipped`。
- 大小为 0 的文件（`stat.size === 0`）**MUST** 跳过（不计入归档）。

---

## 5. 预览类型 `previewFor`（决定能否预览、也参与资格判定）

`previewFor(filePath)` **MUST** 按扩展名/特征返回单一标签，顺序敏感（先匹配先返回）：

| 条件 | preview |
|---|---|
| `.db/.sqlite/.sqlite3/.db-wal/.db-shm` 或路径含 `\nt_db\` | `database` |
| `png jpg jpeg gif webp bmp svg ico apng avif` | `image` |
| `mp4 webm mov mkv` | `video` |
| `amr silk` | `voice` |
| `mp3 wav ogg` | `audio` |
| `ttf otf woff woff2` | `font` |
| `pdf` | `pdf` |
| `docx` | `docx` |
| `xlsx xls csv` | `sheet` |
| `html htm` | `html` |
| `json` | `json` |
| `md markdown` | `markdown` |
| 基名为 `log/log.old/current/manifest-<n>` | `text` |
| `txt json log xml yml yaml toml ini cfg conf config plist pem key crt cer lic manifest` | `text` |
| `pptx ppt ppsx` | `presentation` |
| `zip rar 7z` | `archive` |
| `.effect` | `code` |
| `py ipynb js ts tsx cpp c h java html css lua` | `code` |
| 其它 | `download` |

> 资格判定（§3.4）会淘汰 `download/font/database`，但 `previewFor` 本身在归档清单里仍如实标注通过项的预览类型，供前端预览引擎调度（DocxPreview / SheetPreview / ImagePreview / VoicePreview / DatabasePreview / ArchivePreview / TextPreview…）。

---

## 6. 分类 `classify`（一级分类 + 次级路径）

返回 `{ category: Category, subcategory: string[] }`。一级分类是 `archive/` 下的顶层目录。

### 6.1 一级分类全集

`Category` **MUST** 为以下枚举之一（含兜底）：

```
过去  创业  AI  树林  学业  专业  比赛           ← 关键词主类（项目核心叙事）
生活  健康  项目  财务  旅行  阅读  工具  人物  素材   ← 关键词次类
未归类                                          ← 兜底（理论上不应大量出现）
```
> 占位符：`{{一级分类}}` 即本集合；复刻到别人数据时分类名 **MAY** 调整，但**关键词正则与默认规则必须随之保持自洽**。

### 6.2 关键词正则分类器 `categoryKeywords`

**MUST** 按以下**顺序**逐条对「`路径（\\→/）`」做正则测试，**第一个命中**即为一级分类（顺序即优先级，靠前优先）：

| 顺序 | 一级分类 | 关键词正则（要点） |
|---|---|---|
| 1 | `AI` | 独立词 `ai` / 人工智能 机器学习 深度学习 llm prompt gpt openai claude deepseek 大模型 神经网络 agent 多模态 stable diffusion comfyui |
| 2 | `比赛` | 比赛 竞赛 挑战杯 互联网+ 大创 数学建模 建模 赛道 路演 答辩 赛 锦兰杯 创新创业大赛 |
| 3 | `创业` | 创业 商业计划 bp 融资 商业 公司 产品 市场 运营 增长 获客 简历 resume offer 求职 校招 实习 内推 生涯 职业规划 教培 项目计划 |
| 4 | `树林` | 树林 forest tree 植物 生态 自然 森林 |
| 5 | `专业` | 解剖 生理 生化 组胚 病理 药理 临床 基础医学 医学 科研 论文 课题 实验报告 细胞 免疫 分子 病例 |
| 6 | `学业` | 学业 课程 作业 考试 期末 期中 复习 资料 讲义 笔记 真题 基医 强基 hust 华科 高数 微积分 线代 英语 四六级 思政 概率 物理 化学 导论 体育 讲座 |
| 7 | `项目` | roadmap 需求 prd 迭代 架构 方案 里程碑 开发文档 接口文档 |
| 8 | `健康` | 体检 病历 睡眠 健身 运动计划 饮食 心理 健康 |
| 9 | `财务` | 账单 发票 报销 预算 收入 支出 合同 银行 付款 收款 财务 |
| 10 | `旅行` | 旅行 旅游 机票 酒店 行程 车票 攻略 |
| 11 | `阅读` | 读书 摘录 读后感 article paper book epub 电子书 |
| 12 | `工具` | 脚本 配置 安装 插件 workflow 自动化 教程 指南 手册 cheatsheet |
| 13 | `人物` | 名片 通讯录 联系人 导师 老师同学 |
| 14 | `生活` | 照片 日常 家庭 聚会 回忆 生活 |

> 正则均大小写不敏感；`AI` 用 `(^|[^a-z])ai([^a-z]|$)` 防误命中含 ai 的英文词。复刻 **MUST** 照搬 `shared.ts` 的 `categoryKeywords` 原文（本表是其语义摘要，正则细节以源码为准）。

### 6.3 默认分类（无关键词命中时）

**MUST** 按扩展名兜底：
- 文档类（`pdf docx doc pptx ppt xlsx xls csv txt md`）→ **默认 `学业`**。
- 媒体类（`png jpg jpeg gif webp bmp mp4 mov mkv webm mp3 wav ogg silk amr`）→ **默认 `过去`**。
- 压缩类（`zip rar 7z`）→ **`素材`**，次级固定 `['压缩包']`。
- 其它 → **`未归类`**。

> 已知增强项（本项目**未做**，记于边界分册）：大量聊天图片因无关键词被默认塞进 `过去`，可后续用 LLM 重分类细化；`.dat` 加密图需图片密钥才能还原（69,820 个，当前跳过）。

### 6.4 次级目录 `subcategoryFor(ext, text)`

一级分类下的二级（及三级）路径，**MUST** 按下列顺序判定（先匹配先用），用于 `archive/<一级>/<次级…>/`：

| 条件（路径含关键词 或 扩展名） | subcategory |
|---|---|
| 路径含 `Pic/Image/Thumb/Ori` 或图片扩展 | `['聊天影像']` |
| 路径含 `Video` 或视频扩展 | `['视频']` |
| 路径含 `Ptt/Audio/Voice` 或音频扩展 | `['语音']` |
| `.pdf` | `['文档','PDF']` |
| `.html/.htm` | `['文档','网页']` |
| `.json` | `['文档','结构化数据']` |
| `.docx/.doc/.md/.txt` | `['文档','文本']` |
| `.pptx/.ppt` | `['文档','演示']` |
| `.xlsx/.xls/.csv` | `['文档','表格']` |
| `.py/.ipynb/.js/.ts/.tsx/.cpp/.c/.h/.java/.html/.css` | `['代码']` |
| 其它 | `['其他']` |

---

## 7. 重跑前清理 `removePreviousArchive`

为保证归档幂等且不残留陈旧副本，每次运行前 **MUST**：

1. 若 `data/library.json` 不存在则直接返回（首跑）。
2. 读旧 manifest，对其中每个 `archivePath`：解析为绝对路径，**MUST** 校验其位于 `archive/` 根下（`target.startsWith(<archiveRoot>\)`），否则跳过——**绝不删 `archive/` 之外的文件**。
3. 对确属 `archive/` 内的真实文件 `fs.unlinkSync` 删除，记录其父目录。
4. 自底向上 `fs.rmdirSync` 清空已空的归档子目录（遇非空目录 `break`，不强删）。
5. 任意异常 **MUST** 吞掉并安全返回（清理失败不应阻断本次归档）。

> 这是 §1 第 5 条「清理只动自己」的实现：只删上次清单记过的、且在 `archive/` 内的文件。

---

## 8. 复制与清单产出

### 8.1 复制流程（逐文件）

对去重后的每个合格文件 `file`：
1. `stat = fs.statSync(file)`；`size===0` **MUST** 跳过。
2. `hash = sha256(file)`；命中 `seenHashes` **MUST** 跳过并计重。
3. `{ category, subcategory } = classify(file)`。
4. `cleanName = safeName(basename(file))`：**MUST** 把 `< > : " / \ | ? *` 与控制字符（`charCode < 32`）替换成 `_`，`trim()`；空则 `'unnamed'`。
5. 目标目录 `destDir = archive/<category>/<…subcategory>`，**MUST** `ensureDir`。
6. 目标路径 `dest = destDir/<cleanName>`。**若 dest 已存在且其 sha256 ≠ 本文件 hash**（重名但不同内容），**MUST** 改名为 `<基名>-<hash 前8位><ext>` 避免覆盖。
7. 仅当 `dest` 不存在时 **MUST** `fs.copyFileSync(file, dest)`（已存在同内容则免拷）。
8. **MUST** `fs.utimesSync(dest, stat.atime, stat.mtime)` 把副本时间对齐源（只动副本）。
9. 累加 `totalBytes += stat.size`，push 一条 `LibraryFile`。

### 8.2 `data/library.json`（`LibraryManifest`）

**MUST** 写出（结构与 `src/types/files.ts` 的 `LibraryManifest` / `LibraryFile` 一致）：

```jsonc
{
  "generatedAt": "<ISO 时间>",
  "roots": ["<最终生效的源根…>"],
  "files": [
    {
      "id":        "<sha256 前 20 位>",
      "name":      "<副本文件名>",
      "ext":       "<小写扩展，含点>",
      "mime":      "<mime.getType 结果，缺省 application/octet-stream>",
      "size":      <字节数>,
      "modified":  "<源 mtime ISO>",
      "category":  "<一级分类>",
      "subcategory": ["<次级…>"],
      "archivePath": "archive/<一级>/<次级>/<name>",   // 相对项目根、正斜杠
      "sourcePath":  "<源绝对路径>",
      "sourceApp":   "QQ | 微信 | 企业微信 | 未知",
      "preview":     "<§5 预览类型>",
      "sha256":      "<全 64 位>"
    }
  ],
  "stats": {
    "discovered":       <扫描总数>,
    "archived":         <归档数>,
    "duplicatesSkipped":<去重/跳过数>,
    "bytes":            <归档总字节>
  }
}
```

约束：
- `archivePath` **MUST** 是相对项目根的正斜杠路径（`path.relative(root, dest).replace(/\\/g,'/')`）。
- `files` **MUST** 排序：先按 `category`（`localeCompare(..,'zh-CN')`），再按 `name`（同上）。
- `sourceApp(file)` 判定：路径含 `WXWork`→`企业微信`；含 `Tencent Files`/`Roaming\QQ`/`Tencent\QQ`→`QQ`；含 `WeChat`/`xwechat`/`微信`→`微信`；否则 `未知`。
- `mimeFor` 用 `mime` 包；`writeJson` **MUST** 输出缩进 2 的 JSON。

### 8.3 `data/discovery.md`（人读报告）

**SHOULD** 另写一份 Markdown 报告（`data/discovery.md`）并打印到控制台，包含：生效源根列表、同步策略说明（只复制不移动、序号去重、sha256 去重、噪声排除）、结果统计（扫描数 / 归档数 / 去重数 / 体积 MB）。这是给人核对的，**非**程序契约。

---

## 9. 验证与规模锚点

复刻后 **SHOULD** 核对：
- `data/library.json` 的 `stats`：`discovered ≈ 87,052`、`archived ≈ 5,907`、`duplicatesSkipped ≈ 81,145`，`bytes ≈ 33.7GB`（本项目实测；复刻数字随机主数据变化）。
- `archive/` 下确实出现 `过去/ 学业/ AI/ …` 等一级目录及次级 `文档/PDF`、`聊天影像` 等。
- **若微信文件为 0** → 多半是 §2 的源根 Bug 未修（没枚举被迁移的 `{{微信存储根}}\*\msg`）；这是复刻最常见的失败。
- **若归档里混进 `.dat`/`.db`/日志** → §3.2/§3.3 噪声过滤没照搬。
- 源文件**全部应保持原状**（数量、字节、mtime 不变）——这是 §1 的硬性验收。

---

## 10. 复刻检查清单（Definition of Done）

- [ ] 源根含被迁移的微信存储根，并枚举每个 `xwechat_files\<wxid_*>\msg`；含 QQ `…\Tencent Files`（→ `{{QQ号}}\nt_qq\nt_data` 明文附件）。
- [ ] `syncableExt` 白名单 ∧ `syncNoisePath` ∧ `syncNoiseFile` ∧ 非 `download/font/database` 四关齐全；`.dat`/`.db*`/日志被排除。
- [ ] 同目录同名「序号最大」去重 + 全局 sha256 去重；空文件跳过；`duplicateCount` 计法如 §4.3。
- [ ] `classify`：关键词正则按序优先；文档默认 `学业`、媒体默认 `过去`、压缩 `素材`、其它 `未归类`；次级路径如 §6.4。
- [ ] 重跑前 `removePreviousArchive` 只删 `archive/` 内、上次 manifest 记过的文件。
- [ ] 只 `copyFileSync` 到 `archive/<一级>/<次级>/`；重名不同内容追加 `-<hash8>`；副本 `utimes` 对齐源。
- [ ] `data/library.json` 字段/排序/`archivePath` 正斜杠/`sourceApp` 判定如 §8。
- [ ] 全程只读源、原文件零改动、跳过加密 `.dat`、产物入 `.gitignore` 不上传。
