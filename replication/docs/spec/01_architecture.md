# 01 · 系统架构（Architecture）

> 承接 [00_overview.md](00_overview.md)。本文给出 ChatFiles 的**完整系统架构**：七层数据流、技术选型、当前仓库的**全量文件树**（每文件一句话职责），以及**强制性的架构规范**（≤300 行 / 文件、按职责拆分）。
> 各层的具体实现细节分散在专题文档：
> [02_data-sources.md](02_data-sources.md)、[03_decryption.md](03_decryption.md)、[04_parsing.md](04_parsing.md)、[05_archiving.md](05_archiving.md)、[06_insights.md](06_insights.md)、[07_server-api.md](07_server-api.md)、[08_frontend.md](08_frontend.md)、[09_ai-assistant.md](09_ai-assistant.md)、[10_data-products-and-boundaries.md](10_data-products-and-boundaries.md)、[11_conventions.md](11_conventions.md)。
> 操作类见 [../PROMPT.md](../PROMPT.md)、[../RUNBOOK.md](../RUNBOOK.md)、[../SKILLS.md](../SKILLS.md)、[../../AGENTS.md](../../AGENTS.md)。
>
> 关键词遵循 RFC-2119：**必须 (MUST)** / **应 (SHOULD)** / **可 (MAY)**。机器/账号相关值用 `{{占位符}}`。

---

## 1. 架构总览：七层数据流

ChatFiles 是一条**单向数据流水线** + 一个**实时读盘的服务/前端**。数据从机主原始数据出发，经过六次转换，最终被前端消费。复刻**必须**保持这一分层与单向性。

```
[ 原始数据(只读) ]
       │
   ① 定位 ───────────  在本机找到微信 xwechat_files / QQ Tencent Files 数据根
       │                （含被迁移到非 C 盘的情况）          → 02_data-sources.md
       ▼
   ② 解密 ───────────  对副本运行 work/crackv4.exe，从微信进程内存扫 encKey，
       │                逐页解密 → work/decrypted/wechat/<account>/*.db
       │                （QQ 正文未解密，记为边界）            → 03_decryption.md
       ▼
   ③ 解析 ───────────  scripts/parseWeChat.ts 读 work/decrypted/，
       │                把"每会话一表"schema 归一 → data/wechat.db
       │                （conversations / messages / contacts 三表）→ 04_parsing.md
       ▼
   ④ 归档 ───────────  scripts/archiveFiles.ts 扫源根 → 去重 → 分类 →
       │                只复制到 archive/<一级>/<次级>/，写 data/library.json
       │                                                       → 05_archiving.md
       ▼
   ⑤ 提炼 ───────────  prepChatDigests → work/chat-digest/*.txt；
       │                多 agent Workflow 扇出 → data/insights/conv/*.json；
       │                按类综述 → data/insights/boards/*.md          → 06_insights.md
       ▼
   ⑥ 服务端 ─────────  server/ (Express:3456) 实时读 data/ + archive/ + 源端，
       │                提供 /api/* JSON 与文件预览 / AI 代理         → 07_server-api.md
       ▼
   ⑦ 前端 ───────────  src/ (React 19 + Vite) 13 板块读 /api 渲染，
                        含全格式预览引擎 + 浮动 AI 助手          → 08/09_*.md
```

关键不变量（MUST）：

1. **单向**：①→⑤ 是离线批处理（`npm run ingest:*`）；⑥⑦ 是在线服务，只读 ①–⑤ 的产物与原始侧，**绝不**回写原始数据。
2. **副本边界**：解密只写 `work/decrypted/`；归档只复制到 `archive/`；提炼只写 `data/insights/`。原始目录全程只读。
3. **实时读盘**：`⑥` 中 `/api/wechat/*`、`/api/insights` 等**每次请求**重新读盘并 `db.close()`，故 `⑤` 跑完无需重启即可见。
4. **零外发**：除用户显式配置的 AI 接入（`⑦` 经 `server/routes/ai.ts` 本地代理）外，不出网。

> 紧凑数据流（与 [00_overview.md](00_overview.md) §6 成功标准一一对应）：
> `定位 → 解密(work/) → 解析(scripts→data/wechat.db) → 归档(scripts→archive/+library.json) → 提炼(Workflow→data/insights/) → 服务端(/api) → 前端(read /api)`。

---

## 2. 技术选型（Tech Stack）

复刻**必须**采用下列选型；选型本身是规格的一部分（多处依赖运行时内置能力，替换会破坏可复现性）。版本来自 `package.json`。

| 层 | 选型 | 备注 |
|----|------|------|
| 前端框架 | **React 19 + TypeScript** | `react@^19` / `react-dom@^19` |
| 构建工具 | **Vite 8**（`@vitejs/plugin-react`） | dev 端口 127.0.0.1:3456 |
| 服务端 | **Express 5** | `app.use(express.json({ limit: '24mb' }))` + `cors()` |
| 数据库 | **`node:sqlite`（`DatabaseSync`）** | Node 内置，**免原生依赖**；用于读 `data/wechat.db` 与只读探测源 `.db` |
| 压缩（JS 侧） | **Node 24 内置 zstd**（`node:zlib` 的 `zstdDecompressSync`） | 解微信文本的 zstd 正文（魔数 `28 b5 2f fd`） |
| 压缩（Python 侧） | **Python 3.14 内置 `compression.zstd` + `sqlite3`** | 解密 / 校验辅助脚本 |
| 脚本运行 | **tsx**（`npm run ingest:*`） | 直接跑 `.ts`，无需预编译 |
| 解密工具链 | **Go（self-hosted toolchain）+ mingw-w64 gcc**（`work/`） | 编译 `crackv4.exe`（纯 Go 无 CGO）；chatlog 参考实现用 CGO |
| Markdown 渲染 | **react-markdown + remark-gfm + rehype-highlight + highlight.js** | 渲染 boards / 总结 |
| 文档预览 | **docx-preview**（DOCX）、**read-excel-file**（XLSX）、**jszip**（ZIP/PPTX 解包） | 全格式预览引擎 |
| 富文本编辑 | **@tiptap/react + starter-kit + typography + placeholder** | 知识/笔记编辑能力 |
| 图标 | **lucide-react** | 导航与 UI 图标 |
| 其它 | **mime**（类型识别）、**gray-matter**（front-matter 解析）、**zustand**（轻量 store） | |
| 文档站点校验 | **playwright**（`scripts/check-docs.mjs`） | 验证 `/replication` 静态文档站点 |
| Lint | **eslint 10 + typescript-eslint + react-hooks/react-refresh 插件** | `eslint.config.js` flat config |

> 运行前置：机器**必须**有 Node 24（含内置 zstd）与 Python 3.14（含 `compression.zstd`）。解密前置：微信进程**必须**正在运行且已登录（密钥在进程内存里）。详见 [03_decryption.md](03_decryption.md)。

---

## 3. 完整仓库文件树（Repository File Tree）

下树为**当前仓库实测的源代码全量**（已剔除 `node_modules/`、`work/` 工具链中间物、生成的 `data/`、`archive/`、`docs/` 站点内容等被 `.gitignore` 的体量目录；这些目录的**用途**在 §3.5 单列）。每个源文件给出一句话职责。复刻方**必须**重建出结构对应的树。

### 3.1 根目录与配置

```
{{项目目录}}/
├─ package.json              依赖清单 + npm scripts（dev / build / 全部 ingest:* 管线 / start）
├─ package-lock.json         锁定依赖版本（npm）
├─ tsconfig.json             TS 根配置（project references → app / node）
├─ tsconfig.app.json         前端 src/ 的 TS 配置（DOM + React JSX）
├─ tsconfig.node.json        server/ 与 scripts/ 的 TS 配置（Node 环境）
├─ vite.config.ts            Vite 配置（React 插件、dev 端口/代理）
├─ eslint.config.js          ESLint flat config（ts + react-hooks + react-refresh）
├─ index.html               Vite HTML 入口（挂载 #root、引 main.tsx）
├─ README.md                项目说明
└─ .gitignore               忽略 node_modules / data / archive / work / dist 等
```

### 3.2 前端 `src/`（React 19 + TS，Vite 构建）

```
src/
├─ main.tsx                  Vite 入口：createRoot 渲染 <App/>
├─ App.tsx                   应用壳：13 板块状态、左侧双组导航渲染、各 Tab 路由分发、初始 fetch
├─ App.css                   样式 hub：@import styles/{layout,files,file-preview,workbenches,summary,boards,shared,ai}.css
├─ index.css                 设计令牌(:root) + 字体 import + 颗粒/发丝线/滚动条/淡入等全局质感
├─ types.ts                  barrel：re-export ./types/*（兼容旧的 'src/types' 导入路径）
│
├─ boards/                   页面级板块（每板块一个组件文件）
│  ├─ navConfig.tsx          【导航单一真源】Tab 联合类型 + NavItem + PRIMARY_NAV / CONFIG_NAV + TAB_TITLES
│  ├─ Overview.tsx           概览板：Fraunces 大号统计 + 各板块入口卡
│  ├─ Chat.tsx               聊天板容器：三栏布局、会话列表、搜索/筛选、自动分页编排
│  ├─ ChatMessageList.tsx    聊天气泡列表（从 Chat 拆出）：机主金色靠右、他人靠左、非文本 chip、日期分隔
│  ├─ ChatContext.tsx        聊天右侧上下文面板：摘要/话题/人物注脚 + 「AI 解析」浮窗 launcher
│  ├─ Insights.tsx           洞察板：左 13 类目 + 中按 importance 排序的 nugget 卡 + 顶部渲染 boards[类].md
│  ├─ Academics.tsx          学业板：身份框定 + 课程站点入口 + 学业/专业 nugget
│  ├─ Files.tsx              文件板：归档/源文件模式切换 + TreeView + FilePreview 面板
│  └─ AISettings.tsx         AI 配置板：baseURL/apiKey/model/threshold/temperature 表单 + 连通性探测
│
├─ components/
│  ├─ ai/
│  │  └─ AIChatDock.tsx      浮动 AI 对话框：拉会话 transcript、估算 token、流式对话（streamChat）
│  ├─ file-preview/          多格式预览引擎（每种格式一个文件，调度组件统一入口）
│  │  ├─ FilePreview.tsx     预览调度组件：按 preview 类型分发到下列各渲染器
│  │  ├─ DocxPreview.tsx     DOCX 预览（docx-preview）
│  │  ├─ SheetPreview.tsx    表格预览（CSV 解析 + XLSX via read-excel-file）
│  │  ├─ PptxPreview.tsx     PPTX 预览（jszip 解包幻灯片）
│  │  ├─ ImagePreview.tsx    图片预览
│  │  ├─ VoicePreview.tsx    语音预览（AMR/SILK 经服务端转码后播放）
│  │  ├─ DatabasePreview.tsx 数据库预览（调 /api/.../database 读表结构与样本行）
│  │  ├─ ArchivePreview.tsx  压缩包预览（ZIP/TAR 列出条目）
│  │  ├─ TextPreview.tsx     文本/Markdown/JSON/代码/HTML 预览（react-markdown + highlight）
│  │  ├─ FontPreview.tsx     字体文件预览（字形/字重示例）
│  │  └─ GenericInspector.tsx 兜底检查器：未知格式显示 /inspect 元信息与十六进制摘要
│  ├─ workbenches/           配置组/证据工作台面板（每板一个 reader 组件）
│  │  ├─ SummaryReader.tsx   「总结」板：渲染全局总结（证据分层）
│  │  ├─ ChatClueReader.tsx  「线索」板：聊天线索档案，关联归档文件可点开
│  │  ├─ ChatSynthesisReader.tsx 「聊天整理」板：按主题分层的综合整理阅读器
│  │  ├─ MediaReview.tsx     「媒体」板：归档媒体网格复核（增量挂载）
│  │  ├─ DatabaseWorkbench.tsx 「数据库」板：只读 .db 探测结果与可读边界
│  │  ├─ ValueCandidateWorkbench.tsx 「候选」板：未归档价值候选清单 + 打开预览
│  │  └─ KnowledgeReader.tsx 「知识」板：源状态卡 + 结构化知识小节
│  └─ shared/
│     └─ TreeView.tsx        通用 VS Code 式文件树组件（折叠/选中/图标）
│
├─ hooks/                    自定义 React Hooks
│  ├─ useVisibleCount.ts     IntersectionObserver 增量挂载：sentinel 进视口就多渲染一批（媒体/卡片墙防卡）
│  └─ useInView.ts           sentinel 回调 hook：节点进视口触发 onEnter（聊天自动翻页）
│
├─ utils/                    纯函数工具
│  ├─ format.ts              formatBytes / fileNameFromPath / fmtDate 等展示格式化
│  ├─ tree.ts                BrowsableFile 类型 + 由 manifest 构建文件树 + 文件 URL helpers
│  ├─ constants.ts           各类响应的空状态默认值（emptyOverview / emptyInsights / …）
│  └─ aiConfig.ts            AIConfig 类型 + load/save(localStorage) + estimateTokens + streamChat(经本地代理流式)
│
├─ types/                    类型定义（按领域拆分）
│  ├─ index.ts               re-export hub：汇总下列领域类型
│  ├─ files.ts               文件/归档/源文件/预览相关类型（LibraryManifest / BrowsableFile 等）
│  ├─ chat.ts                聊天/线索/综合/会话相关类型（WechatConversation / ChatClueDossier 等）
│  └─ insights.ts            洞察/知识/候选/总结相关类型（InsightsResponse / KnowledgeBase 等）
│
└─ styles/                   样式模块（每文件 < 300 行，聚合文件用 @import 串联叶子）
   ├─ layout.css             应用壳/左轨/顶栏/工作区布局
   ├─ files.css              文件板布局
   ├─ summary.css            总结板样式
   ├─ ai.css                 AI 配置板 + AIChatDock 浮窗样式
   ├─ shared.css             通用片段（聚合：→ shared-markdown.css）
   ├─ shared-markdown.css    Markdown 渲染排版（标题/引用/代码块等）
   ├─ boards.css             板块聚合（@import boards-overview/chat/chat-context/insights/academics）
   ├─ boards-overview.css    概览板样式
   ├─ boards-chat.css        聊天板三栏 + 气泡样式
   ├─ boards-chat-context.css 聊天右侧上下文面板样式
   ├─ boards-insights.css    洞察板类目/卡片样式
   ├─ boards-academics.css   学业板样式
   ├─ file-preview.css       预览聚合（@import file-preview-layout/renderers/data）
   ├─ file-preview-layout.css 预览面板布局
   ├─ file-preview-renderers.css 各格式渲染器样式（docx/sheet/pptx/image/font/text…）
   ├─ file-preview-data.css  数据类预览样式（database/archive/inspector）
   ├─ workbenches.css         工作台聚合（@import workbenches-layout/clue/media/database-value/synthesis）
   ├─ workbenches-layout.css  工作台通用布局
   ├─ workbenches-clue.css    线索板样式
   ├─ workbenches-media.css   媒体复核网格样式
   ├─ workbenches-database-value.css 数据库 + 候选板样式
   └─ workbenches-synthesis.css 聊天整理板样式
```

> `src/assets/`（`hero.png` / `react.svg` / `vite.svg`）为静态图像资产，非逻辑文件，复刻方**可**替换为自有素材。

### 3.3 服务端 `server/`（Express 5）

```
server/
├─ index.ts                  入口（< 50 行）：cors + json(24mb) + 挂载 6 路由 + /docs 与 /replication 静态 + dist/SPA 回退
├─ routes/                   按 API 领域拆分的路由模块（每文件一域）
│  ├─ data.ts               /api/library /api/source-library /api/summary /api/knowledge /api/chat-clues 等 JSON 数据
│  ├─ files.ts              /api/file/:id/(text|archive|voice|voice.wav|inspect|database) + /files/:id 归档文件操作
│  ├─ source-files.ts       /api/source-file/:id/* + /source-files/:id 源文件只读操作
│  ├─ wechat.ts             /api/overview? + /api/wechat/conversations + /conversation/:id/messages + 导出 wechatDb()
│  ├─ insights.ts           /api/insights（聚合 conv/*.json + 读 boards/*.md）+ /api/overview 总量
│  └─ ai.ts                 /api/wechat/conversation/:id/transcript（会话全文）+ POST /api/ai/chat（流式 AI 代理，密钥透传不落盘）
└─ utils/                   服务端工具
   ├─ helpers.ts            root / readJson / library / resolveFile 等路径与读盘辅助
   ├─ inspect.ts            文件检查：inspectFile / inspectArchive / inspectSqlite（只读探测）
   └─ voice.ts              语音转码：transcodeVoice / voiceCachePath（AMR/SILK → 可播放 wav）
```

> `server/routes/ai.ts` 由 `wechat.ts` 导入 `wechatDb()` 复用同一个 SQLite 打开逻辑。`server/index.ts` 现已 `app.use(express.json({ limit: '24mb' }))` 并 `app.use(aiRouter)`（AI 代理路由）。

### 3.4 数据管线 `scripts/`（tsx 运行）

```
scripts/
├─ shared.ts                 脚本间共享：root/dataDir/home、candidateRoots、walkFiles、sha256、分类器 classify/categoryKeywords、writeJson、isEligibleAttachment
├─ parseWeChat.ts            解析微信 4.0 decrypted/*.db（每会话一表）→ data/wechat.db 三表 + index.json + work/chat-text/*.txt
├─ archiveFiles.ts           扫源根 → 去重(同名序号 + 全局 sha256) → 关键词分类 → 只复制到 archive/ → 写 data/library.json
├─ prepChatDigests.ts        对 text_count≥20 会话各生成 ≤48000 字 digest（work/chat-digest/*.txt，超大群按信息量抽样）+ _manifest.json
├─ discoverSources.ts        只读枚举各源根（QQ Tencent Files / nt_data / QQ Roaming 等）产出源发现清单
├─ buildDeepIndex.ts         深度索引：对源端文件建全量索引（data/deep-index.json）供候选/审计用
├─ buildValueCandidates.ts   从 deep-index 减去已归档(sourcePath/sha256)，按 preview 类型挑出价值候选 → data/value-candidates.json
├─ promoteValueCandidates.ts 把确认有价值的候选提升/补归档
├─ analyzeDatabases.ts       只读探测发现的 .db（表/行数/可读边界），产出数据库分析（含 QQ 边界）
├─ analyzeSourceText.ts      分析源端文本类文件，抽取可读文本信号
├─ scanBinaryText.ts         从二进制/未知文件中扫可见文本片段
├─ scanLogText.ts            从日志类文件中扫可读文本
├─ fetchCourseData.ts        抓取/整理课程（教务）数据，供「学业」板
├─ buildKnowledge.ts         构建知识库（源状态卡 + 结构化小节）→ data/knowledge.json
├─ buildChatClueDossier.ts   从聊天抽取线索（待办/承诺/事实）→ data/chat-clues.json，关联归档文件
├─ buildChatSynthesis.ts     聊天综合整理：按主题分层重组证据 → data/chat-synthesis.json
├─ buildCompletionAudit.ts   完成度审计：核对各产物覆盖率/缺口
├─ ingestChatExports.ts      导入外部聊天导出（非内存解密路径的补充入口）
├─ buildSummary.ts           全局总结生成入口：调度 summary/* 各模块
├─ check-docs.mjs            文档站点验证（Playwright 访问 /replication 校验可渲染）
├─ summary/                  总结生成子模块（buildSummary 的实现拆分）
│  ├─ types.ts               总结相关类型
│  ├─ utils.ts               总结生成共用工具
│  ├─ evidence.ts            证据收集与分层
│  ├─ aggregate.ts           跨源聚合统计
│  ├─ boards.ts              总结板段落装配
│  └─ boardSections/         各板块段落生成器
│     ├─ overview.ts         概览段
│     ├─ chat.ts             聊天段
│     ├─ coverage.ts         覆盖率段
│     └─ misc.ts             杂项段
└─ ingest/                   导入解析子模块
   ├─ constants.ts           导入相关常量
   └─ parsers.ts             各类导出格式解析器
```

> 全部脚本经 `package.json` 的 `ingest:*` script 暴露；`npm run ingest` 串起完整顺序（courses → discover → deep → databases → binary-text → logs → source-text → files → chat-exports → chat-clues → chat-synthesis → value-candidates → promote → value-candidates → knowledge → audit → summary）。微信解密 / 解析(`parseWeChat`) / digest 准备(`prepChatDigests`) 与提炼 Workflow 在此串之外单独运行（见 [03/04/06]）。

### 3.5 生成/工具目录（被 .gitignore，不入源树但**必须**存在）

```
{{项目目录}}/
├─ data/        生成数据：wechat.db、library.json、insights/（conv/*.json + boards/*.md + _manifest.json）、knowledge.json、各 *-analysis/*.json
├─ archive/     归档文件副本：archive/<一级分类>/<次级>/...（只复制写入，原文件不动）
├─ work/        工具链与中间物：go-toolchain/、mingw64/、chatlog-build/（含 tools/crackv4）、crackv4.exe、decrypted/、chat-text/、chat-digest/、insights-cat/
├─ docs/        静态文档站点（由 server /docs 提供）
├─ dist/        Vite 生产构建产物（存在则服务端优先用它做 SPA）
└─ replication/ 复刻文档包（本目录；server /replication 静态提供，.md 以 text/markdown 返回）
```

`replication/` 当前内容：

```
replication/
├─ 00_README.md / 01_PROMPT.md / 02_SPEC.md / 03_SKILLS.md / 04_RUNBOOK.md   旧版顶层文档
└─ docs/spec/   复刻规格分篇（本文所在）：00_overview.md / 01_architecture.md / 02_… ~ 11_…
```

---

## 4. 强制架构规范（Mandatory Architecture Rules）

下列规则是**强制**的。任何复刻或后续修改**必须**满足；违反**必须**在合入前修正。

### 4.1 ≤300 行 / 文件（硬约束，MUST）

- 任何 `.ts` / `.tsx` / `.css` 文件**必须** ≤ 300 行。一旦逼近，**必须**按职责拆分为多个文件。
- **唯一例外**：自动生成文件与第三方 vendor 文件（如 `package-lock.json`、`work/` 下的工具链源码）。这些不计入约束，也**不应**手改。
- 实测状态：当前仓库全部源文件已达标。聚合方式见下文（CSS @import 串联、barrel re-export、路由按域拆分）。

### 4.2 按职责拆分（MUST）

一个文件只做**一件事**：一个 React 组件、一个路由模块（一个 API 域）、一个工具集、一个类型域、一个样式叶子。具体落点：

| 维度 | 规则 | 当前实现 |
|------|------|----------|
| **React 组件** | 每个组件独立文件，PascalCase 命名；组件超过 ~150 行**应**提取子组件。 | `Chat.tsx` 已拆出 `ChatMessageList.tsx` / `ChatContext.tsx`；`AIChatDock` 独立于 `AISettings`。 |
| **页面板块** | 页面级板块放 `src/boards/`，一板一文件。 | Overview/Chat/Insights/Academics/Files/AISettings 等。 |
| **导航单一真源** | `Tab` 联合类型、`PRIMARY_NAV`/`CONFIG_NAV`、`TAB_TITLES` **必须**集中在 `src/boards/navConfig.tsx`，禁止散落。 | `navConfig.tsx`。 |
| **文件预览** | 每种格式一个渲染器文件，统一由调度组件分发。 | `components/file-preview/*`（11 个渲染器 + `FilePreview.tsx` 调度）。 |
| **工作台** | 每个配置组/证据板一个 reader 组件。 | `components/workbenches/*`（7 个）。 |
| **服务端路由** | 每个 API 领域一个路由文件；`server/index.ts` 只做挂载（< 50 行）。 | 6 路由（data/files/source-files/wechat/insights/ai）+ 3 utils。 |
| **类型** | 类型按领域放 `src/types/`（files/chat/insights），`index.ts` 汇总，`src/types.ts` barrel 兼容旧路径。 | 3 域文件 + index + barrel。 |
| **样式** | 全局设计令牌放 `src/index.css`；板块样式按 `src/styles/` 叶子文件拆分，聚合文件用 `@import` 串联，`App.css` 为总 hub。 | App.css → 8 个 @import → 4 个聚合 → 共 26 个叶子/聚合文件。 |
| **脚本** | 数据管线放 `scripts/`；复杂脚本拆子模块目录。 | `buildSummary` 拆 `scripts/summary/*`（含 `boardSections/`）；导入拆 `scripts/ingest/*`。 |
| **Hooks** | 自定义 hooks 放 `src/hooks/`，camelCase。 | `useVisibleCount.ts` / `useInView.ts`。 |
| **纯函数** | 工具放 `src/utils/`，camelCase。 | `format.ts` / `tree.ts` / `constants.ts` / `aiConfig.ts`。 |

### 4.3 命名约定（MUST）

- React 组件文件：**PascalCase**（`ChatContext.tsx`、`AIChatDock.tsx`）。
- 工具 / hooks / 类型 / 配置文件：**camelCase**（`aiConfig.ts`、`useInView.ts`、`navConfig.tsx`、`chat.ts`）。
- 样式叶子：kebab-case，按归属前缀分组（`boards-chat.css`、`file-preview-data.css`、`workbenches-synthesis.css`）。
- API 路由文件以其领域命名（`wechat.ts`、`insights.ts`、`ai.ts`）。

### 4.4 聚合机制（保持 300 行约束的手段）

复刻**应**沿用以下三种聚合手段，使每个叶子文件保持小而专、同时对外仍是单一入口：

1. **CSS `@import` 串联**：`App.css` → `styles/*.css` 聚合文件 → 各叶子（如 `boards.css` → `boards-chat.css` 等）。
2. **类型 barrel re-export**：`src/types/index.ts` 汇总领域类型，`src/types.ts` 再 re-export 以兼容历史 `'../types'` 导入路径。
3. **路由模块挂载**：`server/index.ts` 仅 `app.use(<router>)`，每个 router 自带自己的 `/api/*` 前缀。

### 4.5 实时读盘与无副作用（MUST）

- `/api/wechat/*`、`/api/insights` 等数据接口**必须**每次请求实时打开/读取/关闭数据库与 JSON，**不得**长期持有写句柄；这样 ⑤ 提炼/修复后无需重启即可见。
- 服务端与脚本**不得**对原始数据目录写入；解密/归档/提炼的写入路径**必须**限定在 `work/decrypted/`、`archive/`、`data/` 内（呼应 [00_overview.md](00_overview.md) §5 安全红线）。

---

## 5. 与其它文档的衔接

- 各层的**实现细节**：定位 [02](02_data-sources.md) → 解密 [03](03_decryption.md) → 解析 [04](04_parsing.md) → 归档 [05](05_archiving.md) → 提炼 [06](06_insights.md) → 服务端 [07](07_server-api.md) → 前端 [08](08_frontend.md) → AI [09](09_ai-assistant.md)。
- **产出物清单与已知边界**（QQ 正文、`.dat` 加密图）：[10_data-products-and-boundaries.md](10_data-products-and-boundaries.md)。
- **代码 / 命名 / 提交 / lint 约定**：[11_conventions.md](11_conventions.md)。
- **可执行的提示词 / 运行手册 / 技能 / agent 守则**：[../PROMPT.md](../PROMPT.md) · [../RUNBOOK.md](../RUNBOOK.md) · [../SKILLS.md](../SKILLS.md) · [../../AGENTS.md](../../AGENTS.md)。
