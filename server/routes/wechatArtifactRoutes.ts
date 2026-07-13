import fs from 'node:fs'
import type { Router } from 'express'
import type { ChatArtifactCapability } from '../../shared/contracts/chat.js'
import { inspectArchive, inspectFile } from '../utils/inspect.js'
import { createArtifactSourceResolver, type ArtifactSourceResolution } from '../wechat/artifactSourceResolver.js'
import {
  assetResultError,
  byteRangeSatisfiable,
  clearFileRepresentationHeaders,
  parseThumbnailWidth,
  publicMetadata,
  sendError,
  sendResolvedFile,
  setPrivateFileHeaders,
  type WechatRouterDependencies,
} from './wechatRouteHelpers.js'

export function registerWechatArtifactRoutes(router: Router, deps: WechatRouterDependencies) {
  router.get('/api/wechat/artifact/:id/metadata', (request, response) => {
    const lease = deps.openArtifactDatabase()
    if (!lease.db) return sendError(response, 503, 'database_unavailable')
    try {
      const resolver = createArtifactSourceResolver({ assetDb: lease.db, accountRootProvider: deps.accountRootProvider })
      const content = resolver.resolve(request.params.id, 'content')
      if (content.status === 'malformed' || content.status === 'unknown') return assetResultError(response, content)
      let availability = content.state
      const capabilities: ChatArtifactCapability = { metadata: `/api/wechat/artifact/${content.asset.id}/metadata` }
      if (content.status === 'available') capabilities.content = `/api/wechat/artifact/${content.asset.id}/content`
      if (content.asset.preview === 'image' || content.asset.preview === 'video') {
        const thumbnail = resolver.resolve(request.params.id, 'thumbnail')
        if (thumbnail.status === 'available') {
          capabilities.thumbnail = `/api/wechat/artifact/${content.asset.id}/thumbnail`
          if (content.status !== 'available') availability = thumbnail.state
        } else if (content.status === 'available' && thumbnail.status === 'unavailable') {
          availability = thumbnail.state
          delete capabilities.content
        }
      }
      return response.json(publicMetadata(content.asset, availability, capabilities))
    } catch {
      return sendError(response, 503, 'database_unavailable')
    } finally {
      lease.release()
    }
  })

  router.get('/api/wechat/artifact/:id/inspect', (request, response) => {
    const lease = deps.openArtifactDatabase()
    if (!lease.db) return sendError(response, 503, 'database_unavailable')
    let result: ArtifactSourceResolution
    try {
      result = createArtifactSourceResolver({ assetDb: lease.db, accountRootProvider: deps.accountRootProvider })
        .resolve(request.params.id, 'content')
    } catch {
      return sendError(response, 503, 'database_unavailable')
    } finally {
      lease.release()
    }
    if (result.status !== 'available') return assetResultError(response, result)
    try {
      return response.json({ ...inspectFile(result.target), path: '' })
    } catch {
      return sendError(response, 409, 'source_unavailable', 'source_unavailable')
    }
  })

  router.get('/api/wechat/artifact/:id/archive', async (request, response) => {
    const lease = deps.openArtifactDatabase()
    if (!lease.db) return sendError(response, 503, 'database_unavailable')
    let result: ArtifactSourceResolution
    try {
      result = createArtifactSourceResolver({ assetDb: lease.db, accountRootProvider: deps.accountRootProvider })
        .resolve(request.params.id, 'content')
    } catch {
      return sendError(response, 503, 'database_unavailable')
    } finally {
      lease.release()
    }
    if (result.status !== 'available') return assetResultError(response, result)
    if (result.asset.preview !== 'archive' && !/\.(?:zip|rar|7z)$/iu.test(result.asset.name)) {
      return sendError(response, 415, 'operation_unsupported', result.state)
    }
    try {
      const preview = await inspectArchive(result.target)
      return response.json({ ...preview, path: '', ...(preview.readable ? {} : { error: '压缩包目录不可读' }) })
    } catch {
      return sendError(response, 409, 'source_unavailable', 'source_unavailable')
    }
  })

  router.get('/api/wechat/artifact/:id/content', (request, response) => {
    const lease = deps.openArtifactDatabase()
    if (!lease.db) return sendError(response, 503, 'database_unavailable')
    let result: ArtifactSourceResolution
    try {
      result = createArtifactSourceResolver({ assetDb: lease.db, accountRootProvider: deps.accountRootProvider })
        .resolve(request.params.id, 'content')
    } catch {
      return sendError(response, 503, 'database_unavailable')
    } finally {
      lease.release()
    }
    if (result.status !== 'available') return assetResultError(response, result)
    try {
      const range = byteRangeSatisfiable(request.headers.range, result.target)
      if (!range.ok) {
        setPrivateFileHeaders(response)
        response.setHeader('Content-Range', `bytes */${range.size}`)
        return sendError(response, 416, 'range_not_satisfiable')
      }
    } catch {
      return sendError(response, 409, 'source_unavailable', 'source_unavailable')
    }
    return sendResolvedFile(response, result)
  })

  router.get('/api/wechat/artifact/:id/thumbnail', (request, response) => {
    const width = parseThumbnailWidth(request.query.w)
    if (width === null) return sendError(response, 400, 'invalid_thumbnail_width')
    const lease = deps.openArtifactDatabase()
    if (!lease.db) return sendError(response, 503, 'database_unavailable')
    let result: ArtifactSourceResolution
    try {
      result = createArtifactSourceResolver({ assetDb: lease.db, accountRootProvider: deps.accountRootProvider })
        .resolve(request.params.id, 'thumbnail')
    } catch {
      return sendError(response, 503, 'database_unavailable')
    } finally {
      lease.release()
    }
    if (result.status !== 'available') return assetResultError(response, result)
    let target: string
    try {
      target = result.asset.preview === 'video'
        ? deps.videoThumbnail(result.target, width)
        : deps.imageThumbnail(result.target, width)
    } catch {
      return sendError(response, 415, 'thumbnail_unavailable', 'unsupported_codec')
    }
    try {
      if (!fs.statSync(target).isFile()) return sendError(response, 409, 'source_unavailable', 'source_unavailable')
      setPrivateFileHeaders(response)
      response.type('image/webp')
      return response.sendFile(target, (error) => {
        if (!error) return
        if (response.headersSent) {
          if (!response.writableEnded) response.end()
          return
        }
        clearFileRepresentationHeaders(response)
        sendError(response, 409, 'source_unavailable', 'source_unavailable')
      })
    } catch {
      return sendError(response, 409, 'source_unavailable', 'source_unavailable')
    }
  })
}
