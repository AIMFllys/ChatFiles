import assert from 'node:assert/strict'
import test from 'node:test'
import {
  artifactRequestUrl,
  classifyArtifact,
  countArtifacts,
  nextArtifactTab,
  previewForArtifactName,
  safeExternalUrl,
  type ChatArtifact,
} from './artifactModel.js'

test('classifies mutually exclusive output kinds with skill precedence', () => {
  assert.equal(classifyArtifact({ name: 'apple-design SKILL.md', preview: 'markdown' }), 'skill')
  assert.equal(classifyArtifact({ name: '课程讲义.pdf', preview: 'pdf' }), 'document')
  assert.equal(classifyArtifact({ name: '交互作品.html', preview: 'html' }), 'work')
  assert.equal(classifyArtifact({ name: 'OpenAI 文档', url: 'https://example.com' }), 'link')
  assert.equal(classifyArtifact({ name: '普通消息', chatText: true }), 'chatText')
})

test('keeps a confirmed local document out of link even when it contains a source URL', () => {
  assert.equal(
    classifyArtifact({ name: '方案.docx', preview: 'docx', url: 'https://example.com/source', hasLocalFile: true }),
    'document',
  )
})

test('uses the exported file extension when legacy metadata claims a conflicting media preview', () => {
  assert.equal(previewForArtifactName('clip_thumb.jpg', 'video'), 'image')
  assert.equal(previewForArtifactName('clip.mp4', 'image'), 'video')
  assert.equal(previewForArtifactName('没有扩展名', 'video'), 'video')
})

test('allows only absolute HTTP(S) links to leave the local archive', () => {
  assert.equal(safeExternalUrl('https://example.com/path'), 'https://example.com/path')
  assert.equal(safeExternalUrl('http://127.0.0.1:3000/'), 'http://127.0.0.1:3000/')
  assert.equal(safeExternalUrl('javascript:alert(1)'), null)
  assert.equal(safeExternalUrl('file:///private/export'), null)
  assert.equal(safeExternalUrl('/relative/path'), null)
})

test('moves through artifact tabs with standard roving-tab keyboard keys', () => {
  assert.equal(nextArtifactTab('all', 'ArrowRight'), 'work')
  assert.equal(nextArtifactTab('all', 'ArrowLeft'), 'chatText')
  assert.equal(nextArtifactTab('document', 'Home'), 'all')
  assert.equal(nextArtifactTab('document', 'End'), 'chatText')
  assert.equal(nextArtifactTab('skill', 'Enter'), 'skill')
})

test('defines all as four output kinds and excludes chat text', () => {
  const artifacts: ChatArtifact[] = [
    { id: 'w', kind: 'work', available: true },
    { id: 'd', kind: 'document', available: true },
    { id: 's', kind: 'skill', available: false },
    { id: 'l', kind: 'link', available: true },
    { id: 'c1', kind: 'chatText', available: true },
    { id: 'c2', kind: 'chatText', available: true },
  ]

  assert.deepEqual(countArtifacts(artifacts), {
    all: 4,
    work: 1,
    document: 1,
    skill: 1,
    link: 1,
    chatText: 2,
    available: 5,
    missing: 1,
  })
})

test('serializes global and conversation artifact requests with literal query values', () => {
  assert.equal(
    artifactRequestUrl({
      selection: { kind: 'collection', id: 'outputs' },
      tab: 'all',
      query: '中文 & 100%',
      offset: 120,
      limit: 60,
    }),
    '/api/wechat/artifacts?tab=all&q=%E4%B8%AD%E6%96%87+%26+100%25&offset=120&limit=60',
  )
  assert.equal(
    artifactRequestUrl({
      selection: { kind: 'conversation', id: 'conv/with spaces' },
      tab: 'chatText',
      query: '',
      offset: 0,
      limit: 60,
    }),
    '/api/wechat/conversation/conv%2Fwith%20spaces/artifacts?tab=chatText&offset=0&limit=60',
  )
})
