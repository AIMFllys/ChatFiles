import assert from 'node:assert/strict'
import test from 'node:test'
import {
  distillInsightMessages,
  formatInsightDigest,
  planInsightDelta,
  reconcileLegacyInsights,
  type CurrentInsightConversation,
  type InsightConversation,
  type InsightState,
} from './insightRefresh.js'

const current: CurrentInsightConversation = {
  id: 'wx:wxid_owner:room@chatroom',
  display: '中文测试群',
  isGroup: true,
  textCount: 42,
  firstTime: 1_700_000_000,
  lastTime: 1_700_000_500,
}

const legacy: InsightConversation[] = [
  {
    convId: 'wx:owner-short:room@chatroom',
    name: '旧群名',
    isGroup: true,
    summary: '较旧的总结',
    topics: ['旧主题'],
    keyPeople: ['甲'],
    nuggets: [
      { category: '技术', title: '共同要点', content: '同一条内容', people: ['甲'], date: '2026-06', importance: 3 },
      { category: '学业', title: '旧记录', content: '必须保留中文', people: ['甲'], date: '2026-05', importance: 2 },
    ],
  },
  {
    convId: 'wx:wxid_owner_old:room@chatroom',
    name: '中文测试群',
    isGroup: true,
    summary: '较新的总结',
    topics: ['新主题'],
    keyPeople: ['乙'],
    nuggets: [
      { category: '技术', title: '共同要点', content: '同一条内容', people: ['乙'], date: '2026-06', importance: 4 },
      { category: 'AI', title: '新记录', content: '不能丢失中文', people: ['乙'], date: '2026-06', importance: 5 },
    ],
  },
]

const states: InsightState[] = [
  { convId: legacy[0]!.convId, analyzedTextCount: 30, analyzedLastTime: 1_700_000_100, analyzedAt: 'old' },
  { convId: legacy[1]!.convId, analyzedTextCount: 40, analyzedLastTime: 1_700_000_400, analyzedAt: 'new' },
]

test('reconciles legacy account aliases into one canonical insight without losing unique nuggets', () => {
  const result = reconcileLegacyInsights({ current: [current], legacy, states })

  assert.equal(result.conversations.length, 1)
  assert.deepEqual(result.conversations[0], {
    convId: current.id,
    name: current.display,
    isGroup: true,
    summary: '较新的总结',
    topics: ['新主题', '旧主题'],
    keyPeople: ['乙', '甲'],
    nuggets: [legacy[1]!.nuggets[0], legacy[1]!.nuggets[1], legacy[0]!.nuggets[1]],
  })
  assert.deepEqual(result.states, [
    {
      convId: current.id,
      analyzedTextCount: 40,
      analyzedLastTime: 1_700_000_400,
      analyzedAt: 'new',
    },
  ])
  assert.deepEqual(result.metrics, {
    legacyFiles: 2,
    legacyConversationKeys: 1,
    canonicalConversations: 1,
    mergedAliasFiles: 1,
    legacyNuggets: 4,
    canonicalNuggets: 3,
    duplicateNuggetsRemoved: 1,
  })
})

test('plans only new and materially grown conversations while preserving small increments', () => {
  const conversations: CurrentInsightConversation[] = [
    current,
    { ...current, id: 'wx:wxid_owner:new-peer', display: '新增会话', textCount: 20 },
    { ...current, id: 'wx:wxid_owner:small-peer', display: '小增量', textCount: 42 },
    { ...current, id: 'wx:wxid_owner:same-peer', display: '未变化', textCount: 40 },
  ]
  const currentStates: InsightState[] = [
    { ...states[0]!, convId: current.id },
    { ...states[1]!, convId: 'wx:wxid_owner:small-peer' },
    { ...states[1]!, convId: 'wx:wxid_owner:same-peer' },
  ]

  const result = planInsightDelta(conversations, currentStates, 8)

  assert.deepEqual(result.entries, [
    { conversation: current, kind: 'grown', since: states[0]!.analyzedLastTime, previousTextCount: 30 },
    { conversation: conversations[1], kind: 'new', since: 0, previousTextCount: 0 },
  ])
  assert.deepEqual(result.metrics, {
    new: 1,
    grown: 1,
    accumulated: 1,
    unchanged: 1,
  })
})

test('refuses ambiguous canonical usernames instead of guessing across accounts', () => {
  assert.throws(
    () => reconcileLegacyInsights({
      current: [current, { ...current, id: 'wx:other-owner:room@chatroom' }],
      legacy,
      states,
    }),
    /ambiguous/u,
  )
})

test('distills a grown tail into bounded Chinese nuggets without replacing the existing summary', () => {
  const existing = legacy[1]!
  const longText = `我建议先用 Codex 做本地代码审计，再逐步修复问题。${'这是需要保留的中文内容。'.repeat(12)}`

  const result = distillInsightMessages({
    conversation: current,
    kind: 'grown',
    existing,
    messages: [
      { time: 1_700_000_410, senderName: '甲', text: '收到' },
      { time: 1_700_000_420, senderName: '孔德羽', text: longText },
      { time: 1_700_000_430, senderName: '乙', text: 'https://example.com' },
    ],
  })

  assert.equal(result.conversation.summary, existing.summary)
  assert.equal(result.addedNuggets, 1)
  assert.equal(result.conversation.nuggets.length, existing.nuggets.length + 1)
  assert.equal(result.conversation.nuggets.at(-1)?.category, 'AI')
  assert.equal(result.conversation.nuggets.at(-1)?.people?.[0], '孔德羽')
  assert.equal(Array.from(result.conversation.nuggets.at(-1)?.content ?? '').length <= 140, true)
  assert.match(result.conversation.nuggets.at(-1)?.content ?? '', /中文内容/u)
})

test('formats a bounded UTF-8 digest without splitting emoji or Chinese text', () => {
  const digest = formatInsightDigest(
    current,
    'new',
    [{ time: 1_700_000_420, senderName: '孔德羽', text: `中文😀${'内容'.repeat(80)}` }],
    90,
  )

  assert.match(digest, /^会话：中文测试群（群聊）/u)
  assert.match(digest, /首次提炼/u)
  assert.equal(Array.from(digest).length <= 90, true)
  assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(digest), false)
})

test('creates an evidence-bounded summary and topics for a new conversation', () => {
  const result = distillInsightMessages({
    conversation: { ...current, display: '新会话' },
    kind: 'new',
    messages: [
      { time: 1_700_000_420, senderName: '乙', text: '这次决定使用 Python 编写本地数据处理工具，并在完成后复盘。' },
    ],
  })

  assert.match(result.conversation.summary, /新会话.*2023-11-14.*1 条/u)
  assert.deepEqual(result.conversation.topics, ['资源工具'])
  assert.deepEqual(result.conversation.keyPeople, ['乙'])
})
