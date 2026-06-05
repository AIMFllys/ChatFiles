# 06 · 洞察提炼规格（AI Insight Distillation via Multi-Agent Workflow）

> 本文是「午夜书斋 / ChatFiles」洞察板块的**可复刻规格**。它把已解析的 `data/wechat.db` 聊天记录，经一条三阶段的多 agent **Workflow**（digest → 扇出 nuggets → 综述成板）蒸馏为结构化洞察，最终被服务端 `GET /api/insights` 读取、被前端「洞察」板块渲染。
>
> 所有规模数字为本项目实测值（project = 本机实跑结果）；所有机器/账号相关值用 `{{占位符}}`。
>
> 关键词遵循 **RFC 2119**：MUST / MUST NOT / SHOULD / SHOULD NOT / MAY 表示强制程度。中文「必须 / 禁止 / 应当 / 不应 / 可以」与之等义。
>
> 交叉引用：
> - 数据来源（`data/wechat.db` 三表 schema、字段语义）见 [`04_parsing.md`](04_parsing.md)。
> - 本规格产出的数据如何经 API 暴露见 [`07_server-api.md`](07_server-api.md)（尤其 `GET /api/insights`、`GET /api/overview`）。
> - 前端「洞察」板块如何消费见 [`08_frontend.md`](08_frontend.md)。
> - 与「AI 助手」对话功能（实时把 transcript 喂给 LLM）的关系见 [`09_ai-assistant.md`](09_ai-assistant.md)——那是**在线**蒸馏，本文是**离线批量**蒸馏，二者互补。
> - 端到端跑通的确切命令、陷阱与核验见 [`../04_RUNBOOK.md`](../../04_RUNBOOK.md)。

---

## 0. TL;DR（一句话与一张图）

把每个「实质会话」（文本消息 ≥ 20 条）压成一份**有上限的、信息密集的 digest**；对每份 digest **各起一个 Sonnet agent**离线提炼出可长期引用的「nugget（要点）」；再**按类聚合**，对每一类**各起一个 Opus agent**写一篇结构化「主题板（board）」富文本。

```
data/wechat.db
   │  scripts/prepChatDigests.ts （Node/tsx，纯本地，只读）
   ▼
work/chat-digest/<safe(convId)>.txt   （≤48000 字 digest，超大群按信息量抽样）
data/insights/_manifest.json          （会话清单：convId/name/digest 路径/字数…）
   │  阶段一：扇出（Workflow，每会话 1 个 Sonnet agent）
   ▼
data/insights/conv/<safe(convId)>.json （每会话：summary/topics/keyPeople + nuggets[]）
   │  阶段二：按类聚合（Node/tsx 或脚本）
   ▼
work/insights-cat/<category>.json      （同类 nugget 汇总，跨会话）
   │  阶段三：综述（Workflow，每类 1 个 Opus agent）
   ▼
data/insights/boards/<category>.md     （13 篇主题板，导语 + ## 主题 + > 引用 + 来源）
   │  服务端 GET /api/insights 实时读盘聚合
   ▼
前端「洞察」板块
```

本项目实测产出：**467** 个会话进入蒸馏候选，**464/467** 会话产出有效 nugget，共 **2,338** 条 nugget，**13** 篇主题板。

---

## 1. 阶段零 · 准备 digest（`scripts/prepChatDigests.ts`）

这是**唯一**确定性的（非 LLM）阶段，由 Node 脚本完成，可复现。它是后续两个 LLM 阶段的输入源。

### 1.1 职责

- 读 `data/wechat.db`（`{ readOnly: true }`，用 `node:sqlite` 的 `DatabaseSync`）。
- 选出**实质会话**：`text_count >= MIN_TEXT`，其中 `MIN_TEXT = 20`。本项目命中 **467** 个会话。
  - SQL：`SELECT id, display, is_group, msg_count, text_count, first_time, last_time FROM conversations WHERE text_count >= ? ORDER BY text_count DESC`
- 为每个会话生成一份 digest 文本文件 `work/chat-digest/<safe(convId)>.txt`。
- 写一份索引 `data/insights/_manifest.json`。

脚本运行：`npx tsx scripts/prepChatDigests.ts`（或项目 `package.json` 中等价 script）。它 MUST 只读数据库、只写 `work/chat-digest/` 与 `data/insights/_manifest.json`。

### 1.2 大小上限与抽样策略（MUST）

每份 digest MUST 受字符上限约束：`CAP_CHARS = 48000`。原因：下游每会话起一个 agent 读这份文件，digest 过大会撑爆 agent 上下文，也会触发 Read 工具的行数上限（见 §4 陷阱）。

抽样判定与算法（照抄脚本逻辑，禁止凭印象改）：

1. 只取**文本消息**参与 digest：`SELECT time, sender_name, text FROM messages WHERE conv_id=? AND type=1 AND length(text)>0 ORDER BY time`。
2. 计算 `fullChars = Σ text.length`。
3. **若 `fullChars <= CAP_CHARS`**：不抽样，全量按时间序逐行格式化（`sampled = false`）。
4. **若 `fullChars > CAP_CHARS`**（超大群/超长会话）：抽样（`sampled = true`），策略为「时间脊柱 + 信息量优先」：
   - **head（时间脊柱）**：取按时间序最前的 `min(rows.length, 120)` 条，保留对话开端的连续性。
   - **bySubstance（信息量评分）**：对全部消息按 `score = text.length + (含句末标点 ? 10 : 0)` 降序排序；句末标点判定正则 `/[。．.!?！？]/`。
   - 从高分到低分依次纳入，直到累计字符达 `CAP_CHARS` 为止；纳入的消息**再按原时间下标 `i` 升序还原**，保证可读时序。
   - 拼接为：`[...head, '... [按信息量抽样的其余消息] ...', ...picked]`。

> 设计意图：超大群里大量「在吗/收到/[图片]」噪声不应淹没真正有信息量的长句。评分把「长 + 有完整标点的句子」往前提，既保留开端语境（head），又保留全程精华（picked）。

### 1.3 单行格式（MUST 保持一致）

每条消息渲染为一行：

```
[YYYY-MM-DD HH:MM] <发言人(≤18字)>: <正文(空白折叠为单空格并 trim)>
```

实现：`dt = new Date(time*1000).toISOString().slice(0,16).replace('T',' ')`；`who = (sender_name || '某人').slice(0,18)`；正文 `text.replace(/\s+/g,' ').trim()`。

时间戳是 **unix 秒**（见 [`04_parsing.md`](04_parsing.md)），故乘 1000 再构造 `Date`。

### 1.4 digest 文件头（MUST）

每份 digest 文件 MUST 以一段中文 header 开头，供 agent 快速判断语境：

```
会话：<display><（群聊）|（私聊）>
消息数：<msg_count>（文本 <text_count>）
时间：<first 10字> ~ <last 10字><\n注意：本会话很大，已按信息量抽样 —— 仅 sampled 时>

<正文行…>
```

最终写盘内容 MUST 再做一次硬截断：`(header + lines.join('\n')).slice(0, CAP_CHARS + 4000)`（`+4000` 给 header 与抽样提示留余量）。

### 1.5 `safe(convId)` 文件名净化（MUST，全管线一致）

```ts
function safe(id: string) {
  return id.replace(/[<>:"/\\|?*@ -]/g, '_').slice(0, 90)
}
```

- 把 Windows 文件名非法字符、`@`、空格、连字符统一替换为 `_`，再截断到 90 字。
- **三处阶段 MUST 用同一个 `safe()`**：digest 文件名、`conv/<safe(convId)>.json` 文件名、聚合时回查。任何一处不一致都会导致「写了 nugget 却聚合不到」的静默丢失。

### 1.6 manifest 结构（`data/insights/_manifest.json`）

数组，每项：

```jsonc
{
  "convId":   "<会话主键 conversations.id>",
  "name":     "<display 显示名>",
  "isGroup":  true,                       // is_group === 1
  "textCount": 1234,                      // text_count
  "chars":     47800,                     // 实际 digest 字节长度（已截断后）
  "sampled":   true,                      // 是否触发了抽样
  "digest":    "<digest 绝对路径>",
  "first":     "YYYY-MM-DD",
  "last":      "YYYY-MM-DD"
}
```

脚本结束打印三行统计：`prepared N digests`、`manifest -> …`、`sampled (huge) conversations: M`。

> 注意 manifest 是 `JSON.stringify(manifest, null, 2)` 美化输出，会有很多行。下游 agent **不应**用 Read 工具去整读它（行数上限，见 §4），编排脚本应用 `JSON.parse(fs.readFileSync(...))` 在 Node 侧读取并把会话清单**经 args 传给 Workflow**。

---

## 2. 阶段一 · 扇出提炼 nuggets（Workflow，每会话一个 Sonnet agent）

### 2.1 编排形态（MUST）

- 用 **ultracode / Claude Code 的 Workflow** 机制做**扇出（fan-out）**：对 manifest 里的每个会话**各分派一个 agent**。
- 每个 agent 用 **Sonnet**（性价比：要的是覆盖与吞吐，不是文学性）。
- 每个 agent 的任务**自包含**：
  1. 用 Read 工具读自己那份 `work/chat-digest/<safe(convId)>.txt`（≤48000 字，单文件，安全在 Read 上限内）。
  2. 提炼有**长期价值**的要点。
  3. 用 **Write 工具**把结果写到 `data/insights/conv/<safe(convId)>.json`。
  4. **只回传一行状态字符串**（例如 `ok <convId> <n> nuggets`），**MUST NOT 把 nugget 内容回传给主上下文**。

> 「只回传一行」是本管线的命门：467 个 agent 若各自把几 KB JSON 回传，主编排上下文会瞬间爆掉。内容**落盘**，主进程只收状态。

### 2.2 每会话产出文件 `data/insights/conv/<safe(convId)>.json`

顶层对象（会话级 + nugget 数组）：

```jsonc
{
  "convId":   "<conversations.id>",
  "name":     "<display>",
  "isGroup":  true,
  "summary":  "≤数句话的会话级语境总结（这群/这人在聊什么、关系、时间跨度）",
  "topics":   ["主题1", "主题2", "…"],
  "keyPeople":["关键人物A", "关键人物B"],
  "nuggets":  [ /* 见 §2.3 */ ]
}
```

> 服务端 `GET /api/insights` 会读取 `convId/name/isGroup/summary/topics/keyPeople` 拼 `summaries[]`，并把 `nuggets[]` 摊平按 `category` 归桶（见 [`07_server-api.md`](07_server-api.md)）。字段名 MUST 与此处一致，否则前端读不到。

### 2.3 nugget 结构（MUST 严格）

```jsonc
{
  "category":   "技术|哲理|学业|创业|比赛|AI|人物|资源工具|生活|健康|财务|专业|其他",
  "title":      "一句话标题",
  "content":    "≤140字，可引用原话（引用 MUST 用中文「」，见 §4 陷阱）",
  "people":     ["相关人物…"],
  "date":       "YYYY-MM 或空字符串",
  "importance": 1
}
```

约束：

- `category` MUST 取自上面**13 个枚举值之一**（含「其他」兜底）。任何超集 / 自创类名会被聚合阶段当作未知类丢进「其他」或丢失。
- `category` MUST NOT 含 `/`、`\` 等路径分隔符（它最终会变成文件名 `<cat>.md`，见 §4 陷阱）。
- `content` MUST ≤ 140 字；要引用原话时 MUST 用中文方角引号「」，MUST NOT 用 ASCII 直引号 `"`（否则破坏 JSON，见 §4）。
- `importance` MUST 为整数 **1–5**（5 最重要）。聚合后服务端按 `importance` 降序排卡片。
- `date` 是 `YYYY-MM` 或空串（无法判定时留空，禁止瞎编）。

### 2.4 提炼准则（写进 agent 提示词，SHOULD）

- 只留**长期有价值**的：决策、方法论、资源链接/工具、人物关系与承诺、学业/比赛/创业的关键事实、健康/财务节点。
- **过滤**寒暄、接龙、纯表情、纯转发噪声。
- `content` 应**自解释**（脱离原对话也能读懂），同时可引一句原话佐证。
- 一个会话的 nugget 数随其信息量自然变化（私聊可能 1–3 条，活跃技术群可能数十条）。

本项目实测：**464/467** 会话产出了有效 nugget（其余 3 个为空/无价值），合计 **2,338** 条。

---

## 3. 阶段二+三 · 按类聚合 → 综述成主题板（Opus agents）

### 3.1 聚合（确定性，Node/tsx）

- 遍历 `data/insights/conv/*.json`，把每条 nugget 按 `category` 归桶，写到 `work/insights-cat/<category>.json`（同类、跨会话的 nugget 汇总，每条 SHOULD 带上来源 `conv`/`convId` 以便板里标注来源）。
- 聚合脚本 MUST **跳过解析失败的 JSON**（容错），且 MUST 用与 §1.5 相同的 `safe()` 概念定位文件——但聚合是按内容里的 `category` 归桶，不是按文件名。
- `category` 含非法路径字符时 MUST 在生成 `<category>.json` / `<category>.md` 文件名前净化（见 §4）。

### 3.2 综述（Workflow，每类一个 Opus agent）

- 对每一类**各起一个高质量 agent（Opus）**——本项目约 **13 个**。
- 每个 agent 读 `work/insights-cat/<category>.json`（或直接读该类的全部 nugget），**用 Write 工具**写 `data/insights/boards/<category>.md`。
- 同样 MUST 遵守「只回传一行状态、内容落盘」的纪律。

### 3.3 主题板（board）富文本结构（SHOULD）

每篇 `data/insights/boards/<category>.md` 是一篇**顶级富文本总结**，结构：

```markdown
<导语：这一类整体在讲什么、时间跨度、与机主的关系，2–4 句>

## 主题小节一
…叙述…
### 子题（可选）
> 原话引用（用中文「」内的句子或直接引述）
来源：<会话名/时间>

## 主题小节二
…
```

- MUST 含**导语**、`##`/`###` **主题小节**、`>` **引用块**（原话）、**来源标注**。
- 输出是 Markdown，前端用 react-markdown + remark-gfm 渲染（见 [`08_frontend.md`](08_frontend.md)），故 GFM 语法可用。
- 文件名 MUST 是 `<category>.md`，服务端按 `f.replace(/\.md$/,'')` 取类名做 key（见 [`07_server-api.md`](07_server-api.md)）。

### 3.4 13 篇主题板（本项目实测清单）

```
AI · 专业 · 个人成长 · 人物 · 健康 · 创业 · 哲理 · 学业 · 技术 · 比赛 · 生活 · 财务 · 资源工具
```

> 说明：板的类名集合与 nugget 的 `category` 枚举**不完全相同**——例如 nugget 枚举里是「资源工具」，板里也是「资源工具」；而「个人成长」是综述阶段对若干相关类做的人工命名板，可由编排者按内容裁定。复刻时 MAY 按自己数据的类分布调整板的数量与命名，但每个 `category` 桶 SHOULD 至少有一篇板（或并入相近板），否则前端该类只有卡片、无导读。

---

## 4. 编排陷阱（MUST 照做，否则会像本项目早期一样卡死/产废数据）

这一节是血泪经验。复刻者 MUST 逐条规避。

### 4.1 禁止「单 bootstrap agent 用 schema 返回全部 467 条」

- **症状**：让一个引导 agent 用结构化 schema 一次性把 467 个会话的结果全返回 → **挂起 / 超时**。
- **正解**：把会话清单**经 Workflow 的 `args` 直接传入**，脚本里 `const list = JSON.parse(args)`。注意 **`args` 经常以字符串到达**，故 MUST 显式 `JSON.parse`。然后由 Workflow 扇出，每会话一个独立 agent。

### 4.2 Read 工具有 2000 行上限

- 不要让 agent 用 Read 去整读 `_manifest.json`（`null,2` 美化后行数极多）或任何 4000+ 行文件。
- 会话清单应在**编排脚本（Node 侧）** 用 `fs.readFileSync` 读、`JSON.parse` 解析，再分发；agent 只读自己那份**单一 digest**（≤48000 字，安全在上限内）。

### 4.3 `safe(convId)` 必须全管线一致

- digest 写、`conv/*.json` 写、聚合回查三处 MUST 用同一净化函数（§1.5）。任何不一致都会让 nugget「写成功但聚合丢失」，且**无报错**（静默）。

### 4.4 `category` 含 `/` 会破坏文件名

- 类名最终变成 `work/insights-cat/<cat>.json` 与 `data/insights/boards/<cat>.md`。若类名含 `/`（如误写「资源/工具」），会被当作子目录或写盘失败。
- MUST 在生成文件名前净化类名（至少把 `/`、`\` 替换掉），并在提示词里约束 agent 只用 §2.3 的 13 个枚举值。

### 4.5 LLM 写出未转义 ASCII 引号 → JSON 非法（最高频坑）

- **症状**：agent 在 `content` 里直接写英文 `"…"` 引用原话，未转义 → 该 `conv/*.json` 整文件 JSON 解析失败。本项目 **467 个里有 243 个**坏掉。
- **预防（提示词层）**：要求引用时一律用中文「」，禁止 ASCII 直引号。
- **修复（事后批处理）**：用 `json-repair`（`pip install json-repair`，纯 Python，无原生依赖）批量修复并回写：逐个读坏文件 → `json_repair.repair_json(...)` → 覆盖写回。
- **防御（消费侧）**：服务端 `GET /api/insights` 的 `loadInsights()` 对单文件 `JSON.parse` 包了 try/catch，坏文件**静默跳过**——这意味着没修复的坏文件会**直接从洞察里消失**，不会报错。故修复 MUST 在分发到前端前完成，否则覆盖率虚低。

### 4.6 内容落盘、状态回传（再次强调）

- 每个 agent **MUST** 用 Write 落盘、**只回传一行状态**。违反此条是 467 路扇出最常见的「主上下文 OOM / 卡顿」根因。

### 4.7 幂等与重跑

- 三阶段都 SHOULD 幂等：重跑 `prepChatDigests.ts` 覆盖 digest；重跑某会话 agent 覆盖其 `conv/*.json`；重跑某类 agent 覆盖其 board。
- 因为服务端**每请求实时读盘**（见 §5），重跑/修复后**无需重启服务**即可在站上看到——这是刻意的运维便利。

---

## 5. 与服务端 / 前端的契约（消费侧）

- `GET /api/insights`（[`07_server-api.md`](07_server-api.md) §有详述）每次请求**实时**：
  - 遍历 `data/insights/conv/*.json` → 摊平 nugget 按 `category` 归桶 `byCategory`，每桶按 `importance` 降序；
  - 抽出会话级 `summary/topics/keyPeople` 成 `summaries[]`；
  - 遍历 `data/insights/boards/*.md` 成 `boards`（key = 去 `.md` 的文件名）。
- `GET /api/overview` 的 `insights` 段用 `data/insights/conv/*.json` 现算 `conversations` 与 `nuggets` 总数。
- 因为**实时读盘**，本规格任一阶段重跑/修复后**MUST NOT** 需要重启进程；前端刷新即更新。

字段名一致性是硬约束：`category / title / content / importance / people / date`（nugget）与 `convId / name / isGroup / summary / topics / keyPeople / nuggets`（会话级）MUST 与本文一致，否则前端「洞察」板块（13 类目 + importance 排序卡片 + 顶部 board）渲染会缺数据。

---

## 6. 安全与隐私（MUST，与全项目一致）

- 本管线**纯本地**运行：读 `data/wechat.db`、写 `work/` 与 `data/insights/`，不出网。
- 提交给 agent 的是**机主自己的聊天记录**；离线蒸馏发生在本机 Claude Code 工作流内。
- 这与「AI 助手」在线对话功能不同——后者会把 transcript 通过用户自配的 OpenAI 兼容端点发出，其**密钥不落盘、不记录、仅请求期透传**（见 [`09_ai-assistant.md`](09_ai-assistant.md) 与 [`07_server-api.md`](07_server-api.md) 的 `POST /api/ai/chat`）。本离线管线**不涉及任何第三方 LLM 密钥的持久化**。

---

## 7. 复刻核对清单（Definition of Done）

- [ ] `npx tsx scripts/prepChatDigests.ts` 跑通，`work/chat-digest/*.txt` 与 `data/insights/_manifest.json` 生成；统计行打印的 `sampled` 数合理。
- [ ] 每份 digest ≤ `CAP_CHARS + 4000` 字；超大群确实触发抽样且仍含 head 脊柱。
- [ ] Workflow 扇出：每会话一个 Sonnet agent，**经 args 传清单**（`JSON.parse(args)`），各自 Write `data/insights/conv/<safe(convId)>.json`，**只回传一行状态**。
- [ ] nugget JSON 字段与枚举严格符合 §2.3；引用用「」。
- [ ] 跑 `json-repair` 修复非法 JSON，复核 `GET /api/insights` 的 `convCount`/`nuggetCount` 接近 464/2338 量级（按你的数据）。
- [ ] 聚合到 `work/insights-cat/<cat>.json`；类名已净化无 `/`。
- [ ] 每类一个 Opus agent 写 `data/insights/boards/<cat>.md`，含导语 + `##/###` + `>` 引用 + 来源；约 13 篇。
- [ ] 服务端 `GET /api/insights` 与前端「洞察」板块能正确渲染类目、卡片（按 importance 排序）、顶部 board——且**重跑后无需重启**。
