# 08 · 前端规格（午夜书斋 / Midnight Study）

> 用 **frontend-design skill** 实现——审美方向是规格的一部分（见 [`../SKILLS.md`](../SKILLS.md)）。本篇规定设计系统、板块拆分、各板块内容，以及本轮新增的**独立滚动、懒加载/虚拟化、导航重组**。AI 助手的前端见 [`09_ai-assistant.md`](09_ai-assistant.md)。

## 1. 设计系统

### 1.1 设计令牌（`src/index.css :root`）
直接采用本包根目录的 [`../../global.css`](../../global.css)。核心：

- 背景：`--bg:#14110d --bg-2:#1b1712 --bg-3:#221d17`；分隔 `--line:#2e271f --line-2:#3a3127`。
- 文字三阶：`--ink:#ece3d4 --ink-soft:#b7ab97 --ink-mute:#8a7e6c`。
- 点缀：`--gold:#d8a24a --gold-2:#e9c079 --jade:#79a99a --rust:#c0653a`（金为主，玉/锈为辅）。
- 形状：`--radius:10px --radius-lg:16px`；暖阴影 `--shadow`。

### 1.2 字体
Google Fonts：展示衬线 **Fraunces**、正文无衬线 **Hanken Grotesk**、等宽 **JetBrains Mono**；每个 family **必须**追加 CJK 栈 `"PingFang SC","Microsoft YaHei","Source Han Sans CN"`。

### 1.3 质感
feTurbulence 纸感颗粒叠层(~3%)、金色发丝分割线、双径向暖光晕（固定）、自定义细滚动条、`ms-rise` 错峰淡入。

## 2. 应用壳与导航（`src/App.tsx` + `src/boards/navConfig.tsx`）

左侧细栏 `84px`，品牌徽标 + **两组导航**（本轮重组）：

- `PRIMARY_NAV`（**成果组**，上半）：概览 · 聊天 · 文件 · 洞察 · 学业 · **媒体**。
- 下半 = 一个**「配置」组按钮** + 两个独立按钮 **知识** · **AI**：
  - `CONFIG_SUB`（5 个工作台板块：**总结 · 线索 · 聊天整理 · 数据库 · 候选**）**收进单个「配置」按钮**——点「配置」时在内容区顶部弹出**二级菜单**（`.config-subnav` 胶囊标签）供选择；`CONFIG_TAB_IDS` 用于判定「配置」是否高亮。
  - `LOWER_NAV`（**知识 · AI**）仍是独立的一级按钮。

`navConfig.tsx` 导出 `Tab`、`NavItem`、`PRIMARY_NAV`、`CONFIG_SUB`、`LOWER_NAV`、`CONFIG_TAB_IDS`、`TAB_TITLES`。`App.tsx`：`renderNav(PRIMARY_NAV,'成果')` 渲染上半；下半手写「配置」按钮（`onClick` → `setActiveTab(lastConfig)`，`lastConfig` 记住上次选的子板块，默认 `summary`）+ `LOWER_NAV`；当 `activeTab ∈ CONFIG_TAB_IDS` 时 `workspace` 加 `cfg` 类并在 topbar 下渲染 `.config-subnav` 二级菜单。`.workspace.cfg` 把这 5 个定高板块的 `height` 降到 `calc(100vh - 258px)` 给二级菜单让位。

> 重组动机：把"直接展示成果"的板块（含**媒体**）放上半；把 5 个"工作台/证据"板块**合并到一个「配置」入口 + 二级菜单**，下半只剩「配置 / 知识 / AI」三个按钮，左栏更克制。

## 3. 板块拆分规范

前端**必须**按 300 行限制拆分为独立文件：

| 目录 | 职责 | 示例 |
|------|------|------|
| `src/boards/` | 页面级板块 | Overview, Chat, ChatContext, ChatMessageList, Insights, Academics, Files, AISettings, navConfig |
| `src/components/file-preview/` | 多格式预览（每种一文件） | Docx/Sheet/Pptx/Image/Voice/Database/Archive/Text/Font/GenericInspector/FilePreview |
| `src/components/workbenches/` | 工作台面板 | SummaryReader, ChatClueReader, ChatSynthesisReader, MediaReview, DatabaseWorkbench, ValueCandidateWorkbench, KnowledgeReader |
| `src/components/ai/` | AI 助手 | AIChatDock |
| `src/components/shared/` | 通用 | TreeView |
| `src/hooks/` | 自定义 hooks | useVisibleCount, useInView, useGridVirtualizer |
| `src/utils/` | 纯函数 | format(formatBytes/fmtDate), tree, constants, aiConfig |
| `src/types/` | 领域类型 | index(barrel), files, chat, insights |
| `src/styles/` | 样式（`@import` 聚合） | layout, files, file-preview*, workbenches*, boards*, summary, shared, ai |

## 4. 各板块内容

- **Overview**：大号衬线标题 + Fraunces 数字统计 + 入口卡。
- **Chat**（三栏）：会话列表（搜索 / 全部·群·私 + 群/私 chip）| 消息气泡流（机主金色靠右"我·羽升"、他人左、非文本显 `[图片]` 等 chip、日期分隔、会话内搜索）| 右栏 `ChatContext`（摘要/话题/关键人物/事实 + **「AI 解析」**按钮）。
- **Insights**：左类目（13 类 + 计数）| 中 importance 排序的 nugget 卡（懒加载）+ 顶部渲染 `boards[类].md`。
- **Academics**：身份框定 + 课程站点入口 + 学业/专业 nugget。
- **Files**（`Files.tsx`）：模式切换（归档/源文件）+ `TreeView` 懒展开 + `FilePreview` 多格式面板；状态（fileMode/selected/filter）提升到 `App`，便于工作台深链跳转。
- **媒体 / 数据库 / 候选 / 线索 / 整理 / 总结 / 知识**：各自工作台组件。
- **AI**（`AISettings`）：接口配置板块（见 [`09_ai-assistant.md`](09_ai-assistant.md)）。
- **多格式预览引擎必须保留**：Docx/Sheet(CSV·XLSX)/Pptx/Font/Image/Voice(AMR·SILK 转码)/Database/Archive(ZIP·TAR)/Text(md·json·code·html)。每个独立文件、≤300 行。

## 5. 独立滚动（本轮修复）

**问题**：三栏板块若只给 `min-height`，整页会一起滚动、左侧栏被带走。
**规则**：三栏/双栏工作台外壳**必须**定高 + 裁剪，子项允许收缩：

```css
.files-layout, .knowledge-grid, .summary-layout,
.clue-workbench, .media-review, .database-workbench,
.value-workbench, .chat-synthesis {
  display: grid; gap: 16px;
  height: calc(100vh - 200px);   /* 定高外壳 */
  min-height: 560px; overflow: hidden;
}
/* 上述选择器的直接子项 */ > * { min-height: 0; }
```

各列自身 `overflow:auto`，于是**左/中/右各自独立滚动**，互不牵连。`.chat3` 用 `calc(100vh - 168px)` 同理。

## 6. 懒加载 / 虚拟化 / 媒体缩略图（防卡死）

海量列表（媒体网格数千张图、洞察碎金、超长聊天）**禁止**一次性挂载——否则瞬间发起数千网络请求、DOM 爆炸卡死。手机相册上万张图不卡靠**三件事**，本项目逐条对齐：**①只加载小缩略图（不碰原图）②卡片按视口回收（live 元素数 = O(可视) 而非 O(总数)）③不用重量级 `<video>` 做封面**。

### 6.1 媒体网格：服务端缩略图 + 真·视口虚拟化（核心）

媒体板块 `MediaReview.tsx` 面对 3,779 图 + 474 视频（最大约 1GB），若像普通列表那样 `<img src={原图}>` + `<video>` 必卡。两层深度优化：

- **服务端缩略图服务（手机的"缩略图缓存"）**——见 [`07_server-api.md`](07_server-api.md) `GET /api/(source-)file/:id/thumb?w=`，用 **ffmpeg**（与语音转码同一二进制）把图缩成 ~360px WebP、把视频**抽第 1 秒一帧**做 poster，落盘 `work/thumb-cache/`，发 `Cache-Control: immutable`。前端 `thumbUrl(file, 360)`（`src/utils/tree.ts`）指向它。实测 9.8MB 原图→**~40KB**、1GB 视频→**~9KB** poster；每格下载与解码量降一两个数量级。
- **真·虚拟化（回收，类 RecyclerView/UICollectionView）**——`src/hooks/useGridVirtualizer.ts`：以 `overflow:auto` 滚动容器为基准，按 `clientWidth` 算列数（镜像 `auto-fill/minmax`）、按 `rowH=卡片高+gap` 算行，**只挂载视口 ± `overscan` 行、其余卸载**。滚动容器撑到 `totalHeight` 全高，挂载窗口 `position:absolute` + `translateY(行号*rowH)` 落到真实行；`rAF` 节流 scroll、`ResizeObserver` 跟随宽度。结构：`.media-grid`(滚动) → `.media-sizer`(撑高) → `.media-window`(绝对定位网格，`grid-template-columns` 内联 `repeat(cols, …)`)。**无论上万文件，live 卡片数恒为几十**（实测 4,350 项时只挂载 ~30）。
- **视频不渲染 `<video>`**：网格视频格用 poster `<img>` + `.media-play` ▶ 角标（`MediaThumb` 组件，`onError` 回退到图标），点开才进右栏真播放器——干掉数百个最重的媒体元素。
- 卡片高度在 CSS 与 JS 常量（`CARD_H/GAP/PAD/MIN_COL`）**两边对齐**，行距才精确；筛选变化时把滚动容器 `scrollTo(0,0)` 复位。

### 6.2 中等列表：增量挂载 + content-visibility

- **`src/hooks/useVisibleCount.ts`**：`IntersectionObserver` 增量挂载。`useVisibleCount(total, step, resetKey)` 返回 `{count, sentinelRef, done}`；渲染 `items.slice(0, count)`，切片下方放 `sentinelRef` 哨兵；`resetKey`（筛选/类目）变化回到首批。**Insights** 用 `step=36`。（媒体板块已升级为 6.1 的真虚拟化，不再用本 hook。）
- **`src/hooks/useInView.ts`**：`useInView(onEnter, enabled)` 哨兵进入视口即回调。**Chat** 用它把"手动加载更多"改成**下滑自动翻页**：会话从最旧一页开始、滚到底自动拉更新一页（`PAGE=400`）。
- **`content-visibility`**：聊天气泡 `.msg { content-visibility:auto; contain-intrinsic-size:auto 52px; }` + 线程容器 `overflow-anchor:auto`——浏览器原生剔除离屏气泡、首绘后记住真实高度避免跳动，**"较远上方不渲染"**。
- 统一的加载哨兵样式：`.lazy-sentinel`。

## 7. 机主身份（隐私）

机主的 wxid / 显示名**不得硬编码进仓库**。`src/boards/ChatMessageList.tsx` 经 Vite 环境变量注入：

```ts
const OWNER_WXID = (import.meta.env.VITE_OWNER_WXID ?? '').trim()
const OWNER_NAME = (import.meta.env.VITE_OWNER_NAME ?? '').trim()
// isOwn(m)：OWNER_WXID 命中 m.sender，或 OWNER_NAME 命中 m.sender_name
```

把真实值写在**项目根 `.env.local`**（被 `*.local` gitignore，不入仓）：`VITE_OWNER_WXID=...`、`VITE_OWNER_NAME=...`。仓库内 `.env.example` 给出空模板。数据管线脚本同理用 `process.env.WECHAT_STORE` / `process.env.QQ_NUMBER` 覆盖个人路径/号码。详见 [`11_conventions.md`](11_conventions.md) §5 与 [`../../AGENTS.md`](../../AGENTS.md) §2。

## 8. 验收
- 总结/文件/知识等板块左中右**各自独立滚动**，左栏不再被整页带走。
- 媒体板块走**服务端缩略图 + 真·视口虚拟化**：网格只请求 `…/thumb?w=360`（非原图）、视频用 poster 不用 `<video>`、任意滚动深度 live 卡片恒为几十（`node work/check-media.mjs` 头检：mounted≈30、`<video>`=0、滚动后窗口回收）。
- 左导航为**两组**（成果含媒体 / 配置含 AI）；聊天右栏有「AI 解析」。
- `npm run build` 通过、无控制台错误（`node work/check-ui.mjs` 头检）。
- 仓库内**不含**真实 wxid / QQ 号 / 个人绝对路径（`git grep` 自查）。
