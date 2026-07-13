import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { Server } from 'node:http'
import { DatabaseSync } from 'node:sqlite'

import { chromium, type Browser } from 'playwright'

import { createApp } from '../../server/app.js'
import { createWechatRouter } from '../../server/routes/wechat.js'

function fixtureDatabases() {
  const artifactDb = new DatabaseSync(':memory:')
  const wechatDb = new DatabaseSync(':memory:')
  artifactDb.exec(`
    CREATE TABLE artifacts(
      asset_id TEXT PRIMARY KEY, conv_id TEXT, category TEXT, kind TEXT, name TEXT,
      preview TEXT, url TEXT, source_relative_path TEXT, source_size INTEGER,
      created_at INTEGER, sender_name TEXT, text TEXT, materialization TEXT,
      preview_status TEXT, failure_reason TEXT
    );
  `)
  wechatDb.exec(`
    CREATE TABLE conversations(
      id TEXT PRIMARY KEY, account TEXT, username TEXT, display TEXT, is_group INTEGER,
      msg_count INTEGER, text_count INTEGER, first_time INTEGER, last_time INTEGER, summary TEXT
    );
    CREATE TABLE messages(
      conv_id TEXT, message_uid TEXT PRIMARY KEY, seq INTEGER, time INTEGER,
      sender TEXT, sender_name TEXT, type INTEGER, type_label TEXT, text TEXT
    );
  `)

  const insertConversation = wechatDb.prepare('INSERT INTO conversations VALUES (?,?,?,?,?,?,?,?,?,?)')
  const insertMessage = wechatDb.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?,?)')
  for (let index = 1; index <= 120; index += 1) {
    const suffix = String(index).padStart(3, '0')
    const conversationId = `conv-${suffix}`
    const timestamp = 2_000 - index
    insertConversation.run(
      conversationId, 'fixture-account', `user-${suffix}`, `会话 ${suffix}`, index % 3 === 0 ? 1 : 0,
      1, 1, timestamp, timestamp, `测试摘要 ${suffix}`,
    )
    insertMessage.run(
      conversationId, `message-${suffix}`, 1, timestamp, `sender-${suffix}`, `发送者 ${suffix}`,
      1, 'text', `测试消息 ${suffix}`,
    )
  }

  const insertArtifact = artifactDb.prepare('INSERT INTO artifacts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  const addArtifact = (input: {
    index: number
    category: 'work' | 'document' | 'skill' | 'link'
    name: string
    preview: string
    materialization: string
    previewStatus: string
    url?: string | null
  }) => insertArtifact.run(
    input.index.toString(16).padStart(64, '0'),
    'conv-001',
    input.category,
    input.category === 'link' ? 'link' : 'resource',
    input.name,
    input.preview,
    input.url ?? null,
    null,
    null,
    3_000 - input.index,
    '测试发送者',
    '测试索引文本',
    input.materialization,
    input.previewStatus,
    input.previewStatus === 'ready' ? null : '审计失败状态',
  )
  addArtifact({ index: 1, category: 'work', name: '可预览代码.ts', preview: 'code', materialization: 'exported', previewStatus: 'ready' })
  addArtifact({ index: 2, category: 'document', name: '待解密文档.pdf', preview: 'pdf', materialization: 'decrypt_failed', previewStatus: 'decrypt_failed' })
  addArtifact({ index: 3, category: 'skill', name: 'fixture SKILL.md', preview: 'markdown', materialization: 'exported', previewStatus: 'ready' })
  addArtifact({ index: 4, category: 'link', name: '安全链接', preview: 'link', materialization: 'exported', previewStatus: 'ready', url: 'https://example.test/' })

  return { artifactDb, wechatDb }
}

async function listen(server: Server) {
  if (!server.listening) await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return `http://127.0.0.1:${address.port}`
}

async function closeServer(server: Server) {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

const { artifactDb, wechatDb } = fixtureDatabases()
const wechatRouter = createWechatRouter({
  openWechatDatabase: () => ({ db: wechatDb, release() {} }),
  openArtifactDatabase: () => ({ db: artifactDb, release() {} }),
  accountRootProvider: () => process.cwd(),
  imageThumbnail: (target) => target,
  videoThumbnail: (target) => target,
})
const server = createApp({ wechatRouter }).listen(0, '127.0.0.1')
let browser: Browser | undefined

try {
  const baseUrl = await listen(server)
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    viewport: { width: 1440, height: 900 },
  })
  const page = await context.newPage()
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '聊天', exact: true }).click()
  await page.getByRole('heading', { name: '会话 120', exact: true }).waitFor()

  assert.ok(await page.locator('.conversation-row').count() < 40)
  assert.equal(
    (await page.locator('#conversation-heading').innerText()).replace(/\s+/gu, ' ').trim(),
    '会话 120',
  )
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false)
  assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true)

  await page.locator('.conversation-scroll').evaluate((element) => {
    element.scrollTop = 3_500
    element.dispatchEvent(new Event('scroll'))
  })
  await page.waitForFunction(() => Number(document.querySelector('.conversation-row')?.getAttribute('aria-posinset')) > 30)
  assert.ok(await page.locator('.conversation-row').count() < 40)

  await page.getByRole('button', { name: '我的素材库 作品与可浏览创作', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.artifact-stats strong')?.textContent === '3')
  assert.equal(await page.locator('.artifact-card').count(), 1)
  assert.equal(await page.locator('.artifact-card[data-availability="ready"]').count(), 1)

  await page.getByRole('button', { name: '全部产出 跨会话汇总', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.artifact-stats strong')?.textContent === '4')
  assert.equal(await page.locator('.artifact-card').count(), 4)
  assert.equal(await page.locator('.artifact-card[data-availability="decrypt_failed"]').count(), 1)

  await page.getByRole('button', { name: '浅色模式', exact: true }).click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light')
  await page.getByRole('button', { name: '深色模式', exact: true }).click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '聊天', exact: true }).click()
  await page.getByRole('heading', { name: '会话 120', exact: true }).waitFor()
  assert.equal(await page.locator('.chat-library').getAttribute('data-mobile-pane'), 'sidebar')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false)

  const firstConversation = page.locator('.conversation-main').filter({ hasText: '会话 001' })
  assert.equal(await firstConversation.count(), 1)
  await firstConversation.click()
  await page.getByRole('heading', { name: '会话 001', exact: true }).waitFor()
  assert.equal(await page.locator('.chat-library').getAttribute('data-mobile-pane'), 'workspace')
  assert.equal(await page.locator('.artifact-grid-window').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length), 1)

  await page.locator('.mobile-back').click()
  assert.equal(await page.locator('.chat-library').getAttribute('data-mobile-pane'), 'sidebar')
  await page.waitForFunction(() => document.activeElement?.classList.contains('conversation-main'))
  assert.match(await page.evaluate(() => document.activeElement?.textContent ?? ''), /会话 001/u)
  assert.deepEqual(browserErrors, [])

  await context.close()
  console.log('chat-library e2e: desktop, mobile, themes, reduced motion, collections, and virtualization passed')
} finally {
  await browser?.close()
  await closeServer(server)
  artifactDb.close()
  wechatDb.close()
}
