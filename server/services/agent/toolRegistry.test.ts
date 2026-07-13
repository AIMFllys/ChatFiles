import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { createToolRegistry, ToolExecutionError } from './toolRegistry.js'
import type { RankedSearchHit } from '../search/searchTypes.js'

function searchHit(id: string): RankedSearchHit {
  return {
    chunkId: `chunk-${id}`, conversationId: 'conv-a', firstMessageUid: id, lastMessageUid: id,
    startTime: 100, endTime: 101, senderIds: ['u-a'], text: `检索证据 ${id}`, ngrams: '',
    tokenCount: 5, rank: 1, score: 1, source: 'keyword',
  }
}

function fixture(t: test.TestContext) {
  const wechatDb = new DatabaseSync(':memory:')
  const artifactDb = new DatabaseSync(':memory:')
  wechatDb.exec(`
    CREATE TABLE conversations(id TEXT PRIMARY KEY,display TEXT,is_group INTEGER,msg_count INTEGER,text_count INTEGER,first_time INTEGER,last_time INTEGER);
    CREATE TABLE messages(conv_id TEXT,message_uid TEXT PRIMARY KEY,seq INTEGER,time INTEGER,sender TEXT,sender_name TEXT,type INTEGER,type_label TEXT,text TEXT);
    INSERT INTO conversations VALUES('conv-a','中文会话',0,3,3,100,102);
    INSERT INTO messages VALUES
      ('conv-a','m-1',1,100,'u-a','张三',1,'text','第一条'),
      ('conv-a','m-2',2,101,'u-b','李四',1,'text','目标消息'),
      ('conv-a','m-3',3,102,'u-a','张三',1,'text','第三条');
  `)
  artifactDb.exec(`CREATE TABLE artifacts(
    asset_id TEXT PRIMARY KEY,conv_id TEXT,category TEXT,kind TEXT,name TEXT,preview TEXT,url TEXT,
    source_size INTEGER,created_at INTEGER,sender_name TEXT,text TEXT,materialization TEXT,preview_status TEXT
  )`)
  const assetId = 'a'.repeat(64)
  const linkId = 'b'.repeat(64)
  artifactDb.prepare('INSERT INTO artifacts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(assetId, 'conv-a', 'document', 'resource', '中文说明.md', 'markdown', null, 10, 100, '张三', '说明摘要', 'exported', 'ready')
  artifactDb.prepare('INSERT INTO artifacts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(linkId, 'conv-a', 'link', 'link', '示例链接', 'link', 'https://example.test', null, 101, '李四', '链接摘要', 'exported', 'ready')
  t.after(() => { wechatDb.close(); artifactDb.close() })
  const registry = createToolRegistry({
    wechatDb,
    artifactDb,
    searchMessages: async () => ({ mode: 'keyword-only', reason: 'not_configured', hits: [searchHit('m-1'), searchHit('m-2'), searchHit('m-3')] }),
    readDocument: async (id, maxCharacters) => ({ assetId: id, title: '中文说明.md', text: '文档正文'.slice(0, maxCharacters), truncated: false, citation: `[文件:${id}]` }),
    resolveLinkPreview: async (id, url) => ({ status: 'ready', url, domain: 'example.test', title: '链接标题', description: '简介', siteName: '站点', iconUrl: '', updatedAt: '2026-07-13T00:00:00.000Z', assetId: id }),
  })
  return { assetId, linkId, registry }
}

test('publishes exactly seven closed read-only JSON schemas', (t) => {
  const { registry } = fixture(t)
  assert.deepEqual(registry.schemas.map((schema) => schema.function.name), [
    'list_conversations', 'search_messages', 'get_message_context', 'search_artifacts',
    'read_document', 'get_timeline_slice', 'get_link_preview',
  ])
  assert.ok(registry.schemas.every((schema) => schema.function.parameters.additionalProperties === false))
})

test('rejects malformed and extra arguments with a stable error code', async (t) => {
  const { registry } = fixture(t)
  await assert.rejects(
    registry.execute('get_message_context', { messageUid: 'm-2', rawPath: 'private' }),
    (error: unknown) => error instanceof ToolExecutionError && error.code === 'invalid_arguments',
  )
  await assert.rejects(
    registry.execute('unknown_tool', {}),
    (error: unknown) => error instanceof ToolExecutionError && error.code === 'unknown_tool',
  )
})

test('caps message search and returns stable message citations', async (t) => {
  const { registry } = fixture(t)
  const result = await registry.execute('search_messages', { query: '目标', limit: 2 }) as {
    hits: unknown[]; citations: string[]; mode: string
  }
  assert.equal(result.hits.length, 2)
  assert.deepEqual(result.citations, ['[消息:m-1]', '[消息:m-2]'])
  assert.equal(result.mode, 'keyword-only')
})

test('shares bounded conversation, context, artifact, document, timeline, and link services', async (t) => {
  const { assetId, linkId, registry } = fixture(t)
  const conversations = await registry.execute('list_conversations', { query: '中文', limit: 1 }) as { conversations: unknown[] }
  assert.equal(conversations.conversations.length, 1)
  const context = await registry.execute('get_message_context', { messageUid: 'm-2', radius: 1 }) as { messages: unknown[]; citations: string[] }
  assert.equal(context.messages.length, 3)
  assert.deepEqual(context.citations, ['[消息:m-1]', '[消息:m-2]', '[消息:m-3]'])
  const artifacts = await registry.execute('search_artifacts', { query: '说明', category: 'document', limit: 5 }) as { citations: string[] }
  assert.deepEqual(artifacts.citations, [`[文件:${assetId}]`])
  assert.equal((await registry.execute('read_document', { assetId }) as { citation: string }).citation, `[文件:${assetId}]`)
  const timeline = await registry.execute('get_timeline_slice', { conversationId: 'conv-a', aroundMessageUid: 'm-2', limit: 3 }) as { messages: unknown[] }
  assert.equal(timeline.messages.length, 3)
  const link = await registry.execute('get_link_preview', { assetId: linkId }) as { citation: string; domain: string }
  assert.equal(link.citation, `[文件:${linkId}]`)
  assert.equal(link.domain, 'example.test')
  assert.doesNotMatch(JSON.stringify({ conversations, context, artifacts, timeline, link }), /rawPath|source_relative|private/u)
})
