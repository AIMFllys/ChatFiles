# 午夜书斋 / ChatFiles

把一台电脑里**你自己**的微信（+ QQ）聊天记录与文件，解密、解析、AI 提炼，做成一个本地可浏览的「第二大脑」网站。

> 纯本地运行，不上传任何数据。本仓库是**代码空壳**——不含任何聊天记录、媒体、洞察；你 clone 下来后，让 AI 用**你自己**的数据把它灌满。

---

## 先读现行架构

现行架构、字段映射、数据关系、能力矩阵与激活流程的唯一 prose 权威是 [`replication/docs/spec/01_architecture.md`](replication/docs/spec/01_architecture.md)。代码中的 Zod/SQL 是其可执行实现；冲突时必须停止并修正。

## 三类资料，按用途选择

```
你手上是什么？                              用哪套文档
────────────────────────────────────────────────────────────
检查或开发现有代码                       →  先读 canonical architecture
理解早期本地部署踩坑                     →  docs/本地部署教程/（历史）
理解早期增量更新思路                     →  docs/ChatFiles本地更新/（历史）
```

### 🚀 路径一：clone 本仓库，灌入你自己的数据（推荐）

代码现成，你只需让 AI 在本机找到你的数据、解密、灌进来、跑起来。

```bash
git clone https://github.com/AIMFllys/ChatFiles.git
cd ChatFiles
npm install
```

先运行 `npm run data:doctor` 判断活动 catalog 状态。`docs/本地部署教程/` 是历史材料，不得直接执行其中的旧布局命令；legacy 数据必须按 canonical 文档显式迁移并准确提供 account root。

| 文档 | 内容 |
|---|---|
| [`本地部署教程/README.md`](docs/本地部署教程/README.md) | 流程总览 + 安全红线 |
| [`00_总览.md`](docs/本地部署教程/00_总览.md) → [`05_验收清单.md`](docs/本地部署教程/05_验收清单.md) | 环境 → 定位数据 → 解密解析归档 → 提炼启动 → 验收 |
| [`PROMPT.md`](docs/本地部署教程/PROMPT.md) | 可直接喂给 AI 的一键部署咒语 |

> 配置自己的身份（昵称 / 学校 / 课程站点等）只写进 **gitignored 的 `.env.local`**（模板见 [`.env.example`](.env.example)），绝不进仓库。

### 🧱 当前复刻规范

实现或审查项目时使用仓库根的 [`replication/`](replication/)：

| 文档 | 内容 |
|---|---|
| [`AGENTS.md`](replication/AGENTS.md) | 项目宪法 — 安全红线、架构规范、工作流 |
| [`01_architecture.md`](replication/docs/spec/01_architecture.md) | **唯一 prose 权威**：架构、数据关系、能力与发布 |
| [`docs/spec/`](replication/docs/spec/) | 其余文件均为补充背景，不得覆盖 01 |
| [`docs/PROMPT.md`](replication/docs/PROMPT.md) | 从零复刻的一键咒语 |
| [`docs/RUNBOOK.md`](replication/docs/RUNBOOK.md) | 逐步操作手册 |
| [`docs/SKILLS.md`](replication/docs/SKILLS.md) | 用到的 skills 与方法论 |

### 🔁 路径三：增量更新已部署的项目

[`docs/ChatFiles本地更新/`](docs/ChatFiles本地更新/) 保留早期经验，但不是现行执行入口。当前增量顺序是 source inventory → canonical candidate → assets/library/insights → seal catalog → 审计后显式激活；消息高水位使用 `canonical_seq`。

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
