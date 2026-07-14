import assert from 'node:assert/strict'
import test from 'node:test'
import { z } from 'zod/v4'

import { ApiClientError, readJson } from './client.js'

const schema = z.object({ value: z.string() }).strict()

test('validates status, JSON content type, and response schema centrally', async () => {
  const valid = await readJson('/api/value', schema, {
    fetchImpl: async () => new Response(JSON.stringify({ value: '中文🙂' }), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    }),
  })
  assert.deepEqual(valid, { value: '中文🙂' })

  for (const [response, code] of [
    [new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } }), 'request_failed'],
    [new Response('{}', { status: 200, headers: { 'content-type': 'text/html' } }), 'invalid_content_type'],
    [new Response('{', { status: 200, headers: { 'content-type': 'application/json' } }), 'invalid_json'],
    [new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }), 'invalid_response'],
  ] as const) {
    await assert.rejects(
      readJson('/api/value', schema, { fetchImpl: async () => response }),
      (error: unknown) => error instanceof ApiClientError && error.code === code,
    )
  }
})
