# 11 · 工程约定（编码规范 · 文档规范 · 流程）

> 复刻出"同款工程质量"靠的不只是功能，还有这些约定。本篇是所有其他规格的底座。最高准则见 [`../../AGENTS.md`](../../AGENTS.md)。

## 1. 编码规范（强制）

| 约定 | 细则 |
|------|------|
| **单文件 ≤ 300 行** | `.ts/.tsx/.css` 超过即按职责拆分；自动生成 / vendor 例外。超 150 行的 React 组件应考虑提子组件。 |
| **一文件一职责** | 一个组件 / 一个路由模块 / 一个工具集 / 一个类型域 / 一个样式模块。 |
| **目录分层** | 前端 `boards/`(页面) · `components/`(可复用) · `hooks/`(逻辑) · `utils/`(纯函数) · `types/`(类型) · `styles/`(样式)；服务端 `routes/`(按 API 域) · `utils/`(共享)；管线 `scripts/`（复杂脚本可拆子目录如 `scripts/summary/`）。 |
| **命名** | 组件 PascalCase 文件名；hooks `useXxx` camelCase；工具/类型 camelCase。 |
| **样式** | 全局令牌集中在 `src/index.css`（用 [`../../global.css`](../../global.css)）；板块样式拆 `styles/*`，经 `App.css` 的 `@import` 聚合；不散落硬编码色值，一律用 CSS 变量。 |
| **类型** | 领域类型放 `src/types/`（files/chat/insights），`index.ts` 做 barrel；`src/types.ts` 兼容旧导入路径。 |
| **不堆砌冗余** | 重复逻辑提到 `utils/`/`hooks/`（如 `fmtDate` 提到 `format.ts` 复用）；删旧代码而非注释保留。 |
| **错误处理** | 网络/解析失败要有回退（空状态默认值在 `utils/constants.ts`）；AI 流式要可中止（`AbortController`）。 |

## 2. 技术选型与版本

| 层 | 选型 |
|---|---|
| 前端 | React 19 + TypeScript + Vite 8 |
| 服务端 | Express 5；`express.json({limit:'24mb'})`（AI 注入上下文较大） |
| 数据库 | `node:sqlite`（`DatabaseSync`，只读打开，免原生依赖） |
| 压缩 | Node 24 内置 `zlib.zstdDecompressSync`；Python 3.14 内置 `compression.zstd` |
| 渲染 | react-markdown + remark-gfm + rehype-highlight、docx-preview、jszip、read-excel-file、lucide-react |
| 运行脚本 | `tsx`；E2E 头检 `playwright` |

## 3. 文档规范（spec-driven development）

本复刻包遵循 SDD 约定：

- **`AGENTS.md` = 项目宪法**：编程 agent 自动读取，约束每一步。
- **多文件 `spec/`**：按关注点切分（架构/数据源/解密/解析/归档/提炼/API/前端/AI/边界/约定），每篇**自包含**、可单独读，用相对链接交叉引用；规格"足够聚焦以便整篇始终可被 agent/人持有"。
- **占位符**：机器/账号相关值一律 `{{占位符}}`（`{{项目目录}} {{微信数据根}} {{wxid}} {{QQ号}} {{一级分类}} {{学业站点}}`），本项目实测值作范例/默认。
- **RFC 2119 关键词**：必须/MUST、应/SHOULD、可/MAY，表达约束强度。
- **活文档**：随实现/决策更新（本轮即把 AI 助手、懒加载、独立滚动、导航重组并入规格）。

## 4. 流程：PADC + 按阶段 commit

- **P**lan → **A**nalyze → **D**evelop → **C**ommit；**每完成一个阶段就 commit**，提交信息说明做了什么。
- 不清楚处自己分析后选最佳方案；"该用户拍板"的岔路用 `AskUserQuestion`。
- 自检后才提交：`npm run build` 通过 + 端到端核验 + 无控制台错误。

## 5. 隐私与仓库（强制）

- `.gitignore` **必须**排除一切个人内容产物：`data/ archive/ work/ imports/`、`*.db *.db-shm *.db-wal`、`*.exe`、`*.zip`、构建产物 `dist/ node_modules/`、`.claude/`。
- 仓库**只突出**代码框架 + `replication/` 文档；任何聊天/文件/密钥/解密产物**不得入仓**。
- 提交前自查：`git diff --cached --name-only` 不得含 `data/|work/|archive/|.db|.exe`。

> 详见 [`10_data-products-and-boundaries.md`](10_data-products-and-boundaries.md) 的产物清单与 [`../RUNBOOK.md`](../RUNBOOK.md) 的提交前核验。
