import fs from 'node:fs'
import path from 'node:path'

import express, { type Router } from 'express'

import aiRouter from './routes/ai.js'
import dataRouter from './routes/data.js'
import filesRouter from './routes/files.js'
import insightsRouter from './routes/insights.js'
import sourceFilesRouter from './routes/source-files.js'
import defaultWechatRouter from './routes/wechat.js'
import { root } from './utils/helpers.js'

export type AppOptions = {
  projectRoot?: string
  wechatRouter?: Router
}

export function createApp(options: AppOptions = {}) {
  const projectRoot = options.projectRoot ?? root
  const app = express()
  app.use(express.json({ limit: '24mb' }))

  app.use(dataRouter)
  app.use(filesRouter)
  app.use(sourceFilesRouter)
  app.use(options.wechatRouter ?? defaultWechatRouter)
  app.use(insightsRouter)
  app.use(aiRouter)

  app.use('/docs', express.static(path.join(projectRoot, 'docs')))
  app.use(
    '/replication',
    express.static(path.join(projectRoot, 'replication'), {
      setHeaders: (response, filePath) => {
        if (filePath.endsWith('.md')) response.type('text/markdown; charset=utf-8')
      },
    }),
  )

  const dist = path.join(projectRoot, 'dist')
  if (fs.existsSync(dist)) {
    app.use(express.static(dist))
    app.use((_request, response) => response.sendFile(path.join(dist, 'index.html')))
  } else {
    app.use((_request, response) => response.status(503).json({
      error: 'Request failed',
      code: 'build_unavailable',
    }))
  }
  return app
}
