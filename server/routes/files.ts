import { Router } from 'express'
import fs from 'node:fs'
import mime from 'mime'
import { inspectArchive, inspectFile } from '../utils/inspect.js'
import { resolveFile } from '../utils/helpers.js'
import { inspectVoice, isVoiceFile, transcodeVoice } from '../utils/voice.js'

const router = Router()

router.get('/api/file/:id/text', (req, res) => {
  const resolved = resolveFile(req.params.id)
  if (!resolved) return res.status(404).json({ error: 'File not found' })
  const allowed = new Set(['text', 'markdown', 'code', 'html', 'json'])
  if (!allowed.has(resolved.item.preview)) {
    return res.status(415).json({ error: 'This file is not a text preview.' })
  }
  res.type('text/plain; charset=utf-8')
  res.send(fs.readFileSync(resolved.target, 'utf8'))
})

router.get('/api/file/:id/archive', async (req, res) => {
  const resolved = resolveFile(req.params.id)
  if (!resolved) return res.status(404).json({ error: 'File not found' })
  if (resolved.item.preview !== 'archive') {
    return res.status(415).json({ error: 'This file is not an archive preview.' })
  }
  res.json(await inspectArchive(resolved.target))
})

router.get('/api/file/:id/voice', (req, res) => {
  const resolved = resolveFile(req.params.id)
  if (!resolved) return res.status(404).json({ error: 'File not found' })
  if (!isVoiceFile(resolved.target)) {
    return res.status(415).json({ error: 'This file is not a supported voice preview.' })
  }
  res.json(inspectVoice(resolved.target, `/api/file/${req.params.id}/voice.wav`))
})

router.get('/api/file/:id/voice.wav', (req, res) => {
  const resolved = resolveFile(req.params.id)
  if (!resolved) return res.status(404).json({ error: 'File not found' })
  if (!isVoiceFile(resolved.target)) {
    return res.status(415).json({ error: 'This file is not a supported voice preview.' })
  }
  res.type('audio/wav')
  res.sendFile(transcodeVoice(resolved.target))
})

router.get('/api/file/:id/inspect', (req, res) => {
  const resolved = resolveFile(req.params.id)
  if (!resolved) return res.status(404).json({ error: 'File not found' })
  res.json(inspectFile(resolved.target))
})

router.get('/files/:id', (req, res) => {
  const resolved = resolveFile(req.params.id)
  if (!resolved) return res.status(404).json({ error: 'File not found' })
  res.type(mime.getType(resolved.target) ?? 'application/octet-stream')
  res.sendFile(resolved.target)
})

export default router
