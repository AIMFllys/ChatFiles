export type InsightNugget = {
  category: string
  title: string
  content: string
  people?: string[]
  date?: string
  importance?: number
}

export type InsightConversation = {
  convId: string
  name: string
  isGroup: boolean
  summary: string
  topics: string[]
  keyPeople: string[]
  nuggets: InsightNugget[]
}

export type InsightState = {
  convId: string
  analyzedTextCount: number
  analyzedLastTime: number
  analyzedAt: string
}

export type CurrentInsightConversation = {
  id: string
  display: string
  isGroup: boolean
  textCount: number
  firstTime: number
  lastTime: number
}

export type InsightMessage = {
  time: number
  senderName: string
  text: string
}

type ReconcileInput = {
  current: CurrentInsightConversation[]
  legacy: InsightConversation[]
  states: InsightState[]
}

function conversationUsername(convId: string) {
  const parts = convId.split(':')
  if (parts.length < 3 || parts[0] !== 'wx' || !parts[1] || !parts[2]) {
    throw new Error(`Invalid WeChat conversation id: ${convId}`)
  }
  return parts.slice(2).join(':')
}

function groupByUsername<T>(items: T[], id: (item: T) => string) {
  const grouped = new Map<string, T[]>()
  for (const item of items) {
    const username = conversationUsername(id(item))
    const matches = grouped.get(username) ?? []
    matches.push(item)
    grouped.set(username, matches)
  }
  return grouped
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))]
}

function nuggetKey(nugget: InsightNugget) {
  return `${nugget.title.trim()}|${nugget.content.trim()}`
}

function preferredState(states: InsightState[]) {
  return [...states].sort(
    (a, b) =>
      b.analyzedLastTime - a.analyzedLastTime ||
      b.analyzedTextCount - a.analyzedTextCount ||
      b.analyzedAt.localeCompare(a.analyzedAt),
  )[0]
}

export function reconcileLegacyInsights(input: ReconcileInput) {
  const currentByUsername = groupByUsername(input.current, (conversation) => conversation.id)
  for (const [username, matches] of currentByUsername) {
    if (matches.length !== 1) {
      throw new Error(`Current conversation username is ambiguous: ${username}`)
    }
  }

  const legacyByUsername = groupByUsername(input.legacy, (conversation) => conversation.convId)
  const statesByUsername = groupByUsername(input.states, (state) => state.convId)
  const conversations: InsightConversation[] = []
  const states: InsightState[] = []
  let canonicalNuggets = 0

  for (const current of input.current) {
    const username = conversationUsername(current.id)
    const legacyMatches = legacyByUsername.get(username) ?? []
    if (legacyMatches.length === 0) continue

    const state = preferredState(statesByUsername.get(username) ?? [])
    const preferred = legacyMatches.find((conversation) => conversation.convId === state?.convId)
      ?? legacyMatches[0]!
    const ordered = [preferred, ...legacyMatches.filter((conversation) => conversation !== preferred)]
    const seenNuggets = new Set<string>()
    const nuggets: InsightNugget[] = []
    for (const conversation of ordered) {
      for (const nugget of conversation.nuggets ?? []) {
        const key = nuggetKey(nugget)
        if (seenNuggets.has(key)) continue
        seenNuggets.add(key)
        nuggets.push(nugget)
      }
    }

    canonicalNuggets += nuggets.length
    conversations.push({
      convId: current.id,
      name: current.display,
      isGroup: current.isGroup,
      summary: preferred.summary,
      topics: uniqueStrings(ordered.flatMap((conversation) => conversation.topics ?? [])),
      keyPeople: uniqueStrings(ordered.flatMap((conversation) => conversation.keyPeople ?? [])),
      nuggets,
    })
    if (state) states.push({ ...state, convId: current.id })
  }

  const legacyNuggets = input.legacy.reduce(
    (sum, conversation) => sum + (conversation.nuggets?.length ?? 0),
    0,
  )

  return {
    conversations,
    states,
    metrics: {
      legacyFiles: input.legacy.length,
      legacyConversationKeys: legacyByUsername.size,
      canonicalConversations: conversations.length,
      mergedAliasFiles: input.legacy.length - legacyByUsername.size,
      legacyNuggets,
      canonicalNuggets,
      duplicateNuggetsRemoved: legacyNuggets - canonicalNuggets,
    },
  }
}

export function planInsightDelta(
  conversations: CurrentInsightConversation[],
  states: InsightState[],
  minimumGrowth: number,
) {
  const stateById = new Map(states.map((state) => [state.convId, state]))
  const entries: Array<{
    conversation: CurrentInsightConversation
    kind: 'new' | 'grown'
    since: number
    previousTextCount: number
  }> = []
  const metrics = { new: 0, grown: 0, accumulated: 0, unchanged: 0 }

  for (const conversation of conversations) {
    const state = stateById.get(conversation.id)
    if (!state) {
      entries.push({ conversation, kind: 'new', since: 0, previousTextCount: 0 })
      metrics.new++
      continue
    }

    const growth = conversation.textCount - state.analyzedTextCount
    if (growth >= minimumGrowth) {
      entries.push({
        conversation,
        kind: 'grown',
        since: state.analyzedLastTime,
        previousTextCount: state.analyzedTextCount,
      })
      metrics.grown++
    } else if (growth > 0) {
      metrics.accumulated++
    } else {
      metrics.unchanged++
    }
  }

  return { entries, metrics }
}

const categoryRules: Array<{ category: string; pattern: RegExp }> = [
  { category: 'AI', pattern: /\b(?:AI|GPT|Claude|Gemini|DeepSeek|Codex|Agent|Skills?)\b|模型|人工智能/iu },
  { category: '比赛', pattern: /比赛|竞赛|答辩|大创|国创|锦兰杯|正大杯/iu },
  { category: '创业', pattern: /创业|项目|商业|变现|定价|客户|交付/iu },
  { category: '学业', pattern: /课程|考试|期末|论文|科研|六级|作业|组会/iu },
  { category: '专业', pattern: /医学|临床|基础医学|病理|生理|解剖/iu },
  { category: '资源工具', pattern: /工具|教程|软件|飞书|Obsidian|剪辑|服务器/iu },
  { category: '技术', pattern: /代码|编程|Python|API|部署|GitHub|数据库|DNS/iu },
  { category: '健康', pattern: /健康|感冒|体测|BMI|肺活量|减脂|睡眠/iu },
  { category: '财务', pattern: /价格|收费|成本|预算|赚钱|付款|报销/iu },
  { category: '生活', pattern: /旅游|宿舍|租房|吃饭|民宿|生活/iu },
  { category: '哲理', pattern: /感悟|人生|关系|社交|内耗|复盘|成长/iu },
]

function truncateCodePoints(value: string, limit: number) {
  const points = Array.from(value)
  return points.length <= limit ? value : `${points.slice(0, Math.max(0, limit - 1)).join('')}…`
}

function isDistillableMessage(message: InsightMessage) {
  const text = message.text.replace(/\s+/gu, ' ').trim()
  if (Array.from(text).length < 12) return false
  if (/^(?:收到|好的|谢谢|嗯嗯|哈哈|没问题|好滴|OK|okk)[!！。.]?$/iu.test(text)) return false
  if (/^https?:\/\/\S+$/iu.test(text)) return false
  if (/我通过了你的朋友验证/iu.test(text)) return false
  return true
}

function categoryFor(text: string) {
  return categoryRules.find((rule) => rule.pattern.test(text))?.category ?? '其他'
}

function messageScore(message: InsightMessage) {
  const length = Array.from(message.text).length
  let score = Math.min(length, 180)
  if (/建议|方法|注意|经验|原理|总结|复盘|决定|计划|需要/iu.test(message.text)) score += 60
  if (categoryFor(message.text) !== '其他') score += 30
  return score
}

function insightTitle(text: string) {
  const clean = text
    .replace(/https?:\/\/\S+/giu, '')
    .replace(/\s+/gu, ' ')
    .trim()
  const phrase = clean.split(/[，。！？；\n]/u).find(Boolean) ?? clean
  return truncateCodePoints(phrase || '本轮新增记录', 24)
}

export function distillInsightMessages(input: {
  conversation: CurrentInsightConversation
  kind: 'new' | 'grown'
  existing?: InsightConversation
  messages: InsightMessage[]
}) {
  const base: InsightConversation = input.existing
    ? {
        ...input.existing,
        convId: input.conversation.id,
        name: input.conversation.display,
        isGroup: input.conversation.isGroup,
        topics: [...(input.existing.topics ?? [])],
        keyPeople: [...(input.existing.keyPeople ?? [])],
        nuggets: [...(input.existing.nuggets ?? [])],
      }
    : {
        convId: input.conversation.id,
        name: input.conversation.display,
        isGroup: input.conversation.isGroup,
        summary: '',
        topics: [],
        keyPeople: [],
        nuggets: [],
      }
  const selected = input.messages
    .filter(isDistillableMessage)
    .map((message) => ({ message, score: messageScore(message) }))
    .sort((a, b) => b.score - a.score || a.message.time - b.message.time)
    .slice(0, 5)
  const seen = new Set(base.nuggets.map(nuggetKey))
  let addedNuggets = 0

  for (const { message, score } of selected) {
    const normalized = message.text.replace(/\s+/gu, ' ').trim()
    const nugget: InsightNugget = {
      category: categoryFor(normalized),
      title: insightTitle(normalized),
      content: truncateCodePoints(normalized, 140),
      people: message.senderName ? [message.senderName] : [],
      date: new Date(message.time * 1000).toISOString().slice(0, 7),
      importance: Math.max(1, Math.min(5, Math.round(score / 50))),
    }
    const key = nuggetKey(nugget)
    if (seen.has(key)) continue
    seen.add(key)
    base.nuggets.push(nugget)
    addedNuggets++
  }

  base.topics = uniqueStrings([
    ...base.topics,
    ...selected.map(({ message }) => categoryFor(message.text)),
  ])
  base.keyPeople = uniqueStrings([
    ...base.keyPeople,
    ...selected.map(({ message }) => message.senderName).filter(Boolean),
  ])
  if (input.kind === 'new') {
    const times = input.messages.map((message) => message.time).filter((time) => Number.isFinite(time))
    const firstTime = times.length > 0 ? Math.min(...times) : input.conversation.firstTime
    const lastTime = times.length > 0 ? Math.max(...times) : input.conversation.lastTime
    const first = new Date(firstTime * 1000).toISOString().slice(0, 10)
    const last = new Date(lastTime * 1000).toISOString().slice(0, 10)
    base.summary = `${input.conversation.display}${input.conversation.isGroup ? '群聊' : '私聊'}，覆盖 ${first} 至 ${last}，本轮提炼 ${addedNuggets} 条长期价值记录。`
  }
  return { conversation: base, addedNuggets }
}

export function formatInsightDigest(
  conversation: CurrentInsightConversation,
  kind: 'new' | 'grown',
  messages: InsightMessage[],
  cap = 52_000,
) {
  const header = [
    `会话：${conversation.display}${conversation.isGroup ? '（群聊）' : '（私聊）'}`,
    `${kind === 'new' ? '全量（首次提炼）' : '增量（仅本次新增的尾部消息）'} · ${messages.length} 条文本`,
    '',
  ].join('\n')
  const lines = messages.map((message) => {
    const time = new Date(message.time * 1000).toISOString().slice(0, 16).replace('T', ' ')
    const sender = truncateCodePoints(message.senderName || '某人', 18)
    const text = message.text.replace(/\s+/gu, ' ').trim()
    return `[${time}] ${sender}: ${text}`
  })
  return truncateCodePoints(`${header}${lines.join('\n')}`, cap)
}
