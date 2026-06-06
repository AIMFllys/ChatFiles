import { Router } from 'express'
import fs from 'node:fs'
import mime from 'mime'
import { inspectArchive, inspectFile, inspectSqlite } from '../utils/inspect.js'
import { resolveSourceFile } from '../utils/helpers.js'
import { inspectVoice, isVoiceFile, transcodeVoice } from '../utils/voice.js'
import { imageThumb, videoPoster } from '../utils/thumbs.js'

const router = Router()

router.get('/api/source-file/:id/thumb', (req, res) => {
  const resolved = resolveSourceFile(req.params.id)
  if (!resolved) return res.status(404).json({ error: 'File not found' })
  const width = Number(req.query.w ?? 360)
  try {
    const target =
      resolved.item.preview === 'video'
        ? videoPoster(resolved.target, width)
        : resolved.item.preview === 'image'
          ? imageThumb(resolved.target, width)
          : null
    if (!target) return res.status(415).json({ error: 'No thumbnail for this type.' })
    res.type('image/webp')
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.sendFile(target)
  } catch {
    res.status(500).json({ error: 'Thumbnail generation failed.' })
  }
})

router.get('/api/source-file/:id/text', (req, res) => {
  const resolved = resolveSourceFile(req.params.id)
  if (!resolved) return res.status(404).json({ error: 'File not found' })
  const allowed = new Set(['text', 'markdown', 'code', 'html', 'json'])
  if (!allowed.has(resolved.item.preview)) {
    return res.status(415).json({ error: 'This file is not a text preview.' })
  }
  const stat = fs.statSync(resolved.target)
  if (stat.size > 5 * 1024 * 1024) return res.status(413).json({ error: 'Text preview is limited to 5 MB.' })
  res.type('text/plain; charset=utf-8')
  res.send(fs.readFileSync(resolved.target, 'utf8'))
})

router.get('/api/source-file/:id/database', (req, res) => {
  const resolved = resolveSourceFile(req.params.id)
  if (!resolved) return res.status(404).json({ error: 'File not found' })
  if (resolved.item.preview !== 'database') {
    return res.status(415).json({ error: 'This file is not a database preview.' })
  }
  res.json(inspectSqlite(resolved.target))
})

router.get('/api/source-file/:id/archive', async (req, res) => {
  const resolved = resolveSourceFile(req.params.id)
  if (!resolved) return res.status(404).json({ error: 'File not found' })
  if (resolved.item.preview !== 'archive') {
    return res.status(415).json({ error: 'This file is not an archive preview.' })
  }
  res.json(await inspectArchive(resolved.target))
})

router.get('/api/source-file/:id/voice', (req, res) => {
  const resolved = resolveSourceFile(req.params.id)
  if (!resolved) return res.status(404).json({ error: 'File not found' })
  if (!isVoiceFile(resolved.target)) {
    return res.status(415).json({ error: 'This file is not a supported voice preview.' })
  }
  res.json(inspectVoice(resolved.target, `/api/source-file/${req.params.id}/voice.wav`))
})

router.get('/api/source-file/:id/voice.wav', (req, res) => {
  const resolved = resolveSourceFile(req.params.id)
  if (!resolved) return res.status(404).json({ error: 'File not found' })
  if (!isVoiceFile(resolved.target)) {
    return res.status(415).json({ error: 'This file is not a supported voice preview.' })
  }
  res.type('audio/wav')
  res.sendFile(transcodeVoice(resolved.target))
})

router.get('/api/source-file/:id/inspect', (req, res) => {
  const resolved = resolveSourceFile(req.params.id)
  if (!resolved) return res.status(404).json({ error: 'File not found' })
  res.json(inspectFile(resolved.target))
})

router.get('/source-files/:id', (req, res) => {
  const resolved = resolveSourceFile(req.params.id)
  if (!resolved) return res.status(404).json({ error: 'File not found' })
  res.type(mime.getType(resolved.target) ?? 'application/octet-stream')
  res.sendFile(resolved.target)
})

export default router
