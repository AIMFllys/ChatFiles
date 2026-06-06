# 午夜书斋 / ChatFiles

把一台电脑里**你自己**的微信（+ QQ）聊天记录与文件，解密、解析、AI 提炼，做成一个本地可浏览的「第二大脑」网站。

> 纯本地运行，不上传任何数据。本仓库是**代码空壳**——不含任何聊天记录、媒体、洞察；你 clone 下来后，让 AI 用**你自己**的数据把它灌满。

---

## 三条路径，按你的处境选

```
你手上是什么？                              用哪套文档
────────────────────────────────────────────────────────────
已 clone 本仓库，想用自己的数据点亮它   →  docs/本地部署教程/      ← 多数人走这条
空目录，想让 AI 从零把代码也造出来      →  replication/
已经部署好了，想补新消息/新账号         →  docs/ChatFiles本地更新/
```

### 🚀 路径一：clone 本仓库，灌入你自己的数据（推荐）

代码现成，你只需让 AI 在本机找到你的数据、解密、灌进来、跑起来。

```bash
git clone https://github.com/AIMFllys/ChatFiles.git
cd ChatFiles
npm install
```

然后打开 [`docs/本地部署教程/`](docs/本地部署教程/)，把里面的 [`PROMPT.md`](docs/本地部署教程/PROMPT.md) 复制给 AI（Claude Code 里 `/goal ` 粘贴）——它会**自主搜索你电脑里的微信 / QQ 数据**，一步步解密、解析、归档、提炼，最后 `npm start` 点亮 `http://127.0.0.1:3456`。整套是带验收断言的 Spec 文档：

| 文档 | 内容 |
|---|---|
| [`本地部署教程/README.md`](docs/本地部署教程/README.md) | 流程总览 + 安全红线 |
| [`00_总览.md`](docs/本地部署教程/00_总览.md) → [`05_验收清单.md`](docs/本地部署教程/05_验收清单.md) | 环境 → 定位数据 → 解密解析归档 → 提炼启动 → 验收 |
| [`PROMPT.md`](docs/本地部署教程/PROMPT.md) | 可直接喂给 AI 的一键部署咒语 |

> 配置自己的身份（昵称 / 学校 / 课程站点等）只写进 **gitignored 的 `.env.local`**（模板见 [`.env.example`](.env.example)），绝不进仓库。

### 🧱 路径二：从零复刻整套项目

想让 AI 连代码一起重建（在一个空目录里），用仓库根的 [`replication/`](replication/)：

| 文档 | 内容 |
|---|---|
| [`AGENTS.md`](replication/AGENTS.md) | 项目宪法 — 安全红线、架构规范、工作流 |
| [`docs/spec/`](replication/docs/spec/)（12 篇） | **完整技术规格**（从数据源到前端，唯一权威施工图纸） |
| [`docs/PROMPT.md`](replication/docs/PROMPT.md) | 从零复刻的一键咒语 |
| [`docs/RUNBOOK.md`](replication/docs/RUNBOOK.md) | 逐步操作手册 |
| [`docs/SKILLS.md`](replication/docs/SKILLS.md) | 用到的 skills 与方法论 |

### 🔁 路径三：增量更新已部署的项目

已经装好数据，想把**最新消息**和**之前没解密的账号**补进来，且**不重复分析**旧会话：用 [`docs/ChatFiles本地更新/`](docs/ChatFiles本地更新/)。它靠"高水位线"做增量去重——新会话全量提炼、长大的会话只读新尾巴并追加合并、没变的会话一个 agent 都不跑。入口同样是其中的 [`PROMPT.md`](docs/ChatFiles本地更新/PROMPT.md)。

---

## 功能概览

| 板块 | 功能 |
|------|------|
| **概览** | 总量仪表盘（会话/消息/联系人/文件/洞察） |
| **聊天** | 全部微信会话按人/群浏览，真实气泡 UI |
| **文件** | VS Code 风格文件树 + 多格式内部渲染 |
| **洞察** | AI 提炼要点 + 主题富文本总结 |
| **媒体** | 服务端缩略图 + 视口虚拟化的媒体网格 |
| **学业 / 知识 / AI…** | 身份框定的学业线索、知识整理、可自带模型的 AI 解析 |

## 技术栈

- React 19 + TypeScript + Vite 8
- Express 5 + `node:sqlite`
- Node 24（内置 zstd）+ ffmpeg（缩略图 / 语音转码）
- 午夜书斋设计系统（深色编辑风）

## 直接启动（数据已就位时）

```bash
npm install
npm run build
npm start        # → http://127.0.0.1:3456
```

> 空壳直接启动只有空板块；先按**路径一**用你自己的数据灌满再启动。

---

## 架构约束

- **单文件不超过 300 行**：按职责拆分
- **只读原始数据**：绝不删除/移动/改写任何原始聊天记录
- **纯本地**：不上传任何数据到外部服务

## 隐私红线

- 个人数据目录 `data/`、`archive/`、`work/`、`imports/` 始终被 [`.gitignore`](.gitignore) 排除，**永不进仓库**。
- 个人身份（wxid / QQ号 / 昵称 / 学校 / 课程站点）只写在 gitignored 的 `.env.local`，代码里通过 `VITE_OWNER_*` / `OWNER_IDENTITY` / `COURSE_URL` 等环境变量注入（见 [`.env.example`](.env.example)）。
- 开源 / 分享前请跑一遍 [`docs/本地部署教程/05_验收清单.md`](docs/本地部署教程/05_验收清单.md) 的"隐私自检"。

## 许可

仅供个人学习与数据归档使用。
