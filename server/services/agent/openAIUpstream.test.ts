import assert from 'node:assert/strict'
import test from 'node:test'
import { AgentUpstreamError } from './agentLoop.js'
import { createOpenAIUpstream } from './openAIUpstream.js'

test('parses OpenAI-compatible tool calls without returning request credentials', async () => {
  let requestBody = ''
  const upstream = createOpenAIUpstream({
    baseURL: 'https://example.test/v1', apiKey: 'fake-private-key', model: 'fixture', temperature: 0.2,
  }, async (_url, init) => {
    requestBody = String(init?.body)
    return Response.json({ choices: [{ message: {
      content: null,
      tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'search_messages', arguments: '{"query":"中文"}' } }],
    } }] })
  })
  const result = await upstream({ messages: [{ role: 'user', content: '中文问题' }], tools: [] })
  assert.equal(result.toolCalls[0]?.name, 'search_messages')
  assert.match(requestBody, /fixture/u)
  assert.doesNotMatch(JSON.stringify(result), /fake-private-key/u)
})

test('distinguishes unsupported tools from stable upstream failures', async () => {
  const unsupported = createOpenAIUpstream({
    baseURL: 'https://example.test/v1', apiKey: '', model: 'fixture', temperature: 0,
  }, async () => new Response('function tools are not supported', { status: 400 }))
  await assert.rejects(unsupported({ messages: [], tools: [] }), (error: unknown) => (
    error instanceof AgentUpstreamError && error.code === 'tools_unsupported'
  ))
  const failed = createOpenAIUpstream({
    baseURL: 'https://example.test/v1', apiKey: 'fake-private-key', model: 'fixture', temperature: 0,
  }, async () => new Response('private upstream details', { status: 500 }))
  await assert.rejects(failed({ messages: [], tools: [] }), (error: unknown) => (
    error instanceof AgentUpstreamError && error.code === 'upstream_failed' && !error.message.includes('private')
  ))
})
