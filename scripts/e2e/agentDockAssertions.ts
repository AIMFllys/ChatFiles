import assert from 'node:assert/strict'
import type { Page } from 'playwright'
import { createAiAgentRouter } from '../../server/routes/aiAgent.js'

const fileId = '1'.padStart(64, '0')

export function createFixtureAgentRouter() {
  return createAiAgentRouter({
    execute: async (_request, emit) => {
      emit({ type: 'step', step: 1, label: '理解问题' })
      emit({ type: 'tool', step: 1, name: 'search_messages', status: 'running' })
      emit({ type: 'tool', step: 1, name: 'search_messages', status: 'complete' })
      emit({ type: 'citation', citation: '[消息:message-001]', kind: 'message', id: 'message-001', conversationId: 'conv-001', time: 1_999 })
      emit({ type: 'citation', citation: `[文件:${fileId}]`, kind: 'file', id: fileId, conversationId: 'conv-001', title: 'preview.html' })
      emit({ type: 'delta', content: `已找到中文证据 [消息:message-001] [文件:${fileId}]` })
      emit({ type: 'done', mode: 'agent', strategy: 'summary', evidenceCount: 2, steps: 1 })
    },
  })
}

export async function verifyAgentDock(page: Page) {
  await page.getByRole('button', { name: '聊天', exact: true }).click()
  await page.locator('.conversation-scroll').evaluate((element) => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')) })
  await page.locator('.conversation-main').filter({ hasText: '会话 001' }).click()
  await page.getByRole('button', { name: 'AI 分析会话', exact: true }).click()
  const dock = page.getByRole('dialog', { name: 'AI 解析', exact: true })
  await dock.waitFor()
  await dock.getByPlaceholder('描述你要找的内容…').fill('请查找证据')
  await dock.locator('.ai-send').click()
  await dock.getByText(/已找到中文证据/u).waitFor()
  assert.match(await dock.locator('.ai-dock-ctx').innerText(), /多步工具.*2 项证据/su)
  await dock.getByRole('button', { name: '[消息:message-001]', exact: true }).click()
  await page.locator('#timeline-message-001.is-highlighted').waitFor()
  await dock.getByRole('button', { name: `[文件:${fileId}]`, exact: true }).click()
  await page.getByRole('dialog', { name: 'preview.html', exact: true }).waitFor()
  await page.getByRole('button', { name: '关闭预览', exact: true }).click()
  await dock.getByRole('button', { name: '关闭', exact: true }).click()
}
