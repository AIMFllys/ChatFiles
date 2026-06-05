# 09 · AI 助手规格（自带模型 · 聊天 AI 解析）

> 让机主接入**任意 OpenAI 兼容接口**，在聊天板块对**单个会话的完整上下文**与 AI 对话。密钥只存浏览器、经本机代理一次性透传，**永不写盘**。本篇是该功能的完整可复刻规格。配套服务端接口见 [`07_server-api.md`](07_server-api.md)，前端集成见 [`08_frontend.md`](08_frontend.md)。

## 0. 目标与边界

- 在 **AI 板块**（配置组）配置 `Base URL / API Key / 模型 ID / 上下文阈值 / 温度`。
- 在 **聊天板块右栏**点「AI 解析」→ 弹出悬浮窗，AI 能读取**当前会话的完整逐字转写**（注入式），据此回答。
- 用户可把**上下文注入阈值**从 **1 万 token 调到 80 万 token**；当某会话实际上下文的**预估 token 超过阈值**时**必须报错**（不静默截断后照发），提示调高阈值或换更大窗口模型。
- **隐私红线**：API Key 仅存 `localStorage`；服务端代理只做一次性转发，**不落盘、不记录**；不上传任何聊天内容到我们自己的服务。

## 1. 配置模型（`src/utils/aiConfig.ts`）

```ts
interface AIConfig {
  baseURL: string      // 如 https://api.openai.com/v1
  apiKey: string       // sk-…（仅存 localStorage）
  model: string        // 如 gpt-4o-mini
  threshold: number    // 上下文注入阈值，10_000 .. 800_000
  temperature: number  // 0 .. 1.5
}
```

- 常量：`MIN_THRESHOLD = 10_000`、`MAX_THRESHOLD = 800_000`、`DEFAULT_AI_CONFIG`（baseURL 默认 `https://api.openai.com/v1`、model `gpt-4o-mini`、threshold `128_000`、temperature `0.6`）。
- 持久化键：`localStorage['chatfiles.ai.config']`。
- 函数：
  - `loadAIConfig(): AIConfig` —— 读 localStorage，与默认值浅合并；解析失败回退默认。
  - `saveAIConfig(cfg): void` —— `JSON.stringify` 写入。
  - `isConfigured(cfg): boolean` —— `baseURL && apiKey && model` 三者非空。
  - `estimateTokens(text): number` —— **保守**估算：遍历字符，CJK/兼容/全角区码点（`0x3000–0x9FFF`、`0xF900–0xFAFF`、`0xFF00–0xFFEF`）按 **1 token/字**，其余按 **3.5 字/token**；`ceil(cjk + other/3.5)`。故意高估，使阈值闸门偏保守。
  - `streamChat(cfg, messages, onDelta, signal?)` —— `POST /api/ai/chat`，逐块解析 SSE（`data:` 行、`[DONE]` 收尾、`choices[0].delta.content`），每块回调 `onDelta`；非 2xx 抛出含状态码与上游报文片段的错误。

> `streamChat` 经**本机代理**而非浏览器直连上游，目的有二：① 规避第三方接口的浏览器 **CORS** 限制；② 让密钥不必暴露在跨域请求里。代理实现见 [`07_server-api.md`](07_server-api.md)。

## 2. 服务端（`server/routes/ai.ts`，详见 07）

- `GET /api/wechat/conversation/:id/transcript?maxChars=` —— 从 `data/wechat.db` 按时间顺序构建逐行转写（`发言人: 内容`，媒体记为 `[类型]`），行数上限 `ceil(maxChars/6)+2000`、字符到 `maxChars` 截断，返回 `{ meta, text, chars, lines, truncated }`。对超大群有内存上界。
- `POST /api/ai/chat` —— body `{baseURL, apiKey, model, messages, temperature}`；缺字段返回 **400**；否则向 `${baseURL}/chat/completions` 发起 `stream:true` 请求（`Authorization: Bearer <apiKey>`），把 SSE 字节**原样回流**（`text/event-stream`）。密钥**仅本次转发**，不写盘、不日志。
- `server/index.ts` 必须 `app.use(express.json({ limit: '24mb' }))`（注入的上下文可达数 MB）并 `app.use(aiRouter)`。

## 3. AI 设置板块（`src/boards/AISettings.tsx`）

- 表单字段：Base URL、API Key（`type=password`）、模型 ID、温度（range 0–1.5）、**上下文注入阈值**（range `MIN_THRESHOLD`–`MAX_THRESHOLD`，step 10_000，显示 `toLocaleString()` tokens）。
- 「保存配置」→ 规整（trim + 阈值夹取到 `[1万,80万]`）→ `saveAIConfig` → 回传父级 `onChange`。
- 「测试连接」→ 先保存，再用 `streamChat` 发一条「回复两个字：在线」探测，成功显示回包片段、失败显示错误。
- 顶部与底部明确告知**隐私**：密钥仅存浏览器、经 `/api/ai/chat` 透传、服务端不落盘不记录。

## 4. 聊天「AI 解析」悬浮窗（`src/components/ai/AIChatDock.tsx`）

由聊天右栏 `ChatContext` 的「AI 解析」按钮（`onAnalyze`）打开，props：`convId / convName / config / onClose / onGotoSettings`。

行为：
1. **拉取上下文**：会话或阈值变化时 `GET …/transcript?maxChars=min(threshold*4, 4_000_000)`；用 `estimateTokens(text)` 估 token，存 `{text, tokens, lines, truncated}`。
2. **阈值闸门**：`over = tokens > threshold`。顶部状态条显示「注入 N 行 · 约 X tokens / 阈值 Y」；`over` 时该条标红、输入框禁用，发送被拦截并报错：`上下文 X tokens 超过阈值 Y tokens，请在 AI 设置调高阈值或改用更大窗口模型`。
3. **未配置**：`isConfigured` 为假时提示并给「前往配置 →」按钮（`onGotoSettings` 切到 AI 板块）。
4. **对话**：每次发送组装 `messages = [system, ...历史]`，其中 `system` 注入该会话全文（`你是严谨的聊天记录分析助手……===== 会话记录开始 ===== …`），调 `streamChat` 流式把增量拼到最后一条 assistant 气泡；`AbortController` 在关闭/重发时中止上一请求。
5. 切换会话时关闭并重置悬浮窗（`dockOpen=false`），避免把 A 会话的对话错配到 B 会话。

样式见 `src/styles/ai.css`（`.ai-dock` 右下角悬浮、macOS 式头、流式气泡）。

## 5. 验收

- AI 板块保存后刷新仍在（localStorage）。
- `POST /api/ai/chat` 缺字段 → 400；带 `{baseURL,apiKey,model,messages}` → 转发上游（假 key 得 401 透传即证明打通）。
- 聊天点「AI 解析」→ 悬浮窗加载转写、显示 token/阈值；当 `tokens > threshold` 时发送被拦截并报错（本项目首会话约 31.7 万 token，在默认 12.8 万阈值下正确进入 `over` 态）。
- 全程密钥不出现在任何服务端文件或日志中。

> 安全：本功能严格遵守 [`../../AGENTS.md`](../../AGENTS.md) 第 2 节红线——只读机主本地数据、密钥不落盘、不上传聊天内容到第三方以外的任何地方（上游即用户自己配置的接口）。
