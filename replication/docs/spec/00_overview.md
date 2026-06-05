# 00 · 总览（Overview）

> 本文是复刻规格文档包的第一篇，回答"这是什么、给谁用、为什么这样、做到什么程度算成功"。
> 后续篇章承接本文的术语与目标，逐层展开实现：
> [01_architecture.md](01_architecture.md)（系统架构）、
> [02_data-sources.md](02_data-sources.md)（数据源定位）、
> [03_decryption.md](03_decryption.md)（解密）、
> [04_parsing.md](04_parsing.md)（解析）、
> [05_archiving.md](05_archiving.md)（归档）、
> [06_insights.md](06_insights.md)（提炼）、
> [07_server-api.md](07_server-api.md)（服务端）、
> [08_frontend.md](08_frontend.md)（前端）、
> [09_ai-assistant.md](09_ai-assistant.md)（AI 助手）、
> [10_data-products-and-boundaries.md](10_data-products-and-boundaries.md)（数据产物与边界）、
> [11_conventions.md](11_conventions.md)（约定）。
> 操作类文档见 [../PROMPT.md](../PROMPT.md)、[../RUNBOOK.md](../RUNBOOK.md)、[../SKILLS.md](../SKILLS.md)、[../../AGENTS.md](../../AGENTS.md)。
>
> 关键词遵循 RFC-2119：**必须 (MUST)**、**应 (SHOULD)**、**可 (MAY)**。
> 所有机器/账号相关的具体值一律用 `{{占位符}}` 表示；本文中给出的规模数字均为**本项目实测值**，复刻方的数据会不同。

---

## 0. 一句话定位

**午夜书斋 / ChatFiles** 是一个**纯本地**（pure-local）运行的 React + TypeScript 网站（Express 服务端，端口 **3456**），它把**机主本人**的微信 / QQ 聊天记录与聊天附件，经过**解密 → 解析 → 归档 → AI 提炼**四步，沉淀成一座可浏览、可检索、可被 AI 二次理解的"**第二大脑**"（second brain）。

- 站点**必须**完全在机主自己的机器上运行，数据**不上传**、不出网（唯一例外是用户**显式配置**的 AI 接入，见 [09_ai-assistant.md](09_ai-assistant.md)）。
- 站点**只读**机主自己的原始数据，只对**副本**解密、只**复制**归档文件；任何原始聊天库与原始文件**必须**保持原封不动。
- 本项目的机主示例（仅作语气/口吻/分类基准，复刻方**必须**替换为 `{{机主身份}}`）：**华中科技大学 基础医学强基 2501「羽升」**。

> 名字「午夜书斋 / Midnight Study」既是产品名也是设计系统代号——一座深夜灯下、暖金色、衬线标题的私人书斋；审美方向是规格的一部分（见 [08_frontend.md](08_frontend.md)）。

---

## 1. 产品愿景与背景

### 1.1 要解决的问题

社交软件（微信、QQ）是当代个人最大的**非结构化记忆载体**：多年的对话里埋着技术经验、人脉关系、人生决策、灵感碎片、项目线索；收到的文件里散落着课件、合同、简历、设计稿、源码。但这些数据：

1. **被加密锁死**——微信 4.0 的聊天库是 SQLCipher 加密，QQ NT 是自定义加密格式，普通人无法打开。
2. **被切碎散落**——一条信息分布在上千张"每会话一表"的数据库表里，文件散落在几万个哈希命名的目录中。
3. **无法被检索、无法被 AI 理解**——没有统一索引，更没有把"我和某人三年的对话"喂给大模型的能力。
4. **随时可能丢失**——换机、清理、账号风控都可能让多年记忆一夜蒸发。

### 1.2 产品主张

ChatFiles 主张：**机主对自己产生的数据拥有完全的、可被工具化的所有权**。它把"散落、加密、不可读"的个人聊天数据，转化为"集中、明文、可浏览、可被 AI 提炼"的私人知识库，且全程在本地、零上传、原始数据零破坏。

它**不是**：

- **不是**通用的"破解微信"工具——它只解密**机主自己本机、已登录账号**的数据，密钥来自机主自己进程的内存。
- **不是**云笔记 / SaaS——没有服务器、没有账号体系、没有任何数据外发。
- **不是**实时聊天客户端——它是对**历史**数据的归档、阅读与提炼工具。

### 1.3 复刻方的产出形态

复刻方按本文档包重建后，**应**得到一个**结构与功能完全一致**的站点（设计系统、板块、API、管线脚本逐一对应），**唯一不同**是其中填充的是复刻方**自己的**聊天与文件内容——本文档包刻意**不**包含、也**不应**要求包含机主的任何私密对话 / 媒体正文。

---

## 2. 板块（Boards）

站点左侧导航分为**两组**，共 **13 个板块（Tab）**。分组语义来自 `src/boards/navConfig.tsx`：上组是**已成型的结果**（成果组），下组是**配置与证据/工作台**（配置组）。复刻时**必须**保持这一分组与顺序。

> 板块的 `Tab` 联合类型、`PRIMARY_NAV` / `CONFIG_NAV` 数组、`TAB_TITLES` 标题映射，**必须**集中定义在 `src/boards/navConfig.tsx`（详见 [08_frontend.md](08_frontend.md) 与 [01_architecture.md](01_architecture.md)）。

### 2.1 成果组（PRIMARY_NAV，上组）

呈现可直接消费的最终结果：

| Tab id | 名称 | 图标 | 职责（一句话） |
|--------|------|------|----------------|
| `overview` | **概览** | `Home` | 总量仪表盘：会话 / 消息 / 文本 / 联系人 / 归档文件 / 洞察数，大号衬线统计 + 各板块入口卡。 |
| `chat` | **聊天** | `MessagesSquare` | 解密后的全部会话逐条重读：三栏（会话列表 / 消息气泡流 / 右侧上下文面板），支持搜索、自动分页、「AI 解析」浮窗。 |
| `files` | **文件** | `Archive` | 归档 / 源文件双模式 + VS Code 式文件树（TreeView）+ 右侧全格式预览引擎。 |
| `insights` | **洞察** | `Lightbulb` | 按 13 类分组的提炼要点（nugget）卡片墙 + 顶部渲染该类的主题富文本总结板（Markdown）。 |
| `academics` | **学业** | `GraduationCap` | 机主身份框定（基医强基 2501）+ 课程站点入口 + 学业 / 专业类 nugget。 |
| `media` | **媒体** | `LayoutGrid` | 归档媒体（图片 / 视频 / 音频）的网格复核视图，增量挂载避免一次加载上千资源。 |

### 2.2 配置组（CONFIG_NAV，下组）

呈现配置项、证据复核与中间工作台（非最终成果）：

| Tab id | 名称 | 图标 | 职责（一句话） |
|--------|------|------|----------------|
| `summary` | **总结** | `Brain` | 全局总结阅读器：按证据分层呈现 `buildSummary` 产出的总览文本。 |
| `clues` | **线索** | `MessageSquareText` | 聊天线索档案（ChatClueDossier）：从聊天中抽出的待办 / 承诺 / 事实，关联到归档文件可点开。 |
| `synthesis` | **聊天整理** | `FileText` | 聊天综合整理（ChatSynthesis）阅读器：按主题把会话证据分层重组。 |
| `databases` | **数据库** | `DatabaseZap` | 只读数据库探测工作台：列出已发现的 `.db` 文件与可读边界（含 QQ 未解密边界）。 |
| `candidates` | **候选** | `Layers3` | 价值候选工作台：扫描出但**尚未**归档、可能有价值的源文件清单，可一键打开预览。 |
| `knowledge` | **知识** | `BookOpenText` | 课程与笔记知识整理：源状态卡片 + 结构化知识小节。 |
| `ai` | **AI** | `Sparkles` | AI 接入配置板：填写 baseURL / apiKey / model / 上下文阈值 / 温度（密钥只存浏览器 localStorage，永不写盘）。 |

### 2.3 板块标题（eyebrow + title）

每个板块顶栏的小标（eyebrow）与主标（title）由 `TAB_TITLES` 集中定义。复刻**应**沿用其语气，例如：`chat` → eyebrow「解密微信 · 逐条重读」/ title「聊天」；`insights` → eyebrow「AI 札记 · 碎金合集」；`databases` → eyebrow「只读探测 · 数据库边界」。完整映射见 `src/boards/navConfig.tsx`。

> 注：`overview` 与 `academics` 为**全幅（full-bleed）**板块，**不**渲染顶栏，由 `App.tsx` 的 `fullBleed` 判定。

---

## 3. 目标用户

| 用户类型 | 描述 | 对本产品的诉求 |
|----------|------|----------------|
| **机主本人**（主用户） | 拥有多年微信 / QQ 数据、希望沉淀个人记忆与知识的技术型个人（本项目示例为在校强基生「羽升」）。 | 把自己的对话与文件变成可检索、可被 AI 提炼的第二大脑；强调隐私与原始数据安全。 |
| **复刻者 / 开发者** | 拿到本文档包、想为自己重建同款站点的人或 AI agent。 | 需要足够详尽、可逐步执行的规格，能在不接触机主私密内容的前提下重建结构与功能一致的站点。 |
| **被授权的同类用户** | 任何愿意在**自己的**机器上、对**自己的**数据运行此工具的人。 | 与机主诉求一致；**必须**自行登录自己的账号取自己的密钥。 |

**非目标用户**：想读取**他人**数据、想在云端运行、想绕过软件厂商安全策略的人——这些用法被安全红线明确禁止（见 §5）。

---

## 4. 实测规模（Measured Scale）

下列数字是**本项目机主账号**的实测产物，用于校准复刻方对系统量级与产物形态的预期。复刻方**必须**预期自己的数字不同，但管线**应**产出同形态的产物。

| 维度 | 实测值 | 说明 |
|------|--------|------|
| 会话数 | **980 会话** | 解析后进入 `data/wechat.db` 的会话总数 |
| 消息总数 | **738,511 消息** | 全部类型消息 |
| 文本消息 | **427,803 文本消息** | `local_type=1` 的纯文本消息 |
| 联系人 | **18,068 联系人** | 含个人与群 |
| 归档文件 | **5,907 归档文件（33.7GB）** | 复制到 `archive/` 的去重文件 |
| 扫描规模 | **扫 87,052 · 去重跳 81,145** | 源端扫描总数与去重跳过数 |
| 洞察要点 | **2,338 洞察 nugget** | AI 提炼出的有长期价值要点 |
| 会话总结 | **464 会话总结** | 含 summary / topics / keyPeople 的会话级总结 |
| 主题富文本板 | **13 主题富文本板** | 按类聚合的 Opus 级富文本总结板 |

软件版本基准（数据源格式与解密强相关，见 [02_data-sources.md](02_data-sources.md) / [03_decryption.md](03_decryption.md)）：

- 微信：**WeChat 4.1.9.35**（`Weixin.exe` 4.x，SQLCipher v4 加密）。
- QQ：**QQ NT 9.9.20-36330**（`QQ.exe` QQNT，`nt_msg.db` 自定义 `QQ_NT DB` 格式）。

---

## 5. 安全红线（Safety Red Lines）

这些是**不可逾越**的约束，贯穿全部文档与全部实现。复刻方与任何 AI agent **必须**逐条遵守。

1. **原始数据只读、不破坏**：**禁止**删除、移动、改写、覆盖任何原始聊天库与原始文件。所有解密 / 解析 / 归档**必须**对**副本**进行。
2. **只读原始、只对副本解密、只复制归档**：从源目录读取**必须**以只读方式；解密产物写入 `work/decrypted/`；归档**只复制**到 `archive/`，绝不"剪切"。
3. **只解密机主自己的本地数据**：密钥**必须**取自机主自己机器上、自己已登录的进程内存；**禁止**针对他人数据或非本机数据解密。
4. **不上传 / 不出网**：站点与管线**默认**完全离线。数据**不上传**到任何远端。
5. **AI 密钥永不写盘**：用户配置的 AI baseURL / apiKey **只**存浏览器 `localStorage`，经本地代理转发上游时**只**透传、**不**落盘、**不**记日志（见 `server/routes/ai.ts` 与 [09_ai-assistant.md](09_ai-assistant.md)）。
6. **QQ 正文解密作为已知边界，不绕过**：QQ `nt_msg.db` 正文的一次自动化解密尝试曾被 Anthropic 使用政策（网络安全内容）**拦截**。本项目**如实记录为边界、不绕过**；QQ 明文附件（`nt_data`）已正常归档。详见 [10_data-products-and-boundaries.md](10_data-products-and-boundaries.md)。

> 上述红线的细化与具体落点（哪个脚本、哪个目录、哪条 API）在各专题文档中重复声明；任何与红线冲突的"增强"都**必须**被否决。

---

## 6. 成功标准（Success Criteria）

复刻**必须**满足下列**全部**功能性与非功能性标准，方可视为"复刻成功"。

### 6.1 功能性标准（MUST）

1. **可定位**：能在本机定位到机主自己的微信 `xwechat_files`（含可能被迁移到非 C 盘的情况）与 QQ `Tencent Files` 数据根（[02_data-sources.md](02_data-sources.md)）。
2. **可解密**：能用版本无关的「派生密钥内存扫描」法（`work/crackv4.exe`）从运行中的微信进程内存恢复每个库的 encKey，把核心微信库 0 坏页解密成明文 SQLite（[03_decryption.md](03_decryption.md)）。
3. **可解析**：`scripts/parseWeChat.ts` 能把"每会话一表"的微信 4.0 schema 解析进统一的明文 `data/wechat.db`（三表：`conversations` / `messages` / `contacts`，[04_parsing.md](04_parsing.md)）。
4. **可归档**：`scripts/archiveFiles.ts` 能扫描源根、去重、分类、**只复制**到 `archive/`，并写出 `data/library.json`（[05_archiving.md](05_archiving.md)）。
5. **可提炼**：多 agent Workflow 能对足量会话生成 nugget（`data/insights/conv/*.json`）、会话级总结，并把按类聚合的内容综述成主题富文本板（`data/insights/boards/*.md`，[06_insights.md](06_insights.md)）。
6. **可服务**：Express（端口 3456）能实时读盘提供全部 API：`/api/overview`、`/api/wechat/*`、`/api/insights`、`/api/library`、文件预览与 AI 代理等（[07_server-api.md](07_server-api.md)）。
7. **可浏览**：前端 13 板块全部可用，聊天三栏 / 文件全格式预览 / 洞察卡片墙 / AI 浮窗 / AI 配置板均正常工作（[08_frontend.md](08_frontend.md) / [09_ai-assistant.md](09_ai-assistant.md)）。

### 6.2 非功能性标准（MUST / SHOULD）

1. **原始零破坏**（MUST）：跑完全部管线后，原始聊天库与原始文件的字节级哈希**必须**与运行前一致。
2. **零外发**（MUST）：除用户显式配置的 AI 接入外，站点与管线**必须**不产生任何外发网络请求。
3. **架构合规**（MUST）：任何 `.ts` / `.tsx` / `.css` 源文件**必须** ≤ 300 行，按职责拆分（见 [01_architecture.md](01_architecture.md) §架构规范）。
4. **审美一致**（SHOULD）：站点**应**忠实呈现「午夜书斋」设计系统（暖金、深褐、衬线标题、颗粒质感），见 [08_frontend.md](08_frontend.md)。
5. **实时可见**（SHOULD）：`/api/wechat/*` 与 `/api/insights` **应**每次请求实时读盘，提炼 / 修复后**无需重启**即可在站上看到。
6. **边界如实**（MUST）：QQ 正文未解密等已知边界**必须**如实记录、不绕过、不伪装为"已完成"。

---

## 7. 术语表（Glossary）

| 术语 | 含义 |
|------|------|
| **机主 / Owner** | 数据的拥有者本人，也是站点的主用户。本项目示例为「羽升」（华中科技大学 基础医学强基 2501）；复刻方用 `{{机主身份}}` 替换。 |
| **会话 / Conversation** | 一个聊天对象（个人或群）对应的全部消息集合；解析后是 `data/wechat.db` 的 `conversations` 一行 + `messages` 多行。 |
| **nugget / 洞察要点** | AI 从一个会话 digest 中提炼出的一条"有长期价值"的要点，含 `category/title/content/people/date/importance` 等字段，写入 `data/insights/conv/<convId>.json`。 |
| **会话总结 / Summary** | 会话级的 `summary / topics / keyPeople`，与该会话的 nuggets 同文件产出。 |
| **主题富文本板 / Board** | 把同类 nugget 聚合后，由高质量 agent（Opus）综述成的 Markdown 富文本总结（`data/insights/boards/<category>.md`），共 13 类。 |
| **digest / 会话摘要** | 为提炼准备的、每会话一份 ≤48000 字的可读逐字记录摘要（`work/chat-digest/*.txt`），超大群按信息量抽样。 |
| **归档文件 / Archived file** | 从源端扫描、去重、分类后**复制**进 `archive/` 的文件，登记在 `data/library.json`。 |
| **源文件 / Source file** | 尚未归档、但被发现并索引的原始侧文件（如价值候选、数据库），通过 `/source-files/*` 只读访问。 |
| **价值候选 / Value Candidate** | 扫描发现、判定可能有价值但尚未归档的源文件，呈现在「候选」板。 |
| **encKey / 派生加密密钥** | SQLCipher 每库一份的派生密钥（非原始密钥），可用 2 轮 PBKDF2 + 一次 HMAC 廉价校验，是内存扫描解密的目标（见 [03_decryption.md](03_decryption.md)）。 |
| **crackv4** | 本项目的版本无关密钥恢复工具（`work/crackv4.exe`，纯 Go 无 CGO），暴扫进程私有内存找 encKey。 |
| **chatlog** | 参考实现（github.com/sjzar/chatlog，仓库已下架但 module cache 仍可拉到 v0.0.31），其解密常量被复用，但其 key 命令在 4.1.9.x 失配，故改用 crackv4。 |
| **Workflow / 扇出提炼** | 多 agent 并行编排：每会话一个 Sonnet agent 写一个 JSON、不回传正文，避免主上下文爆炸（见 [06_insights.md](06_insights.md)）。 |
| **午夜书斋 / Midnight Study** | 产品名兼设计系统代号，定义全部颜色 / 字体 / 质感令牌。 |
| **成果组 / 配置组** | 左侧导航的两组：`PRIMARY_NAV`（已成型结果）与 `CONFIG_NAV`（配置 + 证据 / 工作台）。 |
| **AI 解析 / AI 浮窗** | 聊天板右侧上下文面板的「AI 解析」按钮唤起的浮动 AI 对话框（`AIChatDock`），把该会话全文注入用户自配的模型。 |
| **管线 / Pipeline** | `scripts/` 下从定位到提炼的批处理脚本集合（`npm run ingest:*`）。 |
| **占位符 / `{{…}}`** | 文档中表示机器 / 账号特定值的标记，复刻方**必须**替换为自己的真实值。 |

---

## 8. 文档包导航（Where to go next）

- 想知道**整体架构与完整文件树** → [01_architecture.md](01_architecture.md)
- 想知道**数据藏在哪、怎么定位** → [02_data-sources.md](02_data-sources.md)
- 想知道**怎么解密** → [03_decryption.md](03_decryption.md)
- 想知道**怎么解析进 wechat.db** → [04_parsing.md](04_parsing.md)
- 想知道**怎么归档文件** → [05_archiving.md](05_archiving.md)
- 想知道**怎么 AI 提炼** → [06_insights.md](06_insights.md)
- 想知道**有哪些 API** → [07_server-api.md](07_server-api.md)
- 想知道**前端怎么做 / 设计系统** → [08_frontend.md](08_frontend.md)
- 想知道**AI 助手怎么接** → [09_ai-assistant.md](09_ai-assistant.md)
- 想知道**产出物与不能做什么** → [10_data-products-and-boundaries.md](10_data-products-and-boundaries.md)
- 想知道**代码 / 命名 / 提交约定** → [11_conventions.md](11_conventions.md)
- 想要**可直接执行的提示词 / 运行手册 / 技能** → [../PROMPT.md](../PROMPT.md) · [../RUNBOOK.md](../RUNBOOK.md) · [../SKILLS.md](../SKILLS.md) · [../../AGENTS.md](../../AGENTS.md)
