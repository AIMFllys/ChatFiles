import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const source = fs.readFileSync(path.resolve(process.cwd(), 'src/boards/AISettings.tsx'), 'utf8')

test('offers explicit context-window and long-context strategy controls', () => {
  assert.match(source, /模型上下文窗口/u)
  assert.match(source, /最近窗口/u)
  assert.match(source, /结构化摘要/u)
  assert.match(source, /normalizeAIConfig/u)
})

test('configures optional embeddings while keeping keyword fallback explicit', () => {
  assert.match(source, /启用向量检索/u)
  assert.match(source, /Embedding 模型/u)
  assert.match(source, /向量维度/u)
  assert.match(source, /关键词检索始终可用/u)
})
