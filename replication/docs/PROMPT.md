# PROMPT · 复刻提示词（喂给 AI 一键复刻）

把下面的 **Mega-Prompt** 复制出来、替换 `{{占位符}}`，在 **Claude Code**（或 Codex / Cursor）里粘贴发送即可。开头的 `ultracode` 是触发词——它让 AI 启用多 agent Workflow 编排（大规模并行提炼/综述靠它）。

> 前提：① 微信（QQ）**正在运行且已登录**（内存取密钥的硬前提）；② 装好 Node 24+、Python 3.14、git，可联网（详见 [`RUNBOOK.md`](RUNBOOK.md) Phase 0）。
> 占位符速查：`{{项目目录}}`=网站根目录、`{{微信数据根}}`=微信存储根（默认 `C:\Users\<你>\xwechat_files`，**可能被迁到别处**）、`{{一级分类}}`=你的顶级文件夹、`{{身份}}`、`{{学业站点}}`=要接入的课程站点（没有就删那句）。

---

## A. 一键 Mega-Prompt（推荐）

```text
ultracode 我要复刻「午夜书斋 / ChatFiles」——一个纯本地的"第二大脑"网站，深度系统地把我自己微信（和 QQ）里的全部聊天记录与有价值文件解密、整理出来。项目目录在 "{{项目目录}}"。

【最重要 · 你必须先做这一步】
在动手之前，你 MUST 逐篇精读本项目的规范文档包，并严格遵照执行：
1. 先读 `replication/AGENTS.md`（项目宪法 — 安全红线、架构规范、工作流、必用 skills）
2. 再读 `replication/docs/SKILLS.md`（用到的能力 — ultracode/frontend-design/Workflow 编排/AskUserQuestion 等）
3. 然后逐篇读 `replication/docs/spec/` 下的全部规格文档（共 12 篇，从 00_overview 到 11_conventions），它们是你的 **唯一权威施工图纸**：
   - `00_overview.md` — 总览、板块定义、成功标准
   - `01_architecture.md` — 七层架构、完整文件树、≤300行规范
   - `02_data-sources.md` — 数据在哪、迁移陷阱、枚举方法
   - `03_decryption.md` — 解密方法（派生密钥内存扫描）
   - `04_parsing.md` — 解析进 wechat.db 三表
   - `05_archiving.md` — 归档文件（去重、分类、只复制）
   - `06_insights.md` — AI 提炼（多 agent 扇出）
   - `07_server-api.md` — 服务端 API
   - `08_frontend.md` — 前端设计系统与板块
   - `09_ai-assistant.md` — AI 助手接入
   - `10_data-products-and-boundaries.md` — 产出物与已知边界
   - `11_conventions.md` — 代码/命名/提交约定
4. 辅助文档：`replication/docs/RUNBOOK.md`（逐步手册）、`replication/docs/PROMPT.md`（本文件）

你在实现每一个环节时，MUST 回到对应的 spec 文档核对细节。不可凭记忆或猜测行事。

【目标】
用 React + TypeScript + Express 做一个端口 3456 的纯本地网站，实现 Spec 定义的全部 13 个板块：
- 成果组：概览 · 聊天 · 文件 · 洞察 · 学业 · 媒体
- 配置组：总结 · 线索 · 聊天整理 · 数据库 · 候选 · 知识 · AI

网站核心能力（详见各 spec 文档）：
1. 文件板块：把微信/QQ 有价值文件复制进项目并分类（一级分类如 {{一级分类：过去/创业/AI/树林/学业/专业/比赛 等}}）。同名取最大序号 + sha256 去重。VS Code 风格树浏览 + 全格式内部渲染。→ 见 `05_archiving.md`
2. 聊天板块：解密并解析全部微信聊天记录，按人物/群组浏览。→ 见 `03_decryption.md` + `04_parsing.md`
3. 洞察板块：多 agent 并行提炼有价值内容 + 按类综述成富文本总结板。→ 见 `06_insights.md`
4. AI 助手：配置接口/密钥（只存浏览器不落盘）+ 聊天右栏 AI 解析浮窗。→ 见 `09_ai-assistant.md`
5. 懒加载 + 独立滚动 + 导航分两组。→ 见 `08_frontend.md`

我的身份信息（替换 spec 中的 {{机主身份}}）：{{身份，如 XX大学 XX专业 XX级}}
学业站点（若有）：{{学业站点}}

【硬约束 · 全部来自 AGENTS.md §2 安全红线，一字不差遵守】
- 禁止删除/移动/改写任何原始聊天记录与文件；只读原始、只对副本解密、只复制归档。
- 只解密机主自己的本地数据。不上传。AI 密钥永不写盘。
- 审美设计 MUST 结合 frontend-design skill，锚定「午夜书斋」设计系统。
- 架构 MUST 遵守 AGENTS.md §4（单文件 ≤300 行、一文件一职责、设计令牌集中…）。
- 遵守 PADC 工作流（AGENTS.md §3），每完成一阶段 commit。
- 边界如实记录（QQ 正文未解密等），不绕过安全限制。

【执行方式】
请先深度勘探现状（数据在哪、能否解密），把关键发现告诉我，再开始建。遇到"解密方式"和"前端改造范围"用 AskUserQuestion 问我。大规模提炼用 ultracode 多 agent 扇出。全程严格参照 spec 文档执行。
```

> 这条提示词强制要求 AI **先精读全部规范文档再动手**，确保复刻严格遵照 Spec 的每一条规格。AI 收到后会先读文档、勘探数据、在两处征询你（见 C 节），再按 spec 逐层实现。

---

## B. 分阶段提示词（想分步把控时用）

逐条发送，每条等 AI 做完再发下一条。**每条开头都要求 AI 参照对应的 spec 文档**：

1. **读文档 + 勘探**：`先精读 replication/AGENTS.md 和 replication/docs/spec/ 下全部 12 篇规格文档，再按 spec/02_data-sources.md 的方法勘探我电脑上微信/QQ 聊天记录与文件的真实存储位置和可解密性。整理给我，先别动手。`
2. **解密**：`严格按 replication/docs/spec/03_decryption.md 的规格，搭建解密工具链并解密我的微信库（只对副本操作，绝不碰原始文件）。用"从运行进程内存恢复每个库的派生密钥 + 便宜校验"的版本无关方法。解密后用 Python 验证能读到真实中文消息。`
3. **解析**：`严格按 replication/docs/spec/04_parsing.md 规格，把解密库解析成明文 SQLite(conversations/messages/contacts 三表)，正文 zstd 解压、发送人用 name2id 还原、按类型映射。统计会话/消息数给我。`
4. **归档**：`严格按 replication/docs/spec/05_archiving.md 规格，把有价值文件复制进项目并按 {{一级分类}} 归类，同名取最大序号 + sha256 去重，跳过加密 .dat 与缓存噪声。原文件不动。`
5. **提炼**：`ultracode 严格按 replication/docs/spec/06_insights.md 规格和 replication/docs/SKILLS.md 的 Workflow 编排方法，对每个有实质内容的会话用多 agent 并行提炼有长期价值的要点，写成结构化 JSON；再按类综述成富文本总结板。`
6. **前端**：`严格按 replication/docs/spec/08_frontend.md 的设计系统和 replication/AGENTS.md §4 架构宪法，用 frontend-design skill 做深色编辑风站点，端口 3456，导航分成果/配置两组；多格式预览引擎；海量列表懒加载、三栏独立滚动。build 通过并端到端核验。`
7. **AI 助手**：`严格按 replication/docs/spec/09_ai-assistant.md 规格，新增 AI 板块（配置 URL/Key/模型/阈值，密钥仅存浏览器、经本机代理透传不落盘）；聊天右栏加「AI 解析」悬浮窗，注入该会话全文、阈值 1 万–80 万 token、超阈值报错。`

---

## C. 两个决策点（AI 会用 AskUserQuestion 问你）

| 决策 | 选项 | 本项目的选择 / 建议 |
|---|---|---|
| **解密方式** | 自写可审计脚本 / 成熟开源工具 / 两者结合 | 本项目"先试成熟工具"，但新版微信 4.1.9.x 上现成工具失效、相关仓库被下架，最终落到**自写的版本无关派生密钥扫描**（见 [`spec/03_decryption.md`](spec/03_decryption.md)）。建议答"两者结合：先试成熟工具，失效就自写"。 |
| **前端改造范围** | 重做前端 + 全部新板块 / 在现有界面扩展 / 整站重写 | 本项目选**重做前端 + 全部新板块**（保留可用服务端与预览引擎）。推荐同款。 |

---

## D. 跑哪个模型 / 大概多少额度

| 方式 | 说明 | 量级 |
|---|---|---|
| **Claude Code · Opus 4.8 XHigh（推荐）** | 质量最高、最稳；直接 `/goal` + 上面的 Mega-Prompt。 | 约 $200 量级 |
| **Codex** | 先新建项目再 `/goal` 发提示词。 | 约 10 小时 ≈ ChatGPT Pro 3×5h 额度 |

> 这套提示词的"魔力"不在文字本身，而在 AI 收到后动用的 **skills 与多 agent 编排**——务必读 [`SKILLS.md`](SKILLS.md)。
