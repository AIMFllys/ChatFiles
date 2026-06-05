# 10 · 数据产物 / 边界 / 复刻验收清单

> 本文是复刻包的"账本"：把项目**生成出来的所有数据产物**列清楚，把**已知边界如实记录**（不绕过、不粉饰），并给出一份可逐项打勾的**复刻验收清单**。所有路径/账号/机器值用 `{{占位符}}`。规模数字为本项目实测值。
>
> 相关文档：项目宪法 [`../../AGENTS.md`](../../AGENTS.md)；复刻提示词 [`../PROMPT.md`](../PROMPT.md)；解密规格 [`./03_decryption.md`](./03_decryption.md)；提炼规格 [`./06_insights.md`](./06_insights.md)；前端规格 [`./08_frontend.md`](./08_frontend.md)；AI 助手规格 [`./09_ai-assistant.md`](./09_ai-assistant.md)。

---

## 1. 数据产物清单（Generated Data Products）

下表是流水线各阶段**写出的全部产物**。除"复刻文档包"外，所有产物都属于机主隐私，**MUST 全部 gitignore**——仓库里只提交**代码 + 复刻文档**，绝不提交任何 `data/` `archive/` `work/` 下的真实数据。

| # | 产物 | 路径（`{{项目目录}}/` 下） | 形态 | 实测规模 | 生成阶段 / 脚本 | 提交? |
|---|------|------|------|----------|------|:---:|
| 1 | 微信结构化库 | `data/wechat.db` | 明文 SQLite，**3 张表** | 见 §1.1 | 解析 · `scripts/parseWeChat.ts` | ❌ gitignore |
| 2 | 会话索引 | `data/wechat/index.json` | JSON | 会话级索引 | 解析 · `parseWeChat.ts` | ❌ |
| 3 | 逐字记录 | `work/chat-text/*.txt` | 纯文本，每会话一份 | 供提炼读取 | 解析 · `parseWeChat.ts` | ❌ |
| 4 | 归档文件副本 | `archive/<一级>/<次级>/…` | 复制的原文件 | **5,907 文件 · 33.7 GB** | 归档 · `scripts/archiveFiles.ts` | ❌ |
| 5 | 文件清单 | `data/library.json` | JSON（每文件 path/size/preview/sha256/category） | 对应 5,907 条 | 归档 · `archiveFiles.ts` | ❌ |
| 6 | 会话级洞察 | `data/insights/conv/*.json` | 每会话一个 JSON（nugget 数组 + summary/topics/keyPeople） | **464 文件 · 2,338 nuggets** | 提炼扇出 · Workflow（Sonnet） | ❌ |
| 7 | 主题富文本板 | `data/insights/boards/*.md` | 富文本 Markdown，每类一篇 | **13 个板** | 综述 · Workflow（Opus） | ❌ |
| 8 | 洞察清单 | `data/insights/_manifest.json` | JSON（待提炼会话清单 / 进度） | — | 准备 · `scripts/prepChatDigests.ts` | ❌ |
| 9 | 会话 digest | `work/chat-digest/*.txt` | ≤48000 字/份，超大群抽样 | 467 份候选 | 准备 · `prepChatDigests.ts` | ❌ |
| 10 | 微信明文库 | `work/decrypted/wechat/<account>/…` | 明文 SQLite（逐页解密产物） | 主账号 17 库 0 坏页 | 解密 · `work/crackv4.exe` | ❌ gitignore |

> 规则（MUST）：上述 1–10 全部进 `.gitignore`。复刻者克隆仓库后 **MUST 在自己机器上重新跑流水线生成它们**，不应期望仓库里带数据。

### 1.1 `data/wechat.db` 三表（产物 #1 的结构）

| 表 | 关键列 | 内容 |
|----|--------|------|
| `conversations` | `id, account, username, display, is_group, msg_count, text_count, first_time, last_time, summary` | 每会话一行 |
| `messages` | `conv_id, seq, time, sender, sender_name, type, type_label, text`（索引 `(conv_id, time)`） | 逐条消息，`time` 为 unix 秒 |
| `contacts` | `account, username, display, nick, remark, alias, is_group` | 联系人/群 |

### 1.2 顶层规模（本项目实测，供"是否复刻到位"对照）

980 会话 · 738,511 消息 · 427,803 文本消息 · 18,068 联系人 · 5,907 归档文件(33.7GB) · 2,338 洞察 · 464 会话总结 · 13 主题板。

---

## 2. 已知边界（如实记录，MUST NOT 绕过）

以下是项目**有意未跨越**的边界。复刻者 MUST 同样如实记录；**MUST NOT** 为了"看起来更完整"而绕过策略限制或伪造数据。

### 2.1 边界 A — QQ 聊天**正文**未解密

- `nt_qq\nt_db\nt_msg.db` 是自定义 **`QQ_NT DB`** 格式：它是 SQLCipher 的一个变体，但 **salt 不在文件偏移 0**、且带一段**自定义明文头**——比微信的标准 SQLCipher v4 更难，且**强版本绑定**（随 QQNT 版本变化）。
- 本项目曾发起**一次独立的自动化 QQ 解密尝试**，该尝试**被 Anthropic 使用政策（网络安全/cyber 内容）拦截**。该拦截**未被绕过**——这是有意识、如实的记录。
- **已完成的部分（MUST 保留）**：QQ 附件 `nt_qq\nt_data\`（**227 个，明文**）**已归档**进文件板块，可直接浏览/预览。
- 结论：QQ **附件可用**，QQ **聊天正文为已知缺口**，标注为版本相关的待解项。

### 2.2 边界 B — 微信 `.dat` 加密图片未解密

- 本项目 `msg/` 下有 **69,820 个** `.dat` 加密图片，需要一把**独立的图片密钥**才能还原（参考 chatlog 的 `img-key` / `dat2img` 能力）。
- 本项目**留作增强项**，未实现。归档阶段对 `.dat` 做**噪声过滤跳过**（不计入 5,907）。

### 2.3 边界 C — 洞察覆盖度 464/467

- 提炼覆盖 **464 / 467** 个实质会话；缺口 3 个为空/无长期价值会话。
- **其它账号**的核心库要解密，**MUST 各自登录后**才能从该账号进程内存里取到它自己的派生密钥——本项目只覆盖了已登录的主账号。

---

## 3. 复刻验收清单（Replication Acceptance Checklist）

复刻者逐项打勾；**全绿才算"复刻到位"**。建议按顺序验。

### 3.1 数据层

- [ ] `data/wechat.db` 含**真实中文会话与消息**（`conversations` / `messages` 非空、`text` 为可读中文、`time` 为合理 unix 秒区间）。
- [ ] `data/library.json` 中**按分类的 `archived` 计数 > 0**（不是一个文件都没归档——务必确认归档源根含 `{{微信存储根}}\xwechat_files\*\msg`）。
- [ ] `data/insights/conv/*.json` **全部是合法 JSON 且含 nuggets**（用 `json-repair` 修复未转义引号后，0 个非法）。
- [ ] `data/insights/boards/*.md` **存在多个主题板**（本项目 13 个：AI/专业/个人成长/人物/健康/创业/哲理/学业/技术/比赛/生活/财务/资源工具）。

### 3.2 构建 / 服务

- [ ] `npm run build` **通过**（前端 + 服务端类型检查/构建无错）。
- [ ] 站点在 **`:3456`** 起来后，各 API 返回**真实数字**（非占位/0）：
  - [ ] `GET /api/overview` 返回真实总量。
  - [ ] `GET /api/wechat/conversations` 返回真实会话列表。
  - [ ] `GET /api/insights` 聚合出真实 nugget / board。
- [ ] 洞察板块前端展示**全部 13 个主题板**。

### 3.3 AI 助手

- [ ] **AI 助手已配置**（assistant config 就位），`POST /api/ai/chat` 可用。
- [ ] AI 助手的**对话记录 / transcript 正常工作**（见 [`./09_ai-assistant.md`](./09_ai-assistant.md)）。

### 3.4 完整性 / 诚实性

- [ ] **原始文件字节未改**：所有源 `.db` / `msg` / `nt_data` 原文件**逐字节不变**（流水线只读源、只写副本到 `data/` `archive/` `work/`）。
- [ ] **QQ 边界已如实记录**：文档中保留 QQ 正文未解密 + 策略拦截未绕过的说明；QQ 附件（227）已归档。

> 验收原则（MUST）：任一项不达标，**MUST 记录为边界或缺陷**，**MUST NOT** 用伪造数据或绕过策略的手段"凑绿"。
