import path from 'node:path'
import type { AgentRequestConfig } from '../../src/types/aiAgent.js'
import { openValidatedArtifactDatabase } from '../wechat/artifactDatabase.js'
import { createArtifactAccountRootProvider, createArtifactSourceResolver } from '../wechat/artifactSourceResolver.js'
import { openValidatedWechatDatabase } from '../wechat/databaseOpener.js'
import { root } from '../utils/helpers.js'
import { createLinkPreviewService } from './linkPreview/linkPreviewService.js'
import { readDocument } from './documents/readDocument.js'
import { createRuntimeSearch } from './search/searchRuntime.js'
import { sourceFileIdentity, wechatSourceFingerprint } from './search/sourceFingerprint.js'
import { createToolRegistry } from './agent/toolRegistry.js'
import { createLocalAccessService, LocalAccessError, type LocalAccessBackend } from './localAccess.js'

const localSearchConfig: AgentRequestConfig = {
  baseURL: 'http://127.0.0.1', apiKey: '', model: 'local-access', temperature: 0,
  contextWindow: 8_000, contextStrategy: 'recent',
  embedding: {
    enabled: false, baseURL: 'http://127.0.0.1', apiKey: '', model: 'disabled', dimensions: 1, batchSize: 1,
  },
}

function runtimeBackend(projectRoot: string): LocalAccessBackend {
  return {
    async status() {
      const wechat = openValidatedWechatDatabase(projectRoot)
      const artifacts = openValidatedArtifactDatabase(projectRoot)
      const result = {
        name: '午夜书斋本地只读接口', version: 1,
        wechat: wechat.db ? 'ready' as const : 'unavailable' as const,
        artifacts: artifacts.db ? 'ready' as const : 'unavailable' as const,
      }
      wechat.db?.close()
      artifacts.db?.close()
      return result
    },
    async execute(name, input) {
      const wechat = openValidatedWechatDatabase(projectRoot)
      const artifacts = openValidatedArtifactDatabase(projectRoot)
      if (!wechat.db || !artifacts.db) {
        wechat.db?.close()
        artifacts.db?.close()
        throw new LocalAccessError('database_unavailable')
      }
      const fingerprint = wechatSourceFingerprint(wechat.db, sourceFileIdentity(wechat.resolution.selectedPath))
      const search = createRuntimeSearch({
        wechatDb: wechat.db, projectRoot, sourceFingerprint: fingerprint, config: localSearchConfig,
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
        return await registry.execute(name, input)
      } finally {
        search.close()
        artifacts.db.close()
        wechat.db.close()
      }
    },
  }
}

export function createRuntimeLocalAccessService(projectRoot = root) {
  return createLocalAccessService(runtimeBackend(projectRoot))
}
