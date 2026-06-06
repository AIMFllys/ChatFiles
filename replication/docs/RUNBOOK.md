# RUNBOOK · 午夜书斋 / ChatFiles 逐步操作手册

手动复刻的**确切**步骤。命令以 **Windows + PowerShell** 为主（本项目环境）。`{{占位符}}` 替换成你机器/账号的真实值。

**贯穿全程的安全红线（任何一步都不得逾越）**
- **只动副本**：所有解密都写进 `work\decrypted\`，原始库只读打开。
- **原始文件一字未改**：禁止删除/移动/改写任何原始聊天记录或源文件。
- **只解密本人本地数据**：仅对当前登录账号、本机内存里的运行时密钥做恢复。
- **不上传**：聊天正文、密钥、原始库都不出本机。
- **QQ 边界如实记录**：QQ 正文 `nt_msg.db` 不可解（见 Phase 4 / Gotchas），不得用平台日志/缓存伪造成聊天正文。
- **AI 密钥不落盘**：浏览器侧密钥仅随请求转发上游，server 不写盘、不记日志。

占位符约定：

| 占位符 | 含义 | 本项目实际值（示例） |
|---|---|---|
| `{{项目目录}}` | 仓库根 | `D:\ChatFiles` |
| `{{微信数据根}}` | `xwechat_files` 目录 | `{{备份盘}}\xwechat_files`（备份，无文件锁，优先）/ `C:\Users\{{用户}}\xwechat_files`（LIVE） |
| `{{wxid}}` | 账号目录名 | 形如 `wxid_xxxx_xxxx`（你的主账号目录名） |
| `{{acct}}` | 解密输出子目录名 | 同 `{{wxid}}` 即可 |
| `{{微信主进程PID}}` | `Weixin.exe` 主进程 PID（**无** `--type=`） | 运行期才知 |
| `{{用户}}` | Windows 用户名 | `AIMFl` |

---

## Phase 0 · 前置环境

**要求**
- **Node ≥ 24**（自带 `zlib.zstdDecompressSync`，解析微信 zstd 压缩消息体必需）。
- **Python 3.14**（自带 `compression.zstd` + `sqlite3`，用于交叉核验解密结果）。
- **git**、**可联网**（拉 Go module / mingw / npm 包）。
- **ffmpeg / ffprobe 在 PATH**——语音转码（`/voice.wav`）与**媒体缩略图/视频 poster**（`/thumb`）都靠它；缺了媒体网格会回退到图标、语音不可播。
- **微信、QQ 正在运行且已登录**——内存取运行时密钥的硬前提。关掉应用 = 内存里没有 derived encKey = 无法解密。

**安装依赖**

```powershell
cd "{{项目目录}}"
# 运行时依赖
npm i express cors mime jszip react-markdown remark-gfm rehype-highlight docx-preview lucide-react read-excel-file
# 开发依赖（tsx 跑 TS 脚本 / playwright 做无头核验）
npm i -D tsx playwright
npx playwright install chromium      # check-ui.mjs 用 chromium
```

**✅ 验证断言（Phase 0）**

```powershell
# 1) Node ≥ 24 且 zstd 内建
node -e "console.log(process.version, typeof require('node:zlib').zstdDecompressSync)"
#   期望输出：v24.x.x function   ← 必须是 "function" 而不是 "undefined"

# 2) Python 3.14 + zstd + sqlite3
python -c "import sys,compression.zstd,sqlite3;print(sys.version.split()[0],'zstd-ok','sqlite-ok')"
#   期望：3.14.x zstd-ok sqlite-ok

# 3) git / 联网
git --version            # 有版本号
node -e "fetch('https://proxy.golang.org/').then(r=>console.log('net',r.status))"   # net 200/4xx 皆可，能连通即可

# 4) 两个应用都在跑
Get-Process Weixin,QQ -ErrorAction SilentlyContinue | Select Name,Id   # 两行都在

# 5) ffmpeg / ffprobe 可用（语音转码 + 媒体缩略图都需要）
ffmpeg -version | Select-Object -First 1 ; ffprobe -version | Select-Object -First 1
```

- [ ] `node -e ...` 打印 `v24+ function`
- [ ] Python 打印 `3.14.x zstd-ok sqlite-ok`
- [ ] `ffmpeg`/`ffprobe` 打印版本号
- [ ] `Weixin` 与 `QQ` 进程都存在

---

## Phase 1 · 定位数据

微信库可能被迁出默认 `C:\`（本项目前 42 个阶段就漏了 `D:\` 上的存储）。先全盘定位，再确认加密态与主进程 PID。

```powershell
# 1) 全盘搜微信数据根（xwechat_files 可能在 C: 或 D:）
Get-ChildItem -Path C:\,D:\ -Recurse -Directory -Filter xwechat_files -ErrorAction SilentlyContinue -Depth 6 |
  Select-Object FullName

# 2) 确认账号消息主库存在（673MB 量级 = 主账号）
Get-ChildItem "{{微信数据根}}\{{wxid}}\db_storage\message\message_0.db" |
  Select-Object FullName, @{n='MB';e={[math]::Round($_.Length/1MB,1)}}

# 3) 确认微信主进程 PID —— 取那个 CommandLine 里【没有】 --type= 的
Get-CimInstance Win32_Process -Filter "Name='Weixin.exe'" |
  Select-Object ProcessId, CommandLine | Format-Table -Wrap
```

主进程判别：渲染/GPU/utility 子进程命令行都含 `--type=renderer` / `--type=gpu-process` 等；**主进程没有 `--type=`**。把那个 `ProcessId` 记为 `{{微信主进程PID}}`。

**✅ 验证断言（Phase 1）**

```powershell
# message_0.db 必须是高熵随机（已加密），而不是明文 SQLite
$bytes = [System.IO.File]::ReadAllBytes("{{微信数据根}}\{{wxid}}\db_storage\message\message_0.db")[0..15]
($bytes | ForEach-Object { $_.ToString('x2') }) -join ' '
$hdr = -join ($bytes[0..14] | ForEach-Object { [char]$_ })
"header text = '$hdr'"     # 期望【不是】 'SQLite format 3'，而是随机字节（本项目首字节 2e fc b6 fe…）
```

- [ ] 找到 `{{微信数据根}}\{{wxid}}\db_storage\message\message_0.db`（数百 MB）
- [ ] 头 16 字节是高熵随机，**非** `SQLite format 3\0` → 已 SQLCipher 加密
- [ ] 唯一一个无 `--type=` 的 `Weixin.exe` PID 已记下

---

## Phase 2 · 工具链 + 解密（crackv4）

本机无 Go / 无 C 编译器，需自带工具链（解压 zip，无需管理员）。chatlog 仓库已被 DMCA 下架成空 README，但 **v0.0.31 仍在 Go module proxy / 缓存**里，复制出来打补丁本地编译。chatlog 的 `key` 命令在 WeChat 4.1.9.35 上**取不到密钥**（进程内存 struct pattern 变了，放宽也无效）——稳妥解法是自带的 `tools/crackv4/main.go`（`crackv4.exe`）：暴扫进程私有内存里每个库的 **derived encKey**（校验便宜：`macKey=PBKDF2(encKey,macSalt,2)` + page-1 HMAC，前置 熵 + AES 首块 SQLite header 预筛），再用 chatlog 的 `common.DecryptPage`（pageSize 4096，reserve 80 = IV16 + HMAC-SHA512 64，salt = 前 16 字节）解密副本。

```powershell
cd "{{项目目录}}"

# 1) 自带 Go + mingw-gcc 进 work\
#    下载 go1.26.4.windows-amd64.zip 解压到 work\go-toolchain\（得到 work\go-toolchain\go\bin\go.exe）
#    下载 WinLibs mingw-w64 zip 解压到 work\mingw64\（得到 work\mingw64\bin\gcc.exe）
$env:GOROOT  = "{{项目目录}}\work\go-toolchain\go"
$env:GOPATH  = "{{项目目录}}\work\gopath"
$env:GOCACHE = "{{项目目录}}\work\gocache"
$env:PATH    = "$env:GOROOT\bin;{{项目目录}}\work\mingw64\bin;$env:PATH"
go version    # 期望 go1.26.4

# 2) 拉 chatlog 源到 module cache（仓库下架，proxy 仍服务 v0.0.31）
$env:GOPROXY    = "https://proxy.golang.org,direct"
$env:CGO_ENABLED = "1"
$env:CC          = "{{项目目录}}\work\mingw64\bin\gcc.exe"
go install github.com/sjzar/chatlog@latest    # 触发下载源码到 work\gopath\pkg\mod
#   把 ...\sjzar\chatlog@v0.0.31 复制到 work\chatlog-build\，去掉只读：
robocopy "{{项目目录}}\work\gopath\pkg\mod\github.com\sjzar\chatlog@v0.0.31" "{{项目目录}}\work\chatlog-build" /E
attrib -R "{{项目目录}}\work\chatlog-build\*.*" /S

# 3) 打 2 个 patch（详见 02_SPEC §3.2/§3.3）：
#    (a) internal/wechat/.../detector.go：子进程判别 "--" → "--type="（否则找不到主进程）
#    (b) internal/wechat/decrypt/windows/v4_windows.go：放宽 key 内存扫描 pattern
#    然后放入 crackv4：work\chatlog-build\tools\crackv4\main.go（纯 Go 算法，见 02_SPEC §3.3）

# 4) 编译 crackv4（纯 Go，无需 CGO）
$env:CGO_ENABLED = "0"
cd "{{项目目录}}\work\chatlog-build"
go build -o ..\crackv4.exe .\tools\crackv4
cd "{{项目目录}}"

# 5) 解密（只读原库 / 写副本到 work\decrypted）
#    优先用 D:\ 备份根（无文件锁）；若用 LIVE 根，确保微信在跑
{{项目目录}}\work\crackv4.exe {{微信主进程PID}} `
  "{{微信数据根}}\{{wxid}}" `
  "{{项目目录}}\work\decrypted\wechat\{{acct}}"
```

**✅ 验证断言（Phase 2）**

```powershell
# 1) crackv4 输出：每个库都应 pages ok=N bad=0
{{项目目录}}\work\crackv4.exe {{微信主进程PID}} "{{微信数据根}}\{{wxid}}" "{{项目目录}}\work\decrypted\wechat\{{acct}}" |
  Select-String 'DONE|bad='
#   期望每行形如：[DONE] message_0.db pages ok=164000 bad=0   ← bad 必须为 0

# 2) Python 直接读解密后的真实联系人（中文可读 = 解密成功）
python -X utf8 -c "import sqlite3;p=r'{{项目目录}}\work\decrypted\wechat\{{acct}}\db_storage\contact\contact.db';print(sqlite3.connect(p).execute('select count(*) from contact').fetchone())"
#   期望：一个真实联系人数（本项目主账号 18068 量级）
```

- [ ] `go version` = go1.26.4，`crackv4.exe` 编译成功
- [ ] 每个库 `[DONE] … pages ok=N bad=0`（**bad 必须为 0**）
- [ ] Python 能从 `contact.db` 读到真实联系人数（中文不乱码）

---

## Phase 3 · 解析 → data/wechat.db

把解密后的库（zstd 压缩消息体）解开，还原 `name2id`、类型映射，落成明文 SQLite `data/wechat.db`（表 `conversations` / `messages` / `contacts`，见 02_SPEC §4）。

```powershell
cd "{{项目目录}}"
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
npx tsx scripts/parseWeChat.ts
```

**✅ 验证断言（Phase 3）**

```powershell
python -X utf8 -c "import sqlite3;c=sqlite3.connect(r'data/wechat.db');print(c.execute('select count(*) from conversations').fetchone()[0], '/', c.execute('select count(*) from messages').fetchone()[0])"
#   期望（本项目主账号）：980 / 738511
```

- [ ] `data/wechat.db` 生成，`conversations` ≈ **980**、`messages` ≈ **738511**
- [ ] 抽查一条 `messages.text`，中文正常（zstd 解压 + name2id 还原 OK）

---

## Phase 4 · 归档文件

把聊天落地的真实文档/媒体归档进 `archive/` + 索引 `data/library.json`。先在 `scripts/shared.ts` 把源根配齐：微信侧加 `{{微信数据根}}\<wxid>\msg`（真实 pdf/docx 在此），QQ 侧用 `nt_qq\nt_data`（明文附件可归档）。

```powershell
cd "{{项目目录}}"
# 在 scripts/shared.ts 的 candidateRoots/explorationRoots 里确保包含：
#   - {{微信数据根}}\{{wxid}}\msg     ← 微信真实文档（本项目：1003 pdf / 624 docx 等）
#   - %USERPROFILE%\Documents\Tencent Files\<QQ号>\nt_qq\nt_data   ← QQ 明文附件
#   注意 deniedAttachmentFile 会排除 .dat/.db/.log；.dat 聊天影像需后续 img-key 解密（延后增强）
npx tsx scripts/archiveFiles.ts
```

**✅ 验证断言（Phase 4）**

```powershell
node -e "const s=require('./data/library.json').stats;console.log('archived=',s.archived)"
#   期望：archived > 0（本项目 5907 量级）
# 按一级分类抽查（学业/比赛/AI/专业… 都应有文件）
node -e "const f=require('./data/library.json').files||require('./data/library.json');console.log('see data/library.json categories')"
```

- [ ] `data/library.json` 的 `stats.archived` > 0（本项目约 **5907**）
- [ ] 按一级分类（学业/比赛/AI/专业…）抽查，确有真实文档命中
- [ ] 原始源文件**一字未改**（归档为拷贝）

---

## Phase 5 · 提炼 + 综述

逐会话生成 digest → Workflow 扇出（每会话一个 Sonnet agent 写 nugget JSON）→ json-repair 修非法 JSON → 按类聚合 → ~13 个 Opus agent 写主题板。

```powershell
cd "{{项目目录}}"
# 1) 生成 digest + manifest
npx tsx scripts/prepChatDigests.ts        # 产出 work/chat-digest/*.txt + data/insights/_manifest.json

# 2) Workflow（ultracode）扇出 —— 关键：会话清单经 args 传入，避免 bootstrap 卡死
#    清单 [{c:convId, g:isGroup}, ...] 作为 JSON 字符串走 args；脚本里：
#      let list = args; if (typeof list === 'string') list = JSON.parse(list)
#    每会话一个 Sonnet agent：读 digest → 写 data/insights/conv/<safeConvId>.json（结构见 02_SPEC §6.2）
#    （子 agent 自己 Write 文件、只回状态，避免主上下文爆窗）

# 3) 修复 LLM 非法 JSON（Sonnet 常吐未转义 ASCII 引号；提示里改用中文「」引号可减少）
pip install json-repair
python -X utf8 -c "import glob,json,json_repair;[open(f,'w',encoding='utf-8').write(json.dumps(json_repair.loads(open(f,encoding='utf-8').read()),ensure_ascii=False,indent=2)) for f in glob.glob('data/insights/conv/*.json')]"

# 4) 按类聚合 → work/insights-cat/*.json → ~13 个 Opus agent 写 data/insights/boards/<类>.md
#    分类名带 '/' 要清洗成合法文件名（safeName）
```

**✅ 验证断言（Phase 5）**

```powershell
# nugget 总数
python -X utf8 -c "import glob,json;print(sum(len(json.load(open(f,encoding='utf-8')).get('nuggets',[])) for f in glob.glob('data/insights/conv/*.json')))"
#   期望：2338

# 所有 conv JSON 合法（无异常即通过）
python -X utf8 -c "import glob,json;[json.load(open(f,encoding='utf-8')) for f in glob.glob('data/insights/conv/*.json')];print('all-conv-json-valid')"

# 主题板数量
(Get-ChildItem 'data/insights/boards/*.md').Count    # 期望 13
```

- [ ] nugget 总数 = **2338**
- [ ] `data/insights/conv/*.json` **全部合法 JSON**（json-repair 之后）
- [ ] `data/insights/boards/` 有 **13** 个 `.md`

---

## Phase 6 · 服务端 + 前端

**服务端**（Express，每文件 < 300 行，挂载见 `server/index.ts`，含 `app.use(express.json(...))`）：
- `server/routes/wechat.ts`：`/api/wechat/conversations`、`/api/wechat/conversation/:id/messages?offset&limit&q`
- `server/routes/insights.ts`：`/api/insights`（聚合 `data/insights/conv/*.json`）+ `/api/overview`
- `server/routes/data.ts` / `files.ts` / `source-files.ts`：库 / 文件 / 源文件预览
- **AI 端点（本迭代新增，`server/routes/ai.ts`）**：
  - `GET /api/wechat/conversation/:id/transcript`：整段明文 transcript（`maxChars` 上限封顶，行数 LIMIT 由其推导，防大群爆内存）。
  - `POST /api/ai/chat`：转发到用户配置的 OpenAI 兼容端点。缺字段返回 **400**；apiKey 仅随请求转发上游、**不落盘不记日志**；流式回传，规避浏览器 CORS。
  - 在 `server/index.ts` 里 `app.use(express.json({ limit: '24mb' }))` + `app.use(aiRouter)`。

**前端**（用 **frontend-design skill**；design tokens + boards；所有文件 < 300 行）：壳/导航/路由 + file-preview 引擎 + boards（概览/聊天/文件/洞察/学业 + 本迭代新增 媒体 / AI 配置）。

**✅ 验证断言（Phase 6）**

```powershell
# 4 个 wechat/insight 端点都已注册
Select-String -Path server\routes\wechat.ts,server\routes\insights.ts -Pattern "router\.(get|post)\('(/api/[^']+)'" |
  ForEach-Object { $_.Matches.Groups[2].Value }
#   期望含：/api/wechat/conversations  /api/wechat/conversation/:id/messages  /api/insights  /api/overview

# AI 端点 + express.json 已接好
Select-String -Path server\routes\ai.ts -Pattern "/api/wechat/conversation/:id/transcript|/api/ai/chat"  # 两个都在
Select-String -Path server\index.ts -Pattern "express.json|aiRouter"                                      # 两个都在
```

- [ ] `wechat.ts` / `insights.ts` 注册了那 4 个端点
- [ ] `ai.ts` 有 `/transcript` + `POST /api/ai/chat`；`index.ts` 有 `express.json` 与 `aiRouter`
- [ ] 服务端/前端文件均 < 300 行

---

## Phase 7 · build + run + 端到端核验

```powershell
cd "{{项目目录}}"
npm run build      # tsc -b && vite build，必须 exit 0
$LASTEXITCODE      # 期望 0

npm start          # tsx server/index.ts → 控制台打印 "ChatFiles running at http://127.0.0.1:3456"
```

另开一个 PowerShell 做端到端断言（保持上面的 `npm start` 在跑）：

```powershell
# /api/overview：真实会话/消息/文件/洞察数
(Invoke-WebRequest 'http://127.0.0.1:3456/api/overview' -UseBasicParsing).Content
# /api/insights：convCount / nuggetCount / 13 boards
(Invoke-WebRequest 'http://127.0.0.1:3456/api/insights' -UseBasicParsing).Content
# 首页 200
(Invoke-WebRequest 'http://127.0.0.1:3456/' -UseBasicParsing).StatusCode      # 期望 200
```

浏览器打开 **http://127.0.0.1:3456**，逐板块点检：聊天能选会话看真实气泡；文件树渲染多格式；洞察有 nugget 卡 + 13 主题板。

- [ ] `npm run build` 退出码 0
- [ ] `npm start` 打印 `ChatFiles running at http://127.0.0.1:3456`
- [ ] `/api/overview`、`/api/insights` 返回真实数；`/` 返回 200
- [ ] 浏览器五板块可用，主题板能打开

---

## Phase 8 · 新功能自检（本迭代）

本迭代新增交互必须逐项过。优先无头核验：`node work/check-ui.mjs`（需服务在 :3456 运行 + 已 `npx playwright install chromium`）。

**逐项要点**
1. **独立面板滚动**：总结/文件/知识三类侧栏各自独立滚动，不随主区一起滚走（`.summary-layout` 等 shell 自带 `overflow:auto` + 固定高度）。
2. **媒体网格懒挂载**：`媒体` 板不一次性挂 5,907 张；首屏只挂少量卡片，靠 `.lazy-sentinel` 滚动续挂。
3. **左导航 2 组**：`.left-rail` 有 **2** 个 `.rail-nav` 分组——「成果」（含 媒体）与「配置」（含 AI）。
4. **AI 配置入 localStorage**：`AI` 板填的 baseURL/apiKey/model 保存到 `localStorage`（刷新仍在）。
5. **聊天「AI 解析」浮动 dock**：在 `聊天` 点 `.ai-analyze` → 弹出 `.ai-dock`，加载 transcript，`.ai-dock-ctx` 显示 token 数 vs 阈值；当 context > 阈值时报错（不发请求）。
6. **`POST /api/ai/chat` 接线**：缺字段 → **400**；带假 key → 透传上游 **401**（证明真转发了，而非本地伪造）。

```powershell
# 无头 UI 核验（服务需在跑）
node work/check-ui.mjs
#   期望大致：
#     rail buttons: 13 (expect 13) · nav groups: 2 (expect 2)
#     AI board: .ai-settings=1 inputs>=2
#     Media: cards mounted=<少量，远小于 5907> sentinel=1
#     Summary shell overflow/height: auto / <非 0 高度>
#     Chat: AI解析 button present=1
#     AI dock: present=1 ctx="…tokens… / …阈值…"
#     CONSOLE ERRORS: NONE

# POST /api/ai/chat 缺字段 → 400
try { Invoke-WebRequest 'http://127.0.0.1:3456/api/ai/chat' -Method POST -ContentType 'application/json' -Body '{}' -UseBasicParsing }
catch { "status = $($_.Exception.Response.StatusCode.value__)" }   # 期望 400

# POST /api/ai/chat 带假 key → 转发上游，上游 401（证明已接线）
$body = @{ baseURL='https://api.openai.com/v1'; apiKey='sk-FAKE'; model='gpt-4o-mini'; messages=@(@{role='user';content='hi'}) } | ConvertTo-Json
try { Invoke-WebRequest 'http://127.0.0.1:3456/api/ai/chat' -Method POST -ContentType 'application/json' -Body $body -UseBasicParsing }
catch { "status = $($_.Exception.Response.StatusCode.value__)" }   # 期望 401（上游拒假 key = 接线正确）

# transcript 端点返回 token/字符上限信息
(Invoke-WebRequest 'http://127.0.0.1:3456/api/wechat/conversation/{{某会话ID}}/transcript?maxChars=200000' -UseBasicParsing).Content
#   期望 JSON 含 meta / text / chars / truncated
```

- [ ] `node work/check-ui.mjs`：13 rail buttons、2 nav groups、`.ai-settings` 存在、媒体卡片数远小于 5907 且有 `.lazy-sentinel`、Summary shell `overflow:auto`、AI 解析按钮存在、`.ai-dock` 弹出并显示 token vs 阈值、**CONSOLE ERRORS: NONE**
- [ ] AI 配置刷新后仍在 `localStorage`
- [ ] `POST /api/ai/chat` 缺字段 → **400**；带假 key → 上游 **401**
- [ ] context > 阈值时 dock 报错、不发请求

---

## 陷阱速查（本项目踩过的坑）

| 坑 | 现象 | 解法 |
|---|---|---|
| 微信库被迁走 | `C:\…\xwechat_files` 空 | 全盘搜 `xwechat_files`（本项目在 `D:\{{微信迁移目录}}\…`）；优先对备份根解密（无文件锁） |
| chatlog 找不到微信进程 | "wechat process not found" | patch `detector.go`：子进程判别 `--` → `--type=` |
| chatlog v4 取不到密钥 | "no valid key found"（4.1.9.35） | 改用 `crackv4` 扫内存取 **derived encKey** |
| 内存暴扫太慢 | 原始密钥 256000 轮 KDF | 找**派生** encKey，校验只 **2** 轮 KDF（macKey=PBKDF2(encKey,macSalt,2)）+ 熵/AES 首块预筛 |
| workflow bootstrap 卡死 | schema 返回几百条不返回 | 会话清单经 **args** 传入，脚本 `JSON.parse` |
| args 是字符串 | `args.map is not a function` | `if (typeof args==='string') args=JSON.parse(args)` |
| 洞察 JSON 大量非法 | `Expecting ',' delimiter`（未转义 ASCII 引号） | `json-repair` 修复回写；提示里改用中文「」引号 |
| 分类名带 `/` | 写 `boards/<类>.md` 报路径错 | 文件名清洗 `/`（safeName） |
| 主上下文爆窗 | 子 agent 回传大量内容 | 子 agent 自己 Write 文件、只回状态 |
| 文件超 300 行 | 架构混乱难维护 | 按职责拆分：组件/路由/工具/类型各独立文件 |
| `.dat` 聊天影像无法直接归档 | `deniedAttachmentFile` 排除 .dat | 需 chatlog img-key 解密（延后增强），不要伪造 |
| 媒体板一次挂 5,907 张 | 首屏卡死/内存暴涨 | 懒挂载 `.lazy-sentinel` 滚动续挂 |
| 侧栏跟着主区滚走 | 看不到总结/文件/知识栏 | 各 shell 自带 `overflow:auto` + 固定高度独立滚动 |
| AI 密钥落盘风险 | 怕密钥写进日志/文件 | server 只随请求转发上游、不写盘不记日志；浏览器存 `localStorage` |
| QQ 正文不可解 | `nt_msg.db` 自定义 `QQ_NT DB` SQLCipher（salt 不在 0 偏移） | **如实记录边界**，不绕过、不伪造；仅归档 `nt_data` 明文附件 |

---

## 复刻验收清单

- [ ] **Phase 0**：`node -e ...` → `v24+ function`；Python 3.14 zstd/sqlite OK；微信+QQ 在跑
- [ ] **Phase 1**：定位到 `message_0.db`（数百 MB），头字节高熵（已加密）；记下无 `--type=` 的主进程 PID
- [ ] **Phase 2**：`crackv4.exe` 编译成功；每库 `pages ok=N bad=0`；Python 读到真实联系人（中文可读）
- [ ] **Phase 3**：`data/wechat.db` 有真实会话/消息（≈ **980 / 738511**，中文正常）
- [ ] **Phase 4**：`data/library.json` `stats.archived` > 0（≈ **5907**）、按一级分类；源文件一字未改
- [ ] **Phase 5**：`data/insights/conv/*.json` 全部合法、nugget 总数 = **2338**；`boards/` 有 **13** 个 `.md`
- [ ] **Phase 6**：4 个 wechat/insight 端点 + AI `/transcript` 与 `POST /api/ai/chat` 已接线；`express.json` 已挂；文件 < 300 行
- [ ] **Phase 7**：`npm run build` exit 0；`npm start` 打印 `:3456` 横幅；`/api/overview`、`/api/insights` 真实数、`/` 200；五板块可用
- [ ] **Phase 8**：`node work/check-ui.mjs` 全绿（13 buttons / 2 groups / 懒挂载 / 独立滚动 / AI dock token-vs-阈值 / CONSOLE ERRORS NONE）；`POST /api/ai/chat` 缺字段 400、假 key 401；AI 配置入 `localStorage`
- [ ] **安全红线全程守住**：只动副本、原始文件一字未改、只解密本人本地数据、不上传、QQ 边界如实记录、AI 密钥不落盘
