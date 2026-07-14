import { Router } from 'express'
import path from 'node:path'
import type { ChatClueDossier, ChatSynthesis, DatabaseAnalysis, ValueCandidateIndex } from '../../shared/contracts/index.js'
import { library, readJson, root, sourceLibrary } from '../utils/helpers.js'

export function createDataRouter(projectRoot = root) {
  const router = Router()

router.get('/api/library', (_req, res) => {
  try { return res.json(library(projectRoot)) }
  catch { return res.status(503).json({ error: 'Request failed',code: 'data_product_unavailable' }) }
})

router.get('/api/source-library', (_req, res) => {
  res.json(sourceLibrary(projectRoot))
})

router.get('/api/knowledge', (_req, res) => {
  res.json(readJson(path.join(projectRoot, 'data', 'knowledge.json'), {
    generatedAt: new Date(0).toISOString(),
    sourceStatus: [],
    coursePlan: [],
    sections: [],
  }))
})

router.get('/api/summary', (_req, res) => {
  res.json(readJson(path.join(projectRoot, 'data', 'summary.json'), {
    generatedAt: new Date(0).toISOString(),
    coverage: {
      archivedFiles: 0,
      archivedBytes: 0,
      sourceRoots: 0,
      directoryCount: 0,
      databaseCandidates: 0,
      readableDatabases: 0,
      textExtracts: 0,
    },
    boards: [],
    textExtracts: [],
  }))
})

router.get('/api/chat-clues', (_req, res) => {
  res.json(readJson<ChatClueDossier>(path.join(projectRoot, 'data', 'chat-clue-dossier.json'), {
    generatedAt: new Date(0).toISOString(),
    totals: {
      groups: 0,
      snippets: 0,
      highValueGroups: 0,
      chatExportMessages: 0,
      bySourceType: {},
      bySourceApp: {},
      bySignal: {},
    },
    groups: [],
  }))
})

router.get('/api/chat-synthesis', (_req, res) => {
  res.json(readJson<ChatSynthesis>(path.join(projectRoot, 'data', 'chat-synthesis.json'), {
    generatedAt: new Date(0).toISOString(),
    totals: {
      groups: 0,
      snippets: 0,
      highValueGroups: 0,
      confirmedConversations: 0,
      sourceOnlyGroups: 0,
      technicalGroups: 0,
      academicGroups: 0,
      philosophyGroups: 0,
    },
    sections: [],
  }))
})

router.get('/api/database-analysis', (_req, res) => {
  res.json(readJson<DatabaseAnalysis>(path.join(projectRoot, 'data', 'database-analysis.json'), {
    generatedAt: new Date(0).toISOString(),
    totals: {
      readableDatabases: 0,
      unreadableDatabases: 0,
      analyzedTables: 0,
      suspectedMessageTables: 0,
      textSamples: 0,
    },
    databases: [],
  }))
})

router.get('/api/value-candidates', (_req, res) => {
  res.json(readJson<ValueCandidateIndex>(path.join(projectRoot, 'data', 'value-candidates.json'), {
    generatedAt: new Date(0).toISOString(),
    totals: {
      sourceFiles: 0,
      archivedFiles: 0,
      unarchivedFiles: 0,
      representedByArchive: 0,
      duplicateCandidatesSkipped: 0,
      candidates: 0,
      high: 0,
      medium: 0,
      low: 0,
    },
    byBucket: {},
    byPreview: {},
    candidates: [],
  }))
})

  return router
}

export default createDataRouter()
