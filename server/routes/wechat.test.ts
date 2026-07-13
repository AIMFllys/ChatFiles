import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'
import { DatabaseSync } from 'node:sqlite'

import express from 'express'
import JSZip from 'jszip'

import { createApp } from '../app.js'
import { createWechatRouter, type WechatRouterDependencies } from './wechat.js'

function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatfiles-wechat-http-'))
  const accountRoot = path.join(root, 'wxid_fixture')
  fs.mkdirSync(accountRoot)
  const assetDb = new DatabaseSync(':memory:')
  const wechatDb = new DatabaseSync(':memory:')
  assetDb.exec(`
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
    INSERT INTO conversations VALUES ('conv-a', 'private-account', 'user-a', '测试会话', 0, 1, 1, 100, 100, '');
    INSERT INTO messages VALUES ('conv-a', 'm-1', 1, 100, 'sender', '张三', 1, 'text', '中文消息');
  `)
  const insert = assetDb.prepare('INSERT INTO artifacts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  let sequence = 0
  const addAsset = (options: {
    kind?: string
    name?: string
    preview?: string
    relativePath?: string | null
    content?: string | Buffer
    materialization?: string
    previewStatus?: string
    url?: string | null
    convId?: string | null
  } = {}) => {
    sequence += 1
    const id = sequence.toString(16).padStart(64, '0')
    const relativePath = options.relativePath === undefined ? `file-${sequence}.txt` : options.relativePath
    let sourceSize: number | null = null
    if (relativePath !== null && options.content !== undefined) {
      const target = path.join(accountRoot, ...relativePath.split('/'))
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, options.content)
      sourceSize = fs.statSync(target).size
    }
    insert.run(
      id, options.convId === undefined ? 'conv-a' : options.convId, 'document', options.kind ?? 'resource',
      options.name ?? path.basename(relativePath ?? 'missing'), options.preview ?? 'text', options.url ?? null,
      relativePath, sourceSize, 100, '张三', 'private full text',
      options.materialization ?? 'exported', options.previewStatus ?? 'ready', 'private failure detail',
    )
    return id
  }
  const dependencies: WechatRouterDependencies = {
    openWechatDatabase: () => ({ db: wechatDb, release() {} }),
    openArtifactDatabase: () => ({ db: assetDb, release() {} }),
    accountRootProvider: () => accountRoot,
    imageThumbnail: (target) => target,
    videoThumbnail: (target) => target,
  }
  t.after(() => {
    assetDb.close()
    wechatDb.close()
    fs.rmSync(root, { recursive: true, force: true })
  })
  return { root, accountRoot, assetDb, wechatDb, addAsset, dependencies }
}

async function withServer(
  handler: express.RequestHandler,
  run: (baseUrl: string) => Promise<void>,
) {
  const app = express()
  app.use(handler)
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  try {
    await run(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

test('serves global and conversation collections and strictly validates query parameters', async (t) => {
  const fixtureData = fixture(t)
  fixtureData.addAsset({ name: '中文资料.pdf', preview: 'pdf', content: 'pdf' })
  fixtureData.addAsset({ name: 'global.docx', preview: 'docx', content: 'doc', convId: null })
  const router = createWechatRouter(fixtureData.dependencies)

  await withServer(router, async (baseUrl) => {
    const global = await fetch(`${baseUrl}/api/wechat/artifacts?tab=all&q=%E4%B8%AD%E6%96%87&limit=60&offset=0`)
    assert.equal(global.status, 200)
    assert.equal(global.headers.get('cache-control'), 'private, no-store')
    assert.equal(global.headers.get('cross-origin-resource-policy'), 'same-origin')
    assert.equal(global.headers.get('x-content-type-options'), 'nosniff')
    const globalBody = await global.json() as { counts: { all: number; chatText: number }; matchingTotal: number }
    assert.deepEqual(globalBody, { ...globalBody, matchingTotal: 1 })
    assert.equal(globalBody.counts.all, 2)
    assert.equal(globalBody.counts.chatText, 1)

    const conversation = await fetch(`${baseUrl}/api/wechat/conversation/conv-a/artifacts?tab=all`)
    assert.equal(conversation.status, 200)
    assert.equal((await conversation.json() as { counts: { all: number } }).counts.all, 1)

    for (const query of [
      'tab=other', 'collection=other', 'collection=library&collection=outputs',
      'limit=0', 'limit=201', 'limit=1.5', 'offset=-1', `q=${'x'.repeat(201)}`,
    ]) {
      const response = await fetch(`${baseUrl}/api/wechat/artifacts?${query}`)
      assert.equal(response.status, 400, query)
      assert.deepEqual(Object.keys(await response.json()).sort(), ['code', 'error'])
    }

    assert.equal((await fetch(`${baseUrl}/api/wechat/artifacts?offset=3`)).status, 416)
    const empty = await fetch(`${baseUrl}/api/wechat/artifacts?offset=2`)
    assert.equal(empty.status, 200)
    assert.deepEqual((await empty.json() as { items: unknown[] }).items, [])
  })
})

test('serves a distinct ready-only library collection with coherent pagination', async (t) => {
  const fixtureData = fixture(t)
  fixtureData.addAsset({ name: '可预览.pdf', preview: 'pdf', content: 'ready' })
  fixtureData.addAsset({
    name: '待解密.pdf', preview: 'pdf', materialization: 'decrypt_failed', previewStatus: 'decrypt_failed',
  })
  fixtureData.addAsset({ name: '全局可预览.docx', preview: 'docx', content: 'ready', convId: null })

  await withServer(createWechatRouter(fixtureData.dependencies), async (baseUrl) => {
    const library = await fetch(`${baseUrl}/api/wechat/artifacts?collection=library&tab=all`)
    assert.equal(library.status, 200)
    const body = await library.json() as {
      counts: { all: number; document: number; chatText: number }
      matchingTotal: number
      items: Array<{ name: string }>
    }
    assert.deepEqual(body.counts, {
      all: 2, work: 0, document: 2, skill: 0, link: 0, chatText: 0,
    })
    assert.equal(body.matchingTotal, 2)
    assert.deepEqual(body.items.map((item) => item.name), ['可预览.pdf', '全局可预览.docx'])

    const text = await fetch(`${baseUrl}/api/wechat/artifacts?collection=library&tab=chatText`)
    assert.equal(text.status, 200)
    assert.deepEqual(await text.json(), {
      tab: 'chatText',
      counts: { all: 2, work: 0, document: 2, skill: 0, link: 0, chatText: 0 },
      total: 0, matchingTotal: 0, offset: 0, limit: 60, items: [],
    })
    assert.equal((await fetch(`${baseUrl}/api/wechat/artifacts?collection=library&offset=2`)).status, 200)
    assert.equal((await fetch(`${baseUrl}/api/wechat/artifacts?collection=library&offset=3`)).status, 416)
  })
})

test('preserves the existing conversations and messages HTTP endpoints', async (t) => {
  const fixtureData = fixture(t)
  await withServer(createWechatRouter(fixtureData.dependencies), async (baseUrl) => {
    const conversations = await fetch(`${baseUrl}/api/wechat/conversations`)
    assert.equal(conversations.status, 200)
    assert.equal(
      (await conversations.json() as { conversations: Array<{ display: string }> }).conversations[0]?.display,
      '测试会话',
    )

    const messages = await fetch(`${baseUrl}/api/wechat/conversation/conv-a/messages`)
    assert.equal(messages.status, 200)
    assert.equal((await messages.json() as { messages: Array<{ text: string }> }).messages[0]?.text, '中文消息')
  })
})

test('returns generic 404 and 503 responses for missing conversations and databases', async (t) => {
  const fixtureData = fixture(t)
  await withServer(createWechatRouter(fixtureData.dependencies), async (baseUrl) => {
    const missingConversation = await fetch(`${baseUrl}/api/wechat/conversation/absent/artifacts`)
    assert.equal(missingConversation.status, 404)
    assert.deepEqual(await missingConversation.json(), { error: 'Request failed', code: 'not_found' })
  })

  const unavailable: WechatRouterDependencies = {
    ...fixtureData.dependencies,
    openArtifactDatabase: () => ({ db: null, release() {} }),
  }
  await withServer(createWechatRouter(unavailable), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/wechat/artifacts`)
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { error: 'Request failed', code: 'database_unavailable' })
  })
})

test('keeps metadata path-free but returns 503 content when source configuration is unavailable', async (t) => {
  const fixtureData = fixture(t)
  const id = fixtureData.addAsset({ name: 'ready.pdf', preview: 'pdf', content: 'ready' })
  const dependencies: WechatRouterDependencies = {
    ...fixtureData.dependencies,
    accountRootProvider: () => null,
  }

  await withServer(createWechatRouter(dependencies), async (baseUrl) => {
    const metadata = await fetch(`${baseUrl}/api/wechat/artifact/${id}/metadata`)
    assert.equal(metadata.status, 200)
    assert.equal((await metadata.json() as { availability: string }).availability, 'source_unavailable')

    const content = await fetch(`${baseUrl}/api/wechat/artifact/${id}/content`)
    assert.equal(content.status, 503)
    assert.deepEqual(await content.json(), { error: 'Request failed', code: 'configuration_unavailable' })
  })
})

test('maps malformed, unknown, unavailable, and unsupported content requests to safe statuses', async (t) => {
  const fixtureData = fixture(t)
  const decrypt = fixtureData.addAsset({
    relativePath: 'secret.dat', content: 'secret', materialization: 'decrypt_failed', previewStatus: 'decrypt_failed',
  })
  const link = fixtureData.addAsset({ kind: 'link', preview: 'link', relativePath: null, url: 'https://example.test' })
  await withServer(createWechatRouter(fixtureData.dependencies), async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/wechat/artifact/not-an-id/content`)).status, 400)
    assert.equal((await fetch(`${baseUrl}/api/wechat/artifact/${'f'.repeat(64)}/content`)).status, 404)

    const unavailable = await fetch(`${baseUrl}/api/wechat/artifact/${decrypt}/content`)
    assert.equal(unavailable.status, 409)
    assert.deepEqual(await unavailable.json(), {
      error: 'Request failed', code: 'source_unavailable', state: 'decrypt_failed',
    })
    assert.equal((await fetch(`${baseUrl}/api/wechat/artifact/${link}/content`)).status, 415)
  })
})

test('returns path-free metadata with capabilities only when the runtime source is usable', async (t) => {
  const fixtureData = fixture(t)
  const ready = fixtureData.addAsset({ name: '中文图片.png', preview: 'image', content: 'image' })
  const missing = fixtureData.addAsset({ name: 'gone.pdf', preview: 'pdf', relativePath: 'gone.pdf' })
  const link = fixtureData.addAsset({ kind: 'link', name: 'link', preview: 'link', relativePath: null, url: 'https://example.test' })

  await withServer(createWechatRouter(fixtureData.dependencies), async (baseUrl) => {
    const readyBody = await (await fetch(`${baseUrl}/api/wechat/artifact/${ready}/metadata`)).json() as {
      availability: string
      capabilities: Record<string, string>
      size: number | null
    }
    assert.equal(readyBody.availability, 'ready')
    assert.equal(readyBody.size, 5)
    assert.deepEqual(Object.keys(readyBody.capabilities).sort(), ['content', 'metadata', 'thumbnail'])
    assert.doesNotMatch(JSON.stringify(readyBody), /source_relative_path|private full text|private failure|wxid_fixture/)
    const metadataResponse = await fetch(`${baseUrl}/api/wechat/artifact/${ready}/metadata`)
    assert.equal(metadataResponse.headers.get('cache-control'), 'private, no-store')
    assert.equal(metadataResponse.headers.get('cross-origin-resource-policy'), 'same-origin')
    assert.equal(metadataResponse.headers.get('x-content-type-options'), 'nosniff')

    const missingBody = await (await fetch(`${baseUrl}/api/wechat/artifact/${missing}/metadata`)).json() as {
      availability: string
      capabilities: Record<string, string>
    }
    assert.equal(missingBody.availability, 'source_unavailable')
    assert.deepEqual(Object.keys(missingBody.capabilities), ['metadata'])

    const linkBody = await (await fetch(`${baseUrl}/api/wechat/artifact/${link}/metadata`)).json() as {
      availability: string
      capabilities: Record<string, string>
    }
    assert.equal(linkBody.availability, 'ready')
    assert.deepEqual(Object.keys(linkBody.capabilities), ['metadata'])
  })
})

test('serves path-free inspection data for ready generic files and archives', async (t) => {
  const fixtureData = fixture(t)
  const generic = fixtureData.addAsset({
    name: 'sample.bin', preview: 'download', content: 'visible artifact content',
  })
  const zip = new JSZip()
  zip.file('\u4e2d\u6587/readme.txt', 'ok')
  const zipContent = await zip.generateAsync({ type: 'nodebuffer' })
  const archive = fixtureData.addAsset({
    name: '资料.zip', preview: 'archive', relativePath: '资料.zip', content: zipContent,
  })

  await withServer(createWechatRouter(fixtureData.dependencies), async (baseUrl) => {
    const inspectionResponse = await fetch(`${baseUrl}/api/wechat/artifact/${generic}/inspect`)
    assert.equal(inspectionResponse.status, 200)
    const inspection = await inspectionResponse.json() as { path: string; headerHex: string }
    assert.equal(inspection.path, '')
    assert.match(inspection.headerHex, /^76 69 73 69 62 6c 65/u)
    assert.doesNotMatch(JSON.stringify(inspection), /chatfiles-wechat-http|wxid_fixture/u)

    const archiveResponse = await fetch(`${baseUrl}/api/wechat/artifact/${archive}/archive`)
    assert.equal(archiveResponse.status, 200)
    const archiveBody = await archiveResponse.json() as {
      path: string
      readable: boolean
      entries: Array<{ name: string }>
    }
    assert.equal(archiveBody.path, '')
    assert.equal(archiveBody.readable, true)
    assert.deepEqual(archiveBody.entries.map((entry) => entry.name), [
      '\u4e2d\u6587/', '\u4e2d\u6587/readme.txt',
    ])
    assert.doesNotMatch(JSON.stringify(archiveBody), /chatfiles-wechat-http|wxid_fixture/u)
  })
})

test('serves HTML, PDF, and SVG with hardened headers and safe dispositions', async (t) => {
  const fixtureData = fixture(t)
  const html = fixtureData.addAsset({ name: '页面\r\n测试.html', preview: 'html', relativePath: 'page.html', content: '<h1>safe</h1>' })
  const pdf = fixtureData.addAsset({ name: '报告.pdf', preview: 'pdf', relativePath: 'report.pdf', content: '%PDF fixture' })
  const svg = fixtureData.addAsset({ name: 'vector.svg', preview: 'image', relativePath: 'vector.svg', content: '<svg></svg>' })
  const text = fixtureData.addAsset({ name: '中文.txt', preview: 'text', relativePath: '中文.txt', content: '你好，世界' })

  await withServer(createWechatRouter(fixtureData.dependencies), async (baseUrl) => {
    const htmlResponse = await fetch(`${baseUrl}/api/wechat/artifact/${html}/content`)
    assert.equal(htmlResponse.status, 200)
    assert.match(htmlResponse.headers.get('content-type') ?? '', /^text\/html/u)
    assert.match(htmlResponse.headers.get('content-security-policy') ?? '', /sandbox; default-src 'none'/u)
    assert.match(htmlResponse.headers.get('content-disposition') ?? '', /^inline;/u)
    assert.doesNotMatch(htmlResponse.headers.get('content-disposition') ?? '', /[\r\n]/u)

    const pdfResponse = await fetch(`${baseUrl}/api/wechat/artifact/${pdf}/content`)
    assert.equal(pdfResponse.status, 200)
    assert.equal(pdfResponse.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(pdfResponse.headers.get('cross-origin-resource-policy'), 'same-origin')
    assert.equal(pdfResponse.headers.get('referrer-policy'), 'no-referrer')
    assert.equal(pdfResponse.headers.get('cache-control'), 'private, no-store')
    assert.match(pdfResponse.headers.get('content-disposition') ?? '', /^inline;.*filename\*=UTF-8''/u)

    const svgResponse = await fetch(`${baseUrl}/api/wechat/artifact/${svg}/content`)
    assert.equal(svgResponse.status, 200)
    assert.match(svgResponse.headers.get('content-disposition') ?? '', /^attachment;/u)

    const textResponse = await fetch(`${baseUrl}/api/wechat/artifact/${text}/content`)
    assert.equal(textResponse.status, 200)
    assert.equal(textResponse.headers.get('content-type'), 'text/plain; charset=utf-8')
    assert.match(textResponse.headers.get('content-disposition') ?? '', /^inline;/u)
    assert.equal(await textResponse.text(), '你好，世界')
  })
})

test('supports byte ranges and returns a generic 416 for an invalid range', async (t) => {
  const fixtureData = fixture(t)
  const id = fixtureData.addAsset({ name: 'range.pdf', preview: 'pdf', content: '0123456789' })
  await withServer(createWechatRouter(fixtureData.dependencies), async (baseUrl) => {
    const partial = await fetch(`${baseUrl}/api/wechat/artifact/${id}/content`, { headers: { Range: 'bytes=0-2' } })
    assert.equal(partial.status, 206)
    assert.equal(await partial.text(), '012')

    const invalid = await fetch(`${baseUrl}/api/wechat/artifact/${id}/content`, { headers: { Range: 'bytes=99-' } })
    assert.equal(invalid.status, 416)
    assert.equal(invalid.headers.get('content-range'), 'bytes */10')
    assert.match(invalid.headers.get('content-type') ?? '', /^application\/json/u)
    assert.equal(invalid.headers.get('content-disposition'), null)
    assert.doesNotMatch(await invalid.text(), /wxid_fixture|range\.pdf/u)
  })
})

test('strictly normalizes thumbnail widths and serves only image or video artifacts', async (t) => {
  const fixtureData = fixture(t)
  const widths: number[] = []
  const thumbnailPath = path.join(fixtureData.root, 'thumb.webp')
  fs.writeFileSync(thumbnailPath, 'webp')
  const dependencies: WechatRouterDependencies = {
    ...fixtureData.dependencies,
    imageThumbnail: (_target, width) => {
      widths.push(width)
      return width === 496 ? path.join(fixtureData.root, 'missing-thumb.webp') : thumbnailPath
    },
    videoThumbnail: (_target, width) => { widths.push(width); return thumbnailPath },
  }
  const image = fixtureData.addAsset({ name: 'image.jpg', preview: 'image', content: 'image' })
  const video = fixtureData.addAsset({ name: 'video.mp4', preview: 'video', content: 'video', materialization: 'thumbnail_only', previewStatus: 'thumbnail_only' })
  const document = fixtureData.addAsset({ name: 'doc.pdf', preview: 'pdf', content: 'pdf' })

  await withServer(createWechatRouter(dependencies), async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/wechat/artifact/${image}/thumbnail?w=105`)).status, 200)
    assert.equal((await fetch(`${baseUrl}/api/wechat/artifact/${video}/thumbnail?w=512`)).status, 200)
    const failedThumbnail = await fetch(`${baseUrl}/api/wechat/artifact/${image}/thumbnail?w=500`)
    assert.equal(failedThumbnail.status, 409)
    assert.match(failedThumbnail.headers.get('content-type') ?? '', /^application\/json/u)
    assert.equal(failedThumbnail.headers.get('content-disposition'), null)
    assert.deepEqual(widths, [112, 512, 496])
    assert.equal((await fetch(`${baseUrl}/api/wechat/artifact/${image}/thumbnail?w=95`)).status, 400)
    assert.equal((await fetch(`${baseUrl}/api/wechat/artifact/${image}/thumbnail?w=96.5`)).status, 400)
    assert.equal((await fetch(`${baseUrl}/api/wechat/artifact/${document}/thumbnail`)).status, 415)
  })
})

test('the production app does not grant cross-origin read access', async (t) => {
  const fixtureData = fixture(t)
  fixtureData.addAsset({ content: 'ready' })
  const privateDatabasePath = path.join(fixtureData.root, 'data', 'chat-assets.current', 'artifacts.db')
  fs.mkdirSync(path.dirname(privateDatabasePath), { recursive: true })
  fs.writeFileSync(privateDatabasePath, 'PRIVATE_DATABASE_BYTES')
  const app = createApp({ projectRoot: fixtureData.root, wechatRouter: createWechatRouter(fixtureData.dependencies) })
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/wechat/artifacts`, {
      headers: { Origin: 'https://evil.example' },
    })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('access-control-allow-origin'), null)

    const directDatabase = await fetch(
      `http://127.0.0.1:${address.port}/data/chat-assets.current/artifacts.db`,
    )
    assert.notEqual(directDatabase.status, 200)
    assert.doesNotMatch(await directDatabase.text(), /PRIVATE_DATABASE_BYTES/u)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
