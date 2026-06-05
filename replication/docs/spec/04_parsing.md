# 04 · 解析规格：微信 4.0 schema → `data/wechat.db`

> 本文是 **午夜书斋 / ChatFiles** 复刻规格的「解析」分册。读者对象是另一台机器上的复刻 AI / 工程师。
> 目标：把**已解密**的微信 4.0 数据库（SQLCipher 解密后的明文 SQLite 副本）规范化成**一个明文 SQLite**（`data/wechat.db`，三张表）+ 一份会话索引 JSON + 每会话可读逐字记录，供后续归档、提炼、前端消费。
> 权威实现：`scripts/parseWeChat.ts`（用 `tsx` 运行）。本文描述的是**代码实际做了什么**，不是理想化设计。凡与代码冲突，以代码为准。
> 规模锚点（本项目实测，复刻时数量会因机主数据不同而变）：**980 会话 / 738,511 消息 / 427,803 文本消息**，源 `message_0.db` 约 **1154** 张会话表。

本文用 RFC 2119 关键词（**MUST / MUST NOT / SHOULD / SHOULD NOT / MAY**）标注强制级别。机器/账号相关的值一律用 `{{占位符}}`。

关联文档：
- 解密如何产出输入：见 [`03_decryption.md`](./03_decryption.md)。
- 解析产物如何被提炼成洞察：见 [`06_insights.md`](./06_insights.md)。
- 数据产品边界（QQ 未解密、`.dat` 加密图等）：见 [`10_data-products-and-boundaries.md`](./10_data-products-and-boundaries.md)。
- 端到端运行顺序与命令：见 [`../RUNBOOK.md`](../RUNBOOK.md)。

---

## 1. 前置条件与不变量（Invariants）

### 1.1 输入只读、原库不动

- 解析器 **MUST** 只读取**解密后的副本**，根目录固定为 `work/decrypted/wechat/<account>/`（`<account>` 为账号目录名，形如 `{{wxid}}_{{short}}`）。
- 解析器 **MUST NOT** 触碰机主真实微信存储（`{{微信存储根}}`，本项目被迁移到 `D:\{{微信迁移目录}}\xwechat_files\`，详见 [`03_decryption.md`](./03_decryption.md) 与 [`05_archiving.md`](./05_archiving.md)）。
- 解析器 **MUST** 用 `readOnly: true` 打开所有源 `.db`（`new DatabaseSync(p, { readOnly: true })`），避免对解密副本产生任何写入（包括 WAL/SHM 副作用）。
- 输出目录 `data/`、`work/chat-text/` **MUST** 在写入前用 `fs.mkdirSync(..., { recursive: true })` 确保存在。

### 1.2 技术栈约束

- 运行时 **MUST** 是 Node 24+（解析依赖两个内置能力）：
  - `node:sqlite` 的 `DatabaseSync`（同步 SQLite，免原生编译依赖）。
  - `zlib.zstdDecompressSync`（解 zstd 压缩的文本正文，见 §3.3）。
- **MUST NOT** 引入第三方 SQLite/zstd 包；整个解析器仅用 `node:fs / node:path / node:crypto / node:zlib / node:sqlite`。
- 时间戳一律为 **unix 秒**（见 §6）。

### 1.3 幂等

- 每次运行 **MUST** 先 `fs.rmSync(outDbPath, { force: true })` 删除旧 `data/wechat.db` 再重建，使解析可重复执行且结果确定。
- 会话索引 JSON 与逐字记录 **SHOULD** 直接覆盖写。

---

## 2. 解密副本的目录结构（解析器看到的输入）

每个账号目录 `work/decrypted/wechat/<account>/` 下 **MUST** 含一个 `db_storage/` 子树（解析器正是以此判定「这是一个有效账号」）：

```
work/decrypted/wechat/<account>/
└─ db_storage/
   ├─ message/
   │  ├─ message_0.db          主聊天库（本项目 ~1154 张 Msg_* 表，原始 ~673MB）
   │  ├─ message_1.db          溢出/分片聊天库（可能不存在）
   │  └─ …（media_0.db / message_fts.db / biz_message_*.db —— 本解析器不读）
   ├─ contact/
   │  └─ contact.db            联系人、群、name2id 发送人映射
   └─ session/
      └─ session.db            会话摘要 + 最后时间戳
```

- 账号发现规则（`findAccounts`）：解析器 **MUST** 遍历 `work/decrypted/wechat/` 下的一级目录，**仅**保留同时存在 `db_storage/` 子目录者，作为账号集合。若 `work/decrypted/wechat/` 不存在，**MUST** 返回空集（不报错）。
- 解析器 **MUST** 容忍任一可选库缺失：`contact.db`、`session.db`、`message_1.db` 缺失时 **MUST** 优雅降级（用 `openIf` 包裹，缺失返回 `null`），而非崩溃。
- `openIf(p)` 语义 **MUST** 为：文件存在则 `new DatabaseSync(p, { readOnly: true })`，否则或抛错则返回 `null`。

---

## 3. 微信 4.0 message schema（核心）

### 3.1 「每会话一张表」模型

微信 4.0 **不是**「一张大 message 表」，而是 **每个会话一张表**，表名为：

```
Msg_<md5(username)>
```

- `username` 是会话对端的标识：私聊为对方 `wxid_*`（或自定义微信号），群聊为 `{{房间号}}@chatroom`。
- `md5` **MUST** 取 `username` 的 **UTF-8 字节** 的 MD5 十六进制小写串：
  ```ts
  crypto.createHash('md5').update(username, 'utf8').digest('hex')
  ```
- 本项目 `message_0.db` 含约 **1154** 张 `Msg_*` 表。会话可能分布在 `message_0.db` 与 `message_1.db` **两个库**中（同一会话的同名表可能在两库各有一部分），解析器 **MUST** 跨库合并（见 §4.3）。

解析器 **MUST** 通过 `sqlite_master` 枚举每个库里真实存在的 `Msg_*` 表，再据 `username` 计算目标表名去匹配，**MUST NOT** 盲目 `SELECT` 一个未确认存在的表名（否则报错）：

```sql
SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Msg_%'
```

### 3.2 单条消息的列

每张 `Msg_*` 表的列包含（解析器实际 `SELECT` 的子集已加粗）：

```
local_id, server_id, local_type, sort_seq, real_sender_id,
create_time, status, …, message_content, compress_content, …
```

解析器 **MUST** 只取必要列并按时间排序：

```sql
SELECT create_time, real_sender_id, local_type, message_content
FROM "Msg_<md5(username)>"
ORDER BY sort_seq
```

- 列名 **MUST** 用双引号包裹表名（表名含哈希、合法但保守起见加引号）。
- 排序 **MUST** 用 `sort_seq`（微信的逻辑序），**不是** `local_id`；随后在内存里再按 `create_time` 做一次稳定排序（见 §4.3），以便跨库合并后时间单调。
- 单表 `SELECT` 抛错（如某分片表结构异常）时，解析器 **MUST** `continue` 跳过该来源、不影响其他来源。

### 3.3 `message_content` 解码（zstd / utf8）

`message_content` 在 `node:sqlite` 中可能以 `string`、`Uint8Array`（BLOB）或 `null` 返回。解码规则 `decodeContent(value)`：

- `null` / `undefined` → 空串 `''`。
- `string` → 原样返回。
- `Uint8Array`（BLOB）：
  - 若前 4 字节为 **zstd 魔数** `28 b5 2f fd`（`buf[0]===0x28 && buf[1]===0xb5 && buf[2]===0x2f && buf[3]===0xfd`），则 **MUST** 用 `zlib.zstdDecompressSync(buf).toString('utf8')` 解压；解压失败 **MUST** 回退为空串 `''`（包在 try/catch，绝不抛出）。
  - 否则按 `utf8` 直接 `buf.toString('utf8')`。
- 其他类型 → `String(value)`。

> 工程要点：文本类消息（`local_type=1`）的正文几乎都是 zstd 压缩的。**MUST** 在 BLOB 路径上先判魔数，否则会把压缩字节误当 UTF-8 而得到乱码。

### 3.4 `local_type` → 粗粒度标签

`typeLabel(localType)` **MUST** 按下表映射；表外类型 **MUST** 落到 `type_<n>`：

| `local_type` | `type_label` | 含义 |
|---|---|---|
| 1 | `text` | 文本 |
| 3 | `image` | 图片 |
| 34 | `voice` | 语音 |
| 43 | `video` | 视频 |
| 47 | `sticker` | 表情/动图 |
| 42 | `card` | 名片 |
| 48 | `location` | 位置 |
| 49 | `app` | 应用消息（XML：文件 / 链接 / 引用 / 转账 / 小程序…） |
| 50 | `voip` | 音视频通话 |
| 10000 | `system` | 系统消息 |
| 10002 | `system` | 系统消息 |
| 其它 | `type_<n>` | 未知类型（保留原值） |

> 注意：`typeLabel` 含 `50→voip`，但人类可读文本提取（§3.6）的 `extractText` **不**为 50 单列分支，会落到通用兜底分支 `[voip]`。这是代码现状，复刻 **MUST** 与之一致。

### 3.5 群消息发送人前缀

群聊（`username` 以 `@chatroom` 结尾，`isGroup === true`）的正文 **MUST** 先剥离发送人前缀：正文形如 `<sender_wxid>:\n<真正内容>`。

- 提取正则 **MUST** 为：`/^([0-9A-Za-z_@.\-]+):\n/`。命中则 `sender = m[1]`，`body = content.slice(m[0].length)`。
- 该 `sender`（来自正文前缀）**优先于** `real_sender_id` 解析结果（见 §4.2）。
- 私聊（非 `@chatroom`）**MUST NOT** 做前缀剥离。

### 3.6 人类可读文本提取 `extractText(localType, content, isGroup)`

返回 `{ text, sender? }`。规则（**MUST** 逐条照实现）：

1. 先按 §3.5 处理群前缀，得到 `body` 与可选 `sender`。
2. **文本（`localType===1`）**：`text = body.trim()`。
3. **应用消息**：`localType===49` **或** `body.includes('<appmsg')` 时，从 XML 抽取字段（用 `xmlTag`，见 §3.7）并拼装：
   - 取 `title`、`des`、`url`、`appname`（优先 `sourcedisplayname`，回退 `appname`）、`fileext`。
   - 组装顺序：`title` →（`des` 且 `des !== title` 时加 `des`）→（有 `fileext` 时加 `[文件 .<fileext>]`）→（有 `url` 时加 `url`）→（有 `appname` 时加 `(<appname>)`）。
   - 以 ` — `（空格-破折号-空格）连接、`trim()`；若结果为空，**MUST** 兜底为 `[链接/应用消息]`。
4. **图片 `3`** → `[图片]`；**语音 `34`** → `[语音]`；**视频 `43`** → `[视频]`；**表情 `47`** → `[表情]`；**位置 `48`** → `[位置]`。
5. **名片 `42`** → `` `[名片] ${xmlTag(body,'nickname')}`.trim() ``。
6. **系统 `10000` / `10002`**：去标签 `body.replace(/<[^>]+>/g, '').trim()`，非空则 `` `[系统] ${sys}`.slice(0, 300) ``（**MUST** 截断到 300 字符），空则 `[系统消息]`。
7. **兜底**：其它类型 → `` `[${typeLabel(localType)}]` ``（如 `[voip]`、`[type_999]`）。

`sender`（若群前缀命中）**MUST** 随 `{ text, sender }` 一并返回。

### 3.7 XML 字段抽取 `xmlTag(xml, tag)`

- 正则 **MUST** 为 `new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'i')`（大小写不敏感、跨行非贪婪、容忍标签属性）。
- 命中后 **MUST** 去 CDATA 包裹：`.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')` 再 `.trim()`。
- 未命中 **MUST** 返回空串。

---

## 4. 联系人 / 发送人 / 会话元数据解析

### 4.1 `contact.db` → 显示名与分组

解析器 **MUST** 从 `contact` 表读取并构建 `username → 显示信息` 映射：

```sql
SELECT username, nick_name, remark, alias, local_type FROM contact
```

- **显示名计算（关键，全项目统一）**：`display = remark || nick_name || alias || username`（即备注 > 昵称 > 别名 > 原始 username 的优先级，取第一个非空）。
- `isGroup` **MUST** 由 `username.endsWith('@chatroom')` 判定（**不**依赖 `local_type`）。
- 每条 **MUST** 写入输出 `contacts` 表（见 §5.1）。
- 空 `username` 行 **MUST** 跳过。

补充群名（`chat_room` 表，可能不存在，**MUST** 用 try/catch 容错）：

```sql
SELECT username FROM chat_room
```
对其中尚未在映射里的 `username`，**MUST** 以 `display = username`、`isGroup = true` 占位补入（保证群有条目，即使无好名字）。

### 4.2 `name2id` → 发送人还原

群消息要把数字 `real_sender_id` 还原成 `username`，**MUST** 读 `contact.db` 的 `name2id` 表，建 `rowid → username` 映射。列名在不同版本不一致，**MUST** 依次尝试两种 schema（前者失败回退后者，均失败则空映射）：

```sql
-- 首选
SELECT rowid AS id, user_name FROM name2id
-- 回退
SELECT rowid AS id, username  FROM name2id
```

发送人解析优先级（`extractText` 与主循环共同决定），解析器 **MUST** 按此顺序：
1. 群正文前缀里的 `sender`（§3.5）；
2. 否则 `idToName.get(Number(real_sender_id))`；
3. 否则空串 `''`。

得到 `senderUser` 后，`sender_name = dispName(senderUser)`（即用 §4.1 的显示名映射；查不到则回落 `senderUser` 本身）。

### 4.3 跨库合并与时间排序

对每个候选 `username`：
1. 计算 `table = Msg_<md5(username)>`，在 `message_0.db` / `message_1.db` 的「该库实有 `Msg_*` 表集合」里筛出**含此表的库**（`sources`）。
2. 若 `sources` 为空 **MUST** 跳过该 `username`（它只是个联系人/会话条目，没有消息表）。
3. 对每个 source 库执行 §3.2 的 `SELECT ... ORDER BY sort_seq`，逐行解码（§3.3）+ 提取（§3.6）+ 解析发送人（§4.2），收集到 `collected[]`。
4. 合并后 **MUST** 再做一次稳定排序 `collected.sort((a,b) => a.time - b.time)`（按 `create_time` 升序），保证跨库后时间单调。
5. 若 `collected` 为空 **MUST** 跳过（不产生空会话）。

### 4.4 候选会话集合

候选 `username` 集合 **MUST** 为 `contact.db` 联系人键 ∪ `session.db` 会话键的并集：

```ts
const usernames = new Set([...contactMap.keys(), ...sessionMap.keys()])
```
（这样既覆盖有联系人记录的对话，也覆盖只在会话表里出现的对话；最终是否产出仍取决于是否存在对应 `Msg_*` 表且有消息。）

### 4.5 `session.db` → 会话摘要

**MUST**（容错）读取 `SessionTable`：

```sql
SELECT username, summary, last_timestamp FROM SessionTable
```
- `summary` **MUST** 经 `decodeContent` 解码（它可能也是压缩/二进制）。
- 建 `username → { summary, lastTime }` 映射，供写 `conversations.summary`（见 §5.1）。摘要 **MUST** 仅作为元数据，**不**参与消息计数。

### 4.6 机主身份

- 机主自己的 `username` **MUST** 通过含子串 `{{机主标识}}` 识别。真实 wxid / 显示名**不入仓库**——前端经环境变量 `VITE_OWNER_WXID` / `VITE_OWNER_NAME`（写在项目根 gitignored 的 `.env.local`）注入，仓库内只留中性占位（见 [`08_frontend.md`](./08_frontend.md)）。
- 解析阶段**不强制**标注机主到每条消息；机主判定主要供前端把「我」的气泡靠右、染金色（见 [`08_frontend.md`](./08_frontend.md) / 前端规格）。复刻 **MAY** 在解析阶段额外落一个机主标记字段，但**当前实现未落**——保持一致即可。

---

## 5. 输出产物

### 5.1 `data/wechat.db`（明文 SQLite，三张表）

解析器 **MUST** 用如下精确 DDL 重建（含一个消息索引）：

```sql
PRAGMA journal_mode=WAL;

CREATE TABLE contacts(
  account TEXT, username TEXT, display TEXT,
  nick TEXT, remark TEXT, alias TEXT, is_group INTEGER
);

CREATE TABLE conversations(
  id TEXT PRIMARY KEY, account TEXT, username TEXT, display TEXT, is_group INTEGER,
  msg_count INTEGER, text_count INTEGER, first_time INTEGER, last_time INTEGER, summary TEXT
);

CREATE TABLE messages(
  conv_id TEXT, seq INTEGER, time INTEGER, sender TEXT, sender_name TEXT,
  type INTEGER, type_label TEXT, text TEXT
);

CREATE INDEX idx_msg_conv ON messages(conv_id, time);
```

字段语义与填值规则：

**`conversations`**（每会话一行）
- `id` **MUST** = `wx:<account>:<username>`（全局唯一会话 ID，前端/服务端据此取消息）。
- `account` = 账号目录名 `<account>`。
- `username` = 对端标识（私聊 wxid / 群 `*@chatroom`）。
- `display` = §4.1 显示名。
- `is_group` = `username.endsWith('@chatroom') ? 1 : 0`。
- `msg_count` = `collected.length`（**所有**类型消息计数，含图片/系统等）。
- `text_count` = 其中 `type===1 && text` 非空的条数（**纯文本**计数）。
- `first_time` / `last_time` = `collected` 排序后首/末条 `time`（unix 秒）。
- `summary` = §4.5 的会话摘要（无则空串）。

**`messages`**（每消息一行）
- `conv_id` = 上面的会话 `id`。
- `seq` = 0 起递增的会话内序号（按 §4.3 排序后顺序赋值）。
- `time` = `create_time`（unix 秒）。
- `sender` = `senderUser`（解析出的发送人 username，可能为空）。
- `sender_name` = 发送人显示名（`dispName(senderUser)`，回落 `senderUser`）。
- `type` = `local_type` 原始数值。
- `type_label` = §3.4 标签。
- `text` = §3.6 人类可读文本。

**`contacts`**（每联系人/群一行）
- 列：`account, username, display, nick, remark, alias, is_group`，取值见 §4.1。

写入约束：
- 三张表 **MUST** 用预编译 `prepare(...).run(...)` 批量插入。
- 每个账号的会话插入 **MUST** 包在事务里（`out.exec('BEGIN')` … `out.exec('COMMIT')`），以保证性能与原子性。
- 完成后 **MUST** `out.close()`，并 `close()` 所有打开的源库句柄（`contactDb` / `sessionDb` / 各 `Msg_*` 来源库）。

### 5.2 `data/wechat/index.json`（会话索引）

**MUST** 写一个 JSON，结构：

```json
{
  "generatedAt": "<ISO 时间>",
  "totalConversations": <number>,
  "totalMessages": <number>,
  "conversations": [
    {
      "id": "wx:<account>:<username>",
      "account": "<account>",
      "username": "<username>",
      "display": "<显示名>",
      "isGroup": <boolean>,
      "msgCount": <number>,
      "textCount": <number>,
      "firstTime": <unix 秒>,
      "lastTime": <unix 秒>,
      "summary": "<摘要前 120 字>"
    }
  ]
}
```
- `conversations` 数组 **MUST** 按 `lastTime` **倒序**（最近活跃在前）。
- 每条 `summary` **MUST** 截断到 120 字（`summary.slice(0, 120)`）。
- 该索引主要供概览/调试；前端会话列表实际走服务端实时读 `data/wechat.db`（见服务端/前端分册）。

### 5.3 `work/chat-text/*.txt`（逐字记录，供提炼）

**仅**对 `text_count >= 5` 的「有实质文本内容」的会话产出（**MUST** 用该阈值过滤，避免给纯媒体/系统会话生成垃圾文件）：

- 文件名 **MUST** = `safeFile(\`${display}__${username}\`) + '.txt'`，其中 `safeFile(name)` **MUST** 为 `name.replace(/[<>:"/\\|?* -]/g, '_').slice(0, 80)`（清非法文件名字符、含空格与连字符，截 80 字）。
- 内容 **MUST** 为：
  - 头部：
    ```
    # <display>（群聊）            ← 群聊才加「（群聊）」
    username: <username>
    messages: <总数> (text <文本数>)

    ```
  - 正文：对**有 `text` 的**消息逐行 `\`[<YYYY-MM-DD HH:MM>] <who>: <text>\``。
    - 时间 **MUST** 为 `new Date(time*1000).toISOString().slice(0,16).replace('T',' ')`（即 `YYYY-MM-DD HH:MM`，UTC）。
    - `who` **MUST** = `senderName || sender || (isGroup ? '群成员' : display)`。
- 编码 **MUST** 为 `utf8`。

> 这些 `.txt` 是 [`06_insights.md`](./06_insights.md) 提炼管线（digest → 扇出 agent）的上游输入；其稳定的文件名与格式是契约的一部分。

### 5.4 控制台汇总

运行结束 **MUST** 打印：会话数、消息数（千分位）、三个产物的相对路径，便于核对规模锚点（§0）。

---

## 6. 时间戳约定

- 所有 `*_time` / `time` / `firstTime` / `lastTime` **MUST** 是 **unix 秒**（非毫秒）。
- 渲染为可读串时 **MUST** 乘 1000 再 `new Date(...)`（见 §5.3）。
- 解析器**不**做时区归一，逐字记录用 `toISOString()`（UTC）；前端展示时区策略另见前端分册。复刻 **MUST** 保持解析层用 UTC、不在此处本地化。

---

## 7. 验证与自检

复刻完成后 **SHOULD** 用 Python 侧独立核对（不依赖 Node，交叉验证），例如：

```bash
python -X utf8 -c "import sqlite3,collections,os; \
db=sqlite3.connect('data/wechat.db'); c=db.cursor(); \
print('conversations', c.execute('select count(*) from conversations').fetchone()[0]); \
print('messages', c.execute('select count(*) from messages').fetchone()[0]); \
print('text', c.execute('select count(*) from messages where type=1 and text<>\"\"').fetchone()[0])"
```

期望量级（本项目实测，复刻数字随机主数据变化）：
- `conversations` ≈ **980**
- `messages` ≈ **738,511**
- 文本消息（`type=1` 非空）≈ **427,803**

排查指引：
- 若**消息为 0** → 多半是 `Msg_*` 表名 md5 没用 UTF-8、或没枚举 `sqlite_master` 实有表；先确认 `message_0.db` 里确有 `Msg_%` 表。
- 若**正文乱码** → 漏判 zstd 魔数（§3.3），把压缩字节当成了 UTF-8。
- 若**群消息发送人全空** → `name2id` 列名走错分支（§4.2），或群前缀正则不匹配（§3.5）。
- 若**显示名全是 wxid** → `contact.db` 没读到 / 显示名优先级写反（应 `remark||nick_name||alias||username`）。

---

## 8. 安全与边界

- 解析器 **MUST** 全程只读解密副本，**MUST NOT** 写回、移动或删除任何原始微信库或机主存储。
- 产物 `data/`、`work/chat-text/` 属本地敏感数据，**MUST** 在 `.gitignore` 内，**MUST NOT** 上传。
- 本解析器**只处理微信**。QQ 聊天正文（`nt_msg.db`，自定义 `QQ_NT DB` 格式）**未在本规格范围内解密**，原因与边界见 [`10_data-products-and-boundaries.md`](./10_data-products-and-boundaries.md)；QQ 的**明文附件**由归档管线处理，见 [`05_archiving.md`](./05_archiving.md)。
- 微信 `.dat` 加密图（本项目 69,820 个）**不**在解析/归档范围（需单独图片密钥），留作增强，记录于边界分册。

---

## 9. 复刻检查清单（Definition of Done）

- [ ] 仅读取 `work/decrypted/wechat/<account>/db_storage/...`，原库零写入。
- [ ] 账号发现以 `db_storage/` 存在为准；缺库优雅降级。
- [ ] `Msg_<md5(utf8(username))>` 表名；枚举 `sqlite_master` 实有表后再查。
- [ ] `message_content` BLOB 先判 zstd 魔数 `28 b5 2f fd` 再 `zstdDecompressSync`，否则 utf8。
- [ ] `local_type` 映射与 `extractText` 各分支与 §3.4/§3.6 完全一致（含系统消息 300 字截断、应用消息 ` — ` 拼装、群前缀剥离）。
- [ ] 发送人解析优先级：群前缀 → `name2id` → 空。
- [ ] 显示名 = `remark||nick_name||alias||username`。
- [ ] 跨 `message_0/1.db` 合并并按 `create_time` 升序；空会话不产出。
- [ ] `data/wechat.db` 三表 DDL + `idx_msg_conv` 索引，字段填值如 §5.1；事务批插。
- [ ] `data/wechat/index.json` 按 `lastTime` 倒序、`summary` 截 120。
- [ ] `work/chat-text/*.txt` 仅 `text_count>=5`，文件名 `safeFile`、头部+逐行格式如 §5.3。
- [ ] Python 交叉核对量级符合 §7。
