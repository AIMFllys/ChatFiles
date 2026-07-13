import { Router } from 'express'
import path from 'node:path'
import type { ChatClueDossier, ChatSynthesis, DatabaseAnalysis, ValueCandidateIndex } from '../../shared/contracts/index.js'
import { library, readJson, root, sourceLibrary } from '../utils/helpers.js'

const router = Router()

router.get('/api/library', (_req, res) => {
  res.json(library())
})

router.get('/api/source-library', (_req, res) => {
  res.json(sourceLibrary())
})

router.get('/api/knowledge', (_req, res) => {
  res.json(readJson(path.join(root, 'data', 'knowledge.json'), {
    generatedAt: new Date(0).toISOString(),
    sourceStatus: [],
    coursePlan: [],
    sections: [],
  }))
})

router.get('/api/summary', (_req, res) => {
  res.json(readJson(path.join(root, 'data', 'summary.json'), {
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
  res.json(readJson<ChatClueDossier>(path.join(root, 'data', 'chat-clue-dossier.json'), {
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
  res.json(readJson<ChatSynthesis>(path.join(root, 'data', 'chat-synthesis.json'), {
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
  res.json(readJson<DatabaseAnalysis>(path.join(root, 'data', 'database-analysis.json'), {
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
  res.json(readJson<ValueCandidateIndex>(path.join(root, 'data', 'value-candidates.json'), {
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

export default router
