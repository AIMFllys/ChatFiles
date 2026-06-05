import cors from 'cors'
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import aiRouter from './routes/ai.js'
import dataRouter from './routes/data.js'
import filesRouter from './routes/files.js'
import insightsRouter from './routes/insights.js'
import sourceFilesRouter from './routes/source-files.js'
import wechatRouter from './routes/wechat.js'
import { root } from './utils/helpers.js'

const port = Number(process.env.PORT ?? 3456)

const app = express()
app.use(cors())
app.use(express.json({ limit: '24mb' }))

app.use(dataRouter)
app.use(filesRouter)
app.use(sourceFilesRouter)
app.use(wechatRouter)
app.use(insightsRouter)
app.use(aiRouter)

app.use('/docs', express.static(path.join(root, 'docs')))
app.use(
  '/replication',
  express.static(path.join(root, 'replication'), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.md')) res.type('text/markdown; charset=utf-8')
    },
  }),
)

const dist = path.join(root, 'dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.use((_req, res) => res.sendFile(path.join(dist, 'index.html')))
} else {
  app.use(express.static(root))
  app.use((_req, res) => res.redirect('/index.html'))
}

app.listen(port, '127.0.0.1', () => {
  console.log(`ChatFiles running at http://127.0.0.1:${port}`)
})
