# 07 · 服务端 API 全量规格（Server API Surface）

> 本文穷举「午夜书斋 / ChatFiles」Express 服务端的**全部对外接口**：每个端点的方法、路径、query/body、以及**从源码逐字还原的**响应 JSON 形状。它是前端与任何外部调用方的权威契约。
>
> 服务监听 `127.0.0.1:{{PORT}}`，`PORT` 默认 **3456**（`Number(process.env.PORT ?? 3456)`）。**仅绑定回环地址**，纯本地、不对外暴露。
>
> 关键词遵循 **RFC 2119**（MUST / SHOULD / MAY …）。机器/账号相关值用 `{{占位符}}`。
>
> 交叉引用：
> - 洞察数据如何生成（被 `/api/insights`、`/api/overview` 读取）见 [`06_insights.md`](06_insights.md)。
> - 聊天数据如何解析进 `data/wechat.db` 见 [`04_parsing.md`](04_parsing.md)。
> - 前端如何消费这些端点见 [`08_frontend.md`](08_frontend.md)。
> - AI 助手对话功能（`/api/ai/chat` + transcript 端点的客户端）见 [`09_ai-assistant.md`](09_ai-assistant.md)。
> - 启停命令与端口核验见 [`../04_RUNBOOK.md`](../../04_RUNBOOK.md)。

---

## 0. 入口与中间件挂载顺序（`server/index.ts`，MUST 按此顺序）

```ts
const app = express()
app.use(cors())                                 // 1. 跨域（开发期前端 5173 → 3456）
app.use(express.json({ limit: '24mb' }))        // 2. JSON body，上限 24mb（AI 长 messages 需要）

app.use(dataRouter)        // /api/library /api/source-library /api/summary /api/knowledge
                           // /api/chat-clues /api/chat-synthesis /api/database-analysis /api/value-candidates
app.use(filesRouter)       // /api/file/:id/* + /files/:id
app.use(sourceFilesRouter) // /api/source-file/:id/* + /source-files/:id
app.use(wechatRouter)      // /api/wechat/conversations /api/wechat/conversation/:id/messages
app.use(insightsRouter)    // /api/insights /api/overview
app.use(aiRouter)          // /api/wechat/conversation/:id/transcript  POST /api/ai/chat

app.use('/docs', express.static(<root>/docs))           // 静态文档站
app.use('/replication', express.static(<root>/replication, { /* .md → text/markdown */ }))

// SPA fallback：有 dist 则服务构建产物 + index.html 兜底；否则服务 root 并重定向 /index.html
if (exists(dist)) { app.use(express.static(dist)); app.use((_q,res)=>res.sendFile(dist/index.html)) }
else { app.use(express.static(root)); app.use((_q,res)=>res.redirect('/index.html')) }

app.listen(port, '127.0.0.1', …)
```

要点（MUST）：
- `express.json({ limit: '24mb' })` 的 24mb 上限是 `POST /api/ai/chat` 携带长对话/长 transcript 所必需，复刻时 MUST NOT 调小到妨碍 AI body。
- 路由 MUST 在静态/SPA fallback **之前**挂载，否则 `/api/*` 会被 SPA `index.html` 吞掉。
- `/replication` 静态服务对 `.md` 设 `Content-Type: text/markdown; charset=utf-8`。
- 服务 MUST 绑定 `127.0.0.1`（回环），不监听公网。

约定（贯穿全文，除非另注）：
- 所有 `/api/*` 响应是 `application/json`（`res.json(...)`）。
- 文件字节下载端点（`/files/:id`、`/source-files/:id`、`*/voice.wav`）返回二进制，`Content-Type` 按 MIME 推断。
- 错误响应形如 `{ "error": "<message>" }`，HTTP 状态码见各端点。

---

## 1. `server/routes/wechat.ts` —— 聊天数据（实时读 `data/wechat.db`）

共享辅助 `wechatDb()`：若 `data/wechat.db` 不存在或打开失败返回 `null`；否则返回只读 `DatabaseSync` 句柄。**每个请求各自打开、`finally` 关闭**（无连接池）。因此 `data/wechat.db` 重建后**无需重启**即生效。

### 1.1 `GET /api/wechat/conversations`

会话列表，按 `last_time` 倒序 + 总计。

- **Query**：无。
- **DB 无时**：返回 `200`，`{ conversations: [], totals: { conversations: 0, messages: 0 } }`（注意 totals 这里是占位的两字段）。
- **正常响应**：

```jsonc
{
  "conversations": [
    {
      "id": "<主键>",
      "account": "<账号目录/wxid>",
      "username": "<对端 username 或群 id>",
      "display": "<显示名>",
      "is_group": 0,            // 1=群聊 0=私聊
      "msg_count": 1234,
      "text_count": 456,
      "first_time": 1690000000, // unix 秒
      "last_time": 1700000000,  // unix 秒（排序键，倒序）
      "summary": "<会话级总结，可空>"
    }
    // …
  ],
  "totals": {
    "conversations": 980,
    "messages": 738511,
    "textMessages": 427803
  }
}
```

- SQL：`SELECT id, account, username, display, is_group, msg_count, text_count, first_time, last_time, summary FROM conversations ORDER BY last_time DESC`；totals 来自 `SELECT count(*) … sum(msg_count) … sum(text_count) …`。

### 1.2 `GET /api/wechat/conversation/:id/messages`

某会话的分页消息（支持会话内文本模糊搜）。

- **路径参数**：`:id` = `conversations.id`。
- **Query**：
  - `limit`：每页条数，默认 `400`，**MUST ≤ 2000**（`Math.min(Number(limit ?? 400), 2000)`）。
  - `offset`：偏移，默认 `0`，下限 0（`Math.max(…, 0)`）。
  - `q`：可选文本模糊搜，`trim` 后非空则按 `text LIKE %q%` 过滤。
- **错误**：
  - DB 不存在 → `404 { "error": "wechat.db not found" }`。
  - 会话不存在（`meta` 查不到）→ `404 { "error": "conversation not found" }`。
- **正常响应**：

```jsonc
{
  "meta": { /* conversations 整行 SELECT *：id/account/username/display/is_group/msg_count/text_count/first_time/last_time/summary */ },
  "messages": [
    {
      "seq": 12,
      "time": 1690000000,        // unix 秒
      "sender": "<发送人 username>",
      "sender_name": "<发送人显示名>",
      "type": 1,                  // local_type 映射后的类型码
      "type_label": "文本",       // 类型中文标签
      "text": "<正文；非文本类可能为 [图片] 等占位>"
    }
    // …
  ],
  "offset": 0,
  "limit": 400
}
```

- 有 `q`：`SELECT … FROM messages WHERE conv_id=? AND text LIKE ? ORDER BY time LIMIT ? OFFSET ?`。
- 无 `q`：同上去掉 `AND text LIKE ?`。
- 消息按 `time` 升序（聊天气泡时序）。

---

## 2. `server/routes/insights.ts` —— 洞察 + 概览（实时读 `data/insights/` 与 `data/wechat.db`）

`loadInsights()`：读 `data/insights/conv/*.json`，逐文件 `JSON.parse`，**坏文件静默跳过**（try/catch 吞掉）。这意味着未修复的非法 JSON 会从结果中消失（见 [`06_insights.md`](06_insights.md) §4.5）。

### 2.1 `GET /api/insights`

聚合全部会话洞察 + 主题板。

- **Query**：无。
- **响应**：

```jsonc
{
  "convCount": 464,            // 成功解析的 conv/*.json 文件数
  "nuggetCount": 2338,         // 所有 nugget 总条数
  "byCategory": {
    "技术": [
      {
        "category": "技术",
        "title": "…",
        "content": "≤140字，引用用「」",
        "people": ["…"],
        "date": "YYYY-MM",      // 或 ""
        "importance": 5,
        "conv": "<会话显示名>",  // 由服务端注入：c.name
        "convId": "<会话 id>",   // 由服务端注入：c.convId
        "isGroup": true          // 由服务端注入：c.isGroup
      }
      // …本类其余 nugget，按 importance 降序
    ],
    "哲理": [ /* … */ ],
    "其他": [ /* category 缺失的 nugget 兜底进「其他」 */ ]
    // …共 ≤13 个键
  },
  "summaries": [
    {
      "convId": "<id>",
      "name": "<display>",
      "isGroup": true,
      "summary": "<会话级总结>",
      "topics": ["…"],          // 缺省 []
      "keyPeople": ["…"]        // 缺省 []
    }
    // …仅含有 summary 的会话
  ],
  "boards": {
    "技术": "<data/insights/boards/技术.md 的全文 Markdown>",
    "AI":   "<…>",
    "资源工具": "<…>"
    // …key = 去掉 .md 后缀的文件名
  }
}
```

聚合逻辑（MUST 与源码一致）：
- 每条 nugget 的 `category` 缺失时归入 `"其他"`（`String(n.category ?? '其他')`）。
- 注入 `conv`（会话名）、`convId`、`isGroup` 到每条 nugget，便于前端卡片显示来源。
- 每个 `byCategory[k]` MUST 按 `importance` 降序排序（缺省按 0）。
- `boards` 仅收 `data/insights/boards/` 下 `.md` 文件；目录不存在则 `boards = {}`。

### 2.2 `GET /api/overview`

首页总量仪表盘所需的聚合统计。

- **Query**：无。
- **响应**：

```jsonc
{
  "chat": {
    "conversations": 980,    // count(*) FROM conversations
    "messages": 738511,      // sum(msg_count)
    "textMessages": 427803,  // sum(text_count)
    "contacts": 18068        // count(*) FROM contacts
  },
  "files": {
    "archived": 5907,        // library().files.length（归档文件数）
    "indexed": 87052,        // sourceLibrary().files.length（源文件索引数）
    "bytes": 36000000000     // library().stats.bytes（归档总字节）
  },
  "insights": {
    "conversations": 464,    // loadInsights().length
    "nuggets": 2338          // Σ nuggets.length
  }
}
```

- DB 缺失时 `chat` 退化为 `{ conversations:0, messages:0, textMessages:0, contacts:0 }`（源码初值 `textMessages` 键缺省为 0，contacts 单独补）。
- `files` 来自 `data/library.json`（归档清单）与 `data/deep-index.json`（源文件深索引，经 `sourceLibrary()` 转换）。

---

## 3. `server/routes/ai.ts` —— AI 助手支撑端点（**新增**）

> 这两个端点是「AI 助手」对话功能的服务端支撑。客户端形态见 [`09_ai-assistant.md`](09_ai-assistant.md)。

### 3.1 `GET /api/wechat/conversation/:id/transcript`

把某会话渲染为**逐行明文 transcript**，用于注入到 AI 对话上下文。**有界**：靠 `maxChars` 推导行上限，确保 10 万条消息的大群也不会撑爆内存。

- **路径参数**：`:id` = `conversations.id`。
- **Query**：
  - `maxChars`：输出字符上限，默认 `1_600_000`，**MUST ≤ 4_000_000**（`Math.min(Number(maxChars ?? 1_600_000) || 1_600_000, 4_000_000)`）。
- **行上限推导（MUST，防 OOM）**：`rowCap = Math.ceil(maxChars / 6) + 2000`，SQL 用 `LIMIT rowCap`，故**永不全表加载**。
- **错误**：
  - DB 不存在 → `404 { "error": "wechat.db not found" }`。
  - 会话不存在 → `404 { "error": "conversation not found" }`。
- **渲染规则**：
  - SQL：`SELECT time,sender_name,sender,type,type_label,text FROM messages WHERE conv_id=? ORDER BY time LIMIT ?`（升序）。
  - 每行：`<发言人>: <内容>`；发言人 = `sender_name || sender || '?'`。
  - 内容：有非空 `text` 取 `text.trim()`；否则用占位 `[<type_label || '消息'>]`（媒体类如 `[图片]`/`[语音]`）。
  - 累加 `chars`，**一旦 `chars + line.length > maxChars` 立即停止**并置 `truncated = true`。
  - 若取回行数 `>= rowCap` 也置 `truncated = true`（说明被 LIMIT 截断）。
- **响应**：

```jsonc
{
  "meta": {
    "display": "<会话显示名>",
    "is_group": 0,           // 1/0
    "msg_count": 1234
  },
  "text": "羽升: 你好\n对方: 在的\n群友A: [图片]\n…",  // 以 \n 连接的 transcript
  "chars": 158234,           // text 实际字符数
  "lines": 842,              // transcript 行数
  "truncated": false         // 是否因 maxChars 或 LIMIT 被截断
}
```

### 3.2 `POST /api/ai/chat`

到**用户自配的 OpenAI 兼容端点**的**薄流式代理**。作用：① 绕过浏览器 CORS（浏览器直连第三方 LLM 常被 CORS 拦）；② 把 SSE 字节原样回传给前端。

- **Body（`application/json`，MUST 全部存在，否则 400）**：

```jsonc
{
  "baseURL": "https://api.example.com/v1",   // 上游基址（末尾斜杠会被去除）
  "apiKey":  "sk-…",                          // 仅本请求透传，见安全说明
  "model":   "gpt-4o-mini | …",               // 上游模型名
  "messages": [ { "role": "system|user|assistant", "content": "…" } ],  // MUST 是数组
  "temperature": 0.6                          // 可选，缺省 0.6
}
```

- **校验**：`baseURL`、`apiKey`、`model` 任一缺失，或 `messages` 非数组 → `400 { "error": "missing baseURL / apiKey / model / messages" }`。
- **上游请求**：
  - URL = `${baseURL.replace(/\/+$/,'')}/chat/completions`。
  - Method `POST`，Headers `content-type: application/json` + `authorization: Bearer <apiKey>`。
  - Body：`{ model, messages, temperature: temperature ?? 0.6, stream: true }`。**始终 `stream:true`**。
- **成功（流式）响应**：
  - `Content-Type: text/event-stream; charset=utf-8`，`Cache-Control: no-cache`。
  - 把上游 `ReadableStream` 逐块 `res.write(Buffer.from(value))` **原样透传**（标准 OpenAI SSE：多行 `data: {json}\n\n`，以 `data: [DONE]` 收尾），读完 `res.end()`。
- **上游错误**：上游非 2xx 或无 body → `res.status(upstream.status || 502).send(<上游响应文本或 'upstream error'>)`（透传上游状态码与正文）。
- **本地异常**：fetch 抛错且响应头未发出 → `502 { "error": "<message>" }`；若头已发出（流中途断）→ 直接 `res.end()`。

**安全（MUST，与全项目一致）**：
- `apiKey` **逐请求**从浏览器（前端通常存 localStorage）带来，**仅**在本次上游请求的 `Authorization` 头里透传。
- **MUST NOT 落盘**（不写任何文件/数据库）、**MUST NOT 记录日志**（不 `console.log` key、不打印 body）。
- 服务端只是**无状态转发器**：不持久化 key、不持久化对话内容。
- 详见 [`09_ai-assistant.md`](09_ai-assistant.md)。一句话重申：**AI 密钥不落盘、不记录；服务端只读本地数据 + 仅请求期透传 key**。

---

## 4. `server/routes/data.ts` —— 静态 JSON 数据接口（读 `data/*.json`，带回退默认值）

全部 `GET`、无 query/body。每个端点用 `readJson(path, fallback)`：文件缺失或解析失败时返回**结构完整的 fallback 默认对象**（故前端永不拿到 undefined）。

### 4.1 `GET /api/library`
归档文件清单。响应 = `data/library.json`（`LibraryManifest`）：

```jsonc
{
  "generatedAt": "ISO",
  "roots": ["<扫描源根…>"],
  "files": [
    {
      "id": "<稳定 id>", "name": "…", "ext": ".pdf", "mime": "…",
      "size": 12345, "modified": "ISO",
      "category": "学业", "subcategory": ["…"],
      "archivePath": "archive/…", "sourcePath": "<原路径>",
      "sourceApp": "微信|QQ|企业微信|未知",
      "preview": "image|video|audio|voice|pdf|docx|sheet|text|markdown|code|html|json|presentation|archive|database|font|download",
      "sha256": "…"
    }
  ],
  "stats": { "discovered": 87052, "archived": 5907, "duplicatesSkipped": 81145, "bytes": 36000000000 }
}
```
Fallback：`{ generatedAt, roots:[], files:[], stats:{discovered:0,archived:0,duplicatesSkipped:0,bytes:0} }`。

### 4.2 `GET /api/source-library`
源文件索引（由 `data/deep-index.json` 经 `sourceLibrary()` 转换，**非直接回 json 文件**）。响应 = `SourceFileManifest`：

```jsonc
{
  "generatedAt": "ISO",
  "roots": ["<exists===true 的源根绝对路径>"],
  "files": [
    {
      "id": "<sha1(path) 前 20 hex>", "name": "…", "ext": ".docx",
      "mime": "…", "size": 123, "modified": "ISO",
      "root": "<所属源根>", "relativePath": "…", "sourcePath": "<绝对路径>",
      "sourceApp": "微信|QQ|企业微信|未知", "preview": "<同上 preview 枚举>"
    }
  ],
  "stats": { "files": 87052, "bytes": …, "databaseCandidates": …, "mediaCandidates": …, "textCandidates": … }
}
```
- `id` MUST 为 `sha1(item.path).slice(0,20)`（稳定、用于 `/api/source-file/:id/*` 回查）。
- `roots` 仅含 `exists` 为真的根。

### 4.3 `GET /api/knowledge`
学业知识板数据。响应 = `data/knowledge.json`，fallback：`{ generatedAt, sourceStatus:[], coursePlan:[], sections:[] }`。

### 4.4 `GET /api/summary`
文件总结板。响应 = `data/summary.json`，fallback：

```jsonc
{ "generatedAt": "ISO",
  "coverage": { "archivedFiles":0,"archivedBytes":0,"sourceRoots":0,"directoryCount":0,
                "databaseCandidates":0,"readableDatabases":0,"textExtracts":0 },
  "boards": [], "textExtracts": [] }
```

### 4.5 `GET /api/chat-clues`
聊天线索档案（`ChatClueDossier`）。响应 = `data/chat-clue-dossier.json`，fallback：

```jsonc
{ "generatedAt":"ISO",
  "totals": { "groups":0,"snippets":0,"highValueGroups":0,"chatExportMessages":0,
              "bySourceType":{},"bySourceApp":{},"bySignal":{} },
  "groups": [] }
```

### 4.6 `GET /api/chat-synthesis`
聊天综合（`ChatSynthesis`）。响应 = `data/chat-synthesis.json`，fallback：

```jsonc
{ "generatedAt":"ISO",
  "totals": { "groups":0,"snippets":0,"highValueGroups":0,"confirmedConversations":0,
              "sourceOnlyGroups":0,"technicalGroups":0,"academicGroups":0,"philosophyGroups":0 },
  "sections": [] }
```

### 4.7 `GET /api/database-analysis`
数据库分析（`DatabaseAnalysis`）。响应 = `data/database-analysis.json`，fallback：

```jsonc
{ "generatedAt":"ISO",
  "totals": { "readableDatabases":0,"unreadableDatabases":0,"analyzedTables":0,
              "suspectedMessageTables":0,"textSamples":0 },
  "databases": [] }
```

### 4.8 `GET /api/value-candidates`
价值候选索引（`ValueCandidateIndex`）。响应 = `data/value-candidates.json`，fallback：

```jsonc
{ "generatedAt":"ISO",
  "totals": { "sourceFiles":0,"archivedFiles":0,"unarchivedFiles":0,"representedByArchive":0,
              "duplicateCandidatesSkipped":0,"candidates":0,"high":0,"medium":0,"low":0 },
  "byBucket": {}, "byPreview": {}, "candidates": [] }
```

---

## 5. `server/routes/files.ts` —— 归档文件（`archive/`）操作

`resolveFile(id)`：在 `library().files` 找 `id` 命中项；目标 = `path.resolve(root, item.archivePath)`，并 MUST 校验其在 `archive/` 根内（防目录穿越），否则 `null`。所有端点 `id` 不命中 → `404 { "error": "File not found" }`。

### 5.1 `GET /api/file/:id/text`
文本预览。仅当 `item.preview ∈ {text, markdown, code, html, json}`，否则 `415 { "error": "This file is not a text preview." }`。成功：`Content-Type: text/plain; charset=utf-8`，body 为 UTF-8 全文。

### 5.2 `GET /api/file/:id/archive`
压缩包预览（`inspectArchive`，见 §7.2）。仅当 `preview === 'archive'`，否则 `415`。响应 = `ArchivePreview`。

### 5.3 `GET /api/file/:id/voice`
语音元信息（`inspectVoice`，见 §7.3）。仅当文件名匹配 `\.(amr|silk)$`，否则 `415 { "error": "This file is not a supported voice preview." }`。响应 = `VoicePreview`，其 `transcodedUrl` 指向下一个端点。

### 5.4 `GET /api/file/:id/voice.wav`
转码后的可播放音频。条件同上；成功：`Content-Type: audio/wav`，`sendFile(<work/audio-cache/*.wav>)`（首次访问触发 ffmpeg 转码，见 §7.3）。

### 5.5 `GET /api/file/:id/inspect`
通用十六进制 / 字符串检查（`inspectFile`，见 §7.1）。无 preview 限制。响应 = `FileInspection`。

### 5.6 `GET /files/:id`
**原始字节下载/内联**。`Content-Type = mime.getType(target) ?? 'application/octet-stream'`，`sendFile(target)`。用于点开后的完整预览（`<img>`/`<video>`/`<iframe>`/PDF）。**注意**：媒体网格**不得**用本端点当缩略图（会拉原图卡死），网格一律用 §5.7 的缩略图。

### 5.7 `GET /api/file/:id/thumb?w=`
**媒体缩略图 / 视频 poster**（`server/utils/thumbs.ts`）。`w` 默认 360、夹取 `[96,512]`。按 `item.preview` 分流：`image` → `imageThumb`（ffmpeg `-vf scale='min(w,iw)':-2:flags=lanczos -c:v libwebp -quality 72` 缩成 WebP）；`video` → `videoPoster`（ffmpeg `-ss 1 -frames:v 1` 抽一帧，短片回退 `-ss 0`）；其它类型 → `415`。产物按 `sha1(kind|path|size|mtime|w)` 落盘 `work/thumb-cache/<key>.webp`（路径前缀校验防穿越），命中即直接 `sendFile`。响应 `Content-Type: image/webp` + `Cache-Control: public, max-age=31536000, immutable`；ffmpeg 失败 → `500`（前端 `<img onError>` 回退图标）。**这是媒体板块不卡的服务端支柱**（实测 9.8MB 图→~40KB、1GB 视频→~9KB poster）。前端集成见 [`08_frontend.md`](08_frontend.md) §6.1。

---

## 6. `server/routes/source-files.ts` —— 源文件（未归档原盘文件）操作

`resolveSourceFile(id)`：在 `sourceLibrary().files` 找 `id`；目标 = `path.resolve(item.sourcePath)`，MUST 落在 `manifest.roots` 某个允许根内（前缀校验防穿越），且 MUST 是存在的普通文件，否则 `null` → `404`。与归档侧对称，差异如下。

### 6.1 `GET /api/source-file/:id/text`
同 §5.1，但**额外有 5MB 上限**：`stat.size > 5*1024*1024` → `413 { "error": "Text preview is limited to 5 MB." }`（源文件可能很大）。preview 限制同样为 `{text,markdown,code,html,json}`。

### 6.2 `GET /api/source-file/:id/database`
SQLite 结构预览（`inspectSqlite`，见 §7.4）。仅当 `preview === 'database'`，否则 `415 { "error": "This file is not a database preview." }`。响应 = `DatabasePreview`。
> 注意：此端点**仅源文件侧有**，归档侧 `files.ts` 无 `/database`。

### 6.3 `GET /api/source-file/:id/archive`
同 §5.2（`inspectArchive`）。

### 6.4 `GET /api/source-file/:id/voice`
同 §5.3，`transcodedUrl` 指向 `/api/source-file/:id/voice.wav`。

### 6.5 `GET /api/source-file/:id/voice.wav`
同 §5.4。

### 6.6 `GET /api/source-file/:id/inspect`
同 §5.5（`inspectFile`）。

### 6.7 `GET /api/source-file/:id/thumb?w=`
同 §5.7，但经 `resolveSourceFile`（原盘文件）。同样 `image`/`video` 出 WebP 缩略图/poster、缓存于 `work/thumb-cache/`、强缓存头。

### 6.7 `GET /source-files/:id`
同 §5.6，原始字节，MIME 推断。

---

## 7. 预览数据结构（`server/utils/inspect.ts`、`voice.ts`）

这些是 §5/§6 预览端点的响应载荷形状（源自 `src/types`，逐字对应）。

### 7.1 `FileInspection`（`/inspect`）

```jsonc
{
  "path": "<绝对路径>", "size": 123, "modified": "ISO",
  "mime": "…", "ext": ".bin",            // 无扩展名时 "[none]"
  "headerHex": "ff d8 ff e0 …",          // 前 128 字节十六进制
  "headerAscii": "....JFIF..",           // 前 128 字节可打印 ASCII（非可打印→.）
  "sampledBytes": 2097152,               // 实采样字节（≤2MB）
  "strings": [                            // 去重后 ≤48 条可见字符串
    { "offset": 1024, "encoding": "utf8|utf16le", "text": "<≤260 字>" }
  ]
}
```
- 采样上限 2MB；分别按 utf8（≤36 条）与 utf16le（≤24 条）抽取，过滤纯 hex/路径串与高重复串，去重后切 48 条。

### 7.2 `ArchivePreview`（`/archive`）

```jsonc
{
  "path": "…", "size": 123, "modified": "ISO",
  "format": ".zip",                       // 扩展名，无则 "[none]"
  "readable": true,                       // 解析成功？
  "error": "<readable=false 时的错误信息>",
  "entries": [                            // 最多 600 条
    { "name": "a/b.txt", "size": 456, "directory": false }
  ]
}
```
- `.zip` 走 JSZip（`size` = 未压缩大小）；其它走 `tar -tf`（无 `size`，`directory` 由结尾 `/` 判定）。失败 → `readable:false`、`entries:[]`、带 `error`。

### 7.3 `VoicePreview`（`/voice`）

```jsonc
{
  "path": "…", "size": 123, "modified": "ISO",
  "sourceFormat": ".amr",                 // 或 ".silk"，无则 "[none]"
  "codecHint": "AMR narrowband | AMR wideband | QQ SILK_V3 voice payload",
  "durationSeconds": 3.2,                 // ffprobe 探测（SILK 时省略）
  "playable": true,
  "transcodedUrl": "/api/(source-)file/:id/voice.wav",  // playable 时
  "error": "<不可播放时的说明>"
}
```
- 检出 `#!SILK_V3` → `playable:false` 并给中文说明（当前环境无 SILK 解码器，保留原文件）。
- 其它格式：调 ffmpeg 转码为 16k 单声道 wav（缓存到 `work/audio-cache/<sha1>.wav`，按 path|size|mtime 做 key），成功则 `playable:true` + `transcodedUrl`；失败 `playable:false` + `error`。

### 7.4 `DatabasePreview`（`/database`，仅源文件侧）

```jsonc
{
  "path": "…", "size": 123, "modified": "ISO",
  "header": "<前 96 字节十六进制>",
  "readable": true,
  "error": "<readable=false 时>",
  "tables": [                             // 最多 80 张表（排除 sqlite_%）
    {
      "name": "Msg_xxx", "rowCount": 1234,  // count 失败时省略
      "columns": [ { "name": "local_id", "type": "INTEGER" } ]  // type 缺失→"UNKNOWN"
    }
  ]
}
```
- 用 `node:sqlite` 只读打开；列名用 `quoteIdent` 转义防注入。打不开（如加密/非 SQLite）→ `readable:false` + `error` + `tables:[]`。

---

## 8. 文档 / 静态资源端点（非 `/api`）

| 路径 | 说明 |
|------|------|
| `GET /docs/*` | 静态文档站点（`<root>/docs`）。 |
| `GET /replication/*` | 复刻文档包静态服务；`.md` 文件返回 `text/markdown; charset=utf-8`。 |
| `GET /*`（兜底） | SPA fallback：有 `dist/` 则服务构建产物并以 `dist/index.html` 兜底；否则服务 `root` 并把未命中重定向到 `/index.html`。 |

---

## 9. 路由表速查（全端点一览）

| 方法 | 路径 | 文件 | 关键 query/body | 响应概要 |
|------|------|------|-----------------|----------|
| GET | `/api/overview` | insights.ts | — | `{chat,files,insights}` 总量 |
| GET | `/api/wechat/conversations` | wechat.ts | — | `{conversations[],totals}` |
| GET | `/api/wechat/conversation/:id/messages` | wechat.ts | `offset,limit(≤2000),q` | `{meta,messages[],offset,limit}` |
| GET | `/api/wechat/conversation/:id/transcript` | **ai.ts** | `maxChars(≤4e6)` | `{meta,text,chars,lines,truncated}` |
| POST | `/api/ai/chat` | **ai.ts** | body `{baseURL,apiKey,model,messages,temperature}` | SSE 流（`text/event-stream`） |
| GET | `/api/insights` | insights.ts | — | `{convCount,nuggetCount,byCategory,summaries,boards}` |
| GET | `/api/library` | data.ts | — | `LibraryManifest` |
| GET | `/api/source-library` | data.ts | — | `SourceFileManifest` |
| GET | `/api/knowledge` | data.ts | — | knowledge.json |
| GET | `/api/summary` | data.ts | — | summary.json |
| GET | `/api/chat-clues` | data.ts | — | ChatClueDossier |
| GET | `/api/chat-synthesis` | data.ts | — | ChatSynthesis |
| GET | `/api/database-analysis` | data.ts | — | DatabaseAnalysis |
| GET | `/api/value-candidates` | data.ts | — | ValueCandidateIndex |
| GET | `/api/file/:id/text` | files.ts | — | text/plain |
| GET | `/api/file/:id/archive` | files.ts | — | ArchivePreview |
| GET | `/api/file/:id/voice` | files.ts | — | VoicePreview |
| GET | `/api/file/:id/voice.wav` | files.ts | — | audio/wav |
| GET | `/api/file/:id/inspect` | files.ts | — | FileInspection |
| GET | `/api/file/:id/thumb` | files.ts | `w` | image/webp（缩略图/poster） |
| GET | `/files/:id` | files.ts | — | 原始字节 |
| GET | `/api/source-file/:id/text` | source-files.ts | — | text/plain（≤5MB） |
| GET | `/api/source-file/:id/database` | source-files.ts | — | DatabasePreview |
| GET | `/api/source-file/:id/archive` | source-files.ts | — | ArchivePreview |
| GET | `/api/source-file/:id/voice` | source-files.ts | — | VoicePreview |
| GET | `/api/source-file/:id/voice.wav` | source-files.ts | — | audio/wav |
| GET | `/api/source-file/:id/inspect` | source-files.ts | — | FileInspection |
| GET | `/api/source-file/:id/thumb` | source-files.ts | `w` | image/webp（缩略图/poster） |
| GET | `/source-files/:id` | source-files.ts | — | 原始字节 |
| GET | `/docs/*` `/replication/*` `/*` | index.ts | — | 静态 / SPA fallback |

---

## 10. 复刻不变量（MUST）

- **实时读盘**：`/api/wechat/*`、`/api/insights`、`/api/overview` 每请求重读 `data/wechat.db` 与 `data/insights/`——重建数据 / 重跑洞察 / 修复 JSON 后**无需重启**（见 [`06_insights.md`](06_insights.md)）。
- **每请求开关 DB**：`wechatDb()` 句柄用完 `finally` 关闭，无连接池。
- **路径穿越防护**：`resolveFile`/`resolveSourceFile` MUST 校验目标落在 `archive/` 或允许的源根内。
- **预览端点的 preview 守卫**：text/archive/database/voice 端点 MUST 先校验 `item.preview` 或文件名后缀，不匹配返回 `415`。
- **AI 安全**：`POST /api/ai/chat` 的 key **MUST NOT 落盘、MUST NOT 记录**，仅请求期透传；服务端无状态。`express.json` 上限 MUST ≥ 能容纳长 messages（本项目 24mb）。
- **绑定回环**：MUST `listen(port, '127.0.0.1')`，不对公网监听。
