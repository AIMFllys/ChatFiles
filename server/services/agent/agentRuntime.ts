import path from 'node:path'
import type { AgentRequestConfig, AgentStreamEvent, AgentStreamRequest } from '../../../src/types/aiAgent.js'
import { openValidatedArtifactDatabase } from '../../wechat/artifactDatabase.js'
import { createArtifactAccountRootProvider, createArtifactSourceResolver } from '../../wechat/artifactSourceResolver.js'
import { openValidatedWechatDatabase } from '../../wechat/databaseOpener.js'
import { root } from '../../utils/helpers.js'
import { createLinkPreviewService } from '../linkPreview/linkPreviewService.js'
import { readDocument } from '../documents/readDocument.js'
import { createRuntimeSearch } from '../search/searchRuntime.js'
import { sourceFileIdentity, wechatSourceFingerprint } from '../search/sourceFingerprint.js'
import { buildSearchIndex } from '../search/buildSearchIndex.js'
import { runAgent } from './agentLoop.js'
import { prepareHistoryContext } from './historySummary.js'
import { createOpenAIUpstream } from './openAIUpstream.js'
import { createToolRegistry } from './toolRegistry.js'

export async function executeAgentRuntime(
  request: AgentStreamRequest,
  emit: (event: AgentStreamEvent) => void,
  signal: AbortSignal,
  projectRoot = root,
) {
  const wechat = openValidatedWechatDatabase(projectRoot)
  const artifacts = openValidatedArtifactDatabase(projectRoot)
  if (!wechat.db || !artifacts.db) {
    wechat.db?.close()
    artifacts.db?.close()
    throw new Error('database_unavailable')
  }
  const sourceFingerprint = wechatSourceFingerprint(
    wechat.db,
    sourceFileIdentity(wechat.resolution.selectedPath),
  )
  const search = createRuntimeSearch({
    wechatDb: wechat.db, projectRoot, sourceFingerprint, config: request.config, signal,
  })
  const accountRootProvider = createArtifactAccountRootProvider({ projectRoot })
  const resolver = createArtifactSourceResolver({ assetDb: artifacts.db, accountRootProvider })
  const links = createLinkPreviewService({ cacheDir: path.join(projectRoot, 'work', 'link-preview-cache') })
  const registry = createToolRegistry({
    wechatDb: wechat.db,
    artifactDb: artifacts.db,
    searchMessages: search.search,
    readDocument: (assetId, maxCharacters) => readDocument(resolver, { assetId, maxCharacters }),
    resolveLinkPreview: (assetId, url) => links.resolve(assetId, url),
  })
  try {
    const upstream = createOpenAIUpstream(request.config)
    if (request.config.contextStrategy === 'summary') {
      emit({ type: 'step', step: 0, label: '校验较早对话摘要' })
    }
    const prepared = await prepareHistoryContext({
      requested: request.config.contextStrategy,
      history: request.history,
      summary: request.summary,
      contextWindow: request.config.contextWindow,
      upstream,
      signal,
    })
    return await runAgent({
      question: request.question,
      conversationId: request.conversationId,
      conversationName: request.conversationName,
      anchorMessageUid: request.anchorMessageUid,
      strategy: prepared.strategy,
      history: prepared.history,
      summary: prepared.summary,
      summaryReason: prepared.reason,
      registry,
      upstream,
      emit,
      signal,
    })
  } finally {
    search.close()
    artifacts.db.close()
    wechat.db.close()
  }
}

let rebuildActive = false

export async function rebuildSearchIndexRuntime(
  config: AgentRequestConfig,
  signal: AbortSignal,
  projectRoot = root,
) {
  if (rebuildActive) throw new Error('index_rebuild_active')
  rebuildActive = true
  const opened = openValidatedWechatDatabase(projectRoot)
  try {
    if (!opened.db) throw new Error('database_unavailable')
    const fingerprint = wechatSourceFingerprint(opened.db, sourceFileIdentity(opened.resolution.selectedPath))
    const dataDir = path.join(projectRoot, 'data')
    return await buildSearchIndex({
      sourceDb: opened.db,
      sourceFingerprint: fingerprint,
      currentPath: path.join(dataDir, 'ai-index.current.db'),
      stagingPath: path.join(dataDir, `ai-index.staging-${process.pid}-${Date.now()}.db`),
      ...(config.embedding.enabled ? { embedding: {
        baseURL: config.embedding.baseURL,
        apiKey: config.embedding.apiKey || config.apiKey,
        model: config.embedding.model,
        dimensions: config.embedding.dimensions,
        batchSize: config.embedding.batchSize,
      } } : {}),
      signal,
    })
  } finally {
    opened.db?.close()
    rebuildActive = false
  }
}
