import path from 'node:path'
import type { AgentRequestConfig } from '../../shared/contracts/aiAgent.js'
import { readActiveProductSet } from '../data/catalogReader.js'
import { openCatalogArtifactDatabase, openCatalogWechatDatabase } from '../data/productDatabases.js'
import { createArtifactAccountRootProvider, createArtifactSourceResolver } from '../wechat/artifactSourceResolver.js'
import { root } from '../utils/helpers.js'
import { createLinkPreviewService } from './linkPreview/linkPreviewService.js'
import { readDocument } from './documents/readDocument.js'
import { createRuntimeSearch } from './search/searchRuntime.js'
import { inspectSearchIndexStatus } from './search/searchSchema.js'
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
      const active = readActiveProductSet(projectRoot)
      const readActive = () => active
      const wechat = openCatalogWechatDatabase(projectRoot, readActive)
      const artifacts = openCatalogArtifactDatabase(projectRoot, readActive)
      const result = {
        name: '午夜书斋本地只读接口', version: 2,
        wechat: wechat.db ? 'ready' as const : 'unavailable' as const,
        artifacts: artifacts.db ? 'ready' as const : 'unavailable' as const,
        catalog: active.status.catalog,
        products: active.status.products,
        derived: { search: inspectSearchIndexStatus(
          path.join(projectRoot, 'data', 'ai-index.current.db'),
          active.status.products.wechat.fingerprint,
        ) },
      }
      wechat.db?.close()
      artifacts.db?.close()
      return result
    },
    async execute(name, input) {
      const active = readActiveProductSet(projectRoot)
      const readActive = () => active
      const wechat = openCatalogWechatDatabase(projectRoot, readActive)
      const artifacts = openCatalogArtifactDatabase(projectRoot, readActive)
      if (!wechat.db || !artifacts.db) {
        wechat.db?.close()
        artifacts.db?.close()
        throw new LocalAccessError('database_unavailable')
      }
      const fingerprint = active.status.products.wechat.fingerprint
      if (!fingerprint) {
        artifacts.db.close()
        wechat.db.close()
        throw new LocalAccessError('database_unavailable')
      }
      const search = createRuntimeSearch({
        wechatDb: wechat.db, projectRoot, sourceFingerprint: fingerprint, config: localSearchConfig,
      })
      const accountRootProvider = createArtifactAccountRootProvider({ projectRoot })
      const resolver = createArtifactSourceResolver({
        assetDb: artifacts.db,accountRootProvider,bundleRoot: artifacts.bundleRoot ?? undefined,
      })
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
