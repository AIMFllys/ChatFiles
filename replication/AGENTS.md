# AGENTS.md — 午夜书斋 / ChatFiles 项目宪法

> 本文件是「项目宪法」：任何 AI 编程助手（Claude Code / Codex / 其他）在复刻或扩展本项目时，**每一步都必须遵守**这里的原则。它优先于风格偏好，仅次于人类的显式指令。把它放在项目根目录，编程 agent 会自动读取。
>
> 本仓库交付的是「复刻文档包」：把一台电脑里**机主本人**的微信（+ QQ）聊天与文件，解密 → 解析 → AI 提炼，做成一个本地可浏览的「第二大脑」网站（端口 3456）。除机主自己的私有聊天/媒体内容外，**其余功能可凭本文档包一模一样复刻**。

---

## 1. 使命与最终形态

做一个**纯本地**的 React + TypeScript 网站（Express 服务，端口 **3456**），左侧两组导航：

- **成果组**：概览 · 聊天 · 文件 · 洞察 · 学业 · 媒体
- **配置组**：总结 · 线索 · 聊天整理 · 数据库 · 候选 · 知识 · **AI**

实测规模（范例值）：980 会话 · 738,511 消息 · 18,068 联系人 · 5,907 归档文件(33.7GB) · 2,338 洞察 · 464 会话总结 · 13 主题富文本板。审美方向：**午夜书斋 / Midnight Study**（温暖深色编辑风，金/玉/锈点缀）。

> 详细规格见 [`docs/spec/`](docs/spec/00_overview.md)；一键提示词见 [`docs/PROMPT.md`](docs/PROMPT.md)；手动步骤见 [`docs/RUNBOOK.md`](docs/RUNBOOK.md)；用到的能力见 [`docs/SKILLS.md`](docs/SKILLS.md)。

---

## 2. 安全红线（不可逾越 · 必须一字不差地遵守）

1. **绝不删除、移动、改写任何原始聊天记录或文件。** 全程只对**副本**操作：解密只读原始库、把明文写到 `work/decrypted/`；归档只**复制**到 `archive/`，原文件原封不动。
2. **只解密机主本人、机主拥有的本地数据。** 属于"对自己设备上自己数据的本地备份/归档"。不得用于他人数据、未授权设备或任何监控/窃取用途。
3. **不上传。** 所有处理都在本地完成；不要把数据库、密钥或聊天内容传到任何外部服务。
4. **不运行来路不明的二进制。** 工具链（Go / mingw / 自写 crackv4）均从官方渠道下载、本地编译、源码可审计。
5. **边界要诚实。** 能解的解；解不了的（如 QQ 正文）如实记录为边界，**不要伪造、不要绕过安全限制**。QQ 正文的一次自动化解密尝试曾被使用政策拦截——记录之，不重试绕过。
6. **AI 密钥永不写盘。** AI 助手的 API Key 只存在浏览器 `localStorage`，请求经本机代理一次性透传上游，服务端**不落盘、不记录**。
7. **隐私不进仓库。** `.gitignore` 必须排除 `data/`、`archive/`、`work/`、`imports/`、`*.db`、`*.exe` 等一切含个人内容的产物；仓库只突出**代码框架 + replication 文档**。

---

## 3. 工作流：PADC

每个阶段按 **P → A → D → C** 推进，**完成一个阶段就 commit 一次**：

| 步 | 含义 | 要求 |
|---|---|---|
| **P**lan | 规划 | 先勘探现状、列任务（TaskCreate），明确这一阶段的产出与验收。 |
| **A**nalyze | 分析 | 读真实代码/数据再动手；遇到不清楚的，自己分析后选最佳方案，必要时用 `AskUserQuestion` 在"该用户拍板"的岔路征询。 |
| **D**evelop | 实现 | 按规范写代码/文档；确定性的活（解密/解析/归档）自己写脚本，大规模提炼用 `ultracode` 多 agent 扇出。 |
| **C**ommit | 提交 | 自检（build 通过 + 端到端核验 + 无控制台错误）后 commit；提交信息说明做了什么。隐私产物不得入仓。 |

---

## 4. 架构宪法（强制）

| 规则 | 说明 |
|------|------|
| **单文件 ≤ 300 行** | 任何 `.ts/.tsx/.css` 超过 ~300 行必须按职责拆分（自动生成/vendor 除外）。 |
| **一文件一职责** | 一个组件 / 一个路由模块 / 一个工具集 / 一个类型域 / 一个样式模块。 |
| **服务端薄入口** | `server/index.ts` 只挂载路由 + 静态服务；每个 API 领域一个 `server/routes/*.ts`。 |
| **前端分层** | `boards/`(页面级) · `components/`(可复用) · `hooks/`(逻辑) · `utils/`(纯函数) · `types/`(领域类型) · `styles/`(按板块拆，`@import` 聚合)。 |
| **设计令牌集中** | 全局令牌与字体放 `src/index.css`（可直接用本包的 [`global.css`](global.css)）；不要散落硬编码颜色。 |
| **不堆砌冗余** | 重复逻辑提取到 `utils/` 或 `hooks/`；删旧代码而非注释掉。 |
| **命名** | 组件 PascalCase 文件；工具/hooks camelCase；类型文件 camelCase。 |

> 本轮新增的懒加载（`hooks/useVisibleCount.ts`、`hooks/useInView.ts`）、AI 助手（`boards/AISettings.tsx`、`components/ai/AIChatDock.tsx`、`utils/aiConfig.ts`、`server/routes/ai.ts`）都遵守以上规范，可作范例。

---

## 5. 必用的 skills / 能力

- **frontend-design**（用户硬要求"审美必须结合 skills"）：做前端**必须**先用它承诺一个自洽审美方向再写代码。
- **ultracode → Workflow 多 agent 编排**：大规模提炼/综述靠它扇出（见 [`docs/spec/06_insights.md`](docs/spec/06_insights.md) 的陷阱）。
- **AskUserQuestion**：在"解密方式""前端改造范围"这类决策门征询，而非自作主张。
- **Agent 子代理 / Explore**：把大而独立的活外包、保护主上下文。
- **TaskCreate/TaskUpdate** 跟踪多阶段进度；**Memory** 记非显然的项目知识。

详见 [`docs/SKILLS.md`](docs/SKILLS.md)（含对 `agent-onboarding` 的诚实勘误）。

---

## 6. 构建与运行契约

- `npm run build` = `tsc -b && vite build`，必须 exit 0。
- `npm start` = `tsx server/index.ts`，打印 `ChatFiles running at http://127.0.0.1:3456`。
- 核验：`/api/overview`、`/api/insights` 返回真实数字；`/`（200）；五+板块可点检；`POST /api/ai/chat` 缺字段返回 400、带配置转发上游。
- 前端改完跑 `npm run build`；服务端 `/api/wechat/*` 与 `/api/insights` 实时读盘，提炼/修复后无需重启。

---

## 7. 复刻者须知

本项目是**通用模板**：文档里用机主（"羽升"，华科基医强基 2501）的真实数字作为**范例与默认值**，所有机器/账号相关值用 `{{占位符}}` 标出，替换为自己的即可。除你自己的聊天/媒体内容外，全部功能都能凭本包复刻。两条路径：**A. 一键喂给 AI**（[`docs/PROMPT.md`](docs/PROMPT.md)）/ **B. 工程师手动**（[`docs/RUNBOOK.md`](docs/RUNBOOK.md)）。
