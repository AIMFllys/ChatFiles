import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import type {
  ChatClueDossier,
  ChatSummary,
  ChatSynthesis,
  DatabaseAnalysis,
  InsightSummary,
  InsightsResponse,
  KnowledgeBase,
  LibraryManifest,
  Overview,
  SourceFileManifest,
  ValueCandidateIndex,
} from './types'
import { CONFIG_SUB, CONFIG_TAB_IDS, LOWER_NAV, PRIMARY_NAV, TAB_TITLES, type Tab } from './boards/navConfig'
import OverviewBoard from './boards/Overview'
import ChatBoard from './boards/Chat'
import InsightsBoard from './boards/Insights'
import AcademicsBoard from './boards/Academics'
import FilesBoard from './boards/Files'
import AISettings from './boards/AISettings'
import { ChatClueReader } from './components/workbenches/ChatClueReader'
import { ChatSynthesisReader } from './components/workbenches/ChatSynthesisReader'
import { DatabaseWorkbench } from './components/workbenches/DatabaseWorkbench'
import { KnowledgeReader } from './components/workbenches/KnowledgeReader'
import { MediaReview } from './components/workbenches/MediaReview'
import { SummaryReader } from './components/workbenches/SummaryReader'
import { ValueCandidateWorkbench } from './components/workbenches/ValueCandidateWorkbench'
import {
  emptyChatSynthesis,
  emptyClueDossier,
  emptyDatabaseAnalysis,
  emptyInsights,
  emptyKnowledge,
  emptyManifest,
  emptyOverview,
  emptySourceManifest,
  emptySummary,
  emptyValueCandidates,
} from './utils/constants'
import { loadAIConfig, type AIConfig } from './utils/aiConfig'
import type { BrowsableFile } from './utils/tree'
import './App.css'

function App() {
  const [manifest, setManifest] = useState<LibraryManifest>(emptyManifest)
  const [sourceManifest, setSourceManifest] = useState<SourceFileManifest>(emptySourceManifest)
  const [knowledge, setKnowledge] = useState<KnowledgeBase>(emptyKnowledge)
  const [summary, setSummary] = useState<ChatSummary>(emptySummary)
  const [clueDossier, setClueDossier] = useState<ChatClueDossier>(emptyClueDossier)
  const [chatSynthesis, setChatSynthesis] = useState<ChatSynthesis>(emptyChatSynthesis)
  const [databaseAnalysis, setDatabaseAnalysis] = useState<DatabaseAnalysis>(emptyDatabaseAnalysis)
  const [valueCandidates, setValueCandidates] = useState<ValueCandidateIndex>(emptyValueCandidates)
  const [overview, setOverview] = useState<Overview>(emptyOverview)
  const [insights, setInsights] = useState<InsightsResponse>(emptyInsights)
  const [aiConfig, setAiConfig] = useState<AIConfig>(loadAIConfig)
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [lastConfig, setLastConfig] = useState<Tab>('summary')
  const [fileMode, setFileMode] = useState<'archive' | 'source'>('archive')
  const [selected, setSelected] = useState<BrowsableFile>()
  const [filter, setFilter] = useState('')

  useEffect(() => {
    fetch('/api/overview').then((res) => res.json()).then(setOverview).catch(() => setOverview(emptyOverview))
    fetch('/api/insights').then((res) => res.json()).then(setInsights).catch(() => setInsights(emptyInsights))
    fetch('/api/library').then((res) => res.json()).then(setManifest).catch(() => setManifest(emptyManifest))
    fetch('/api/source-library').then((res) => res.json()).then(setSourceManifest).catch(() => setSourceManifest(emptySourceManifest))
    fetch('/api/knowledge').then((res) => res.json()).then(setKnowledge).catch(() => setKnowledge(emptyKnowledge))
    fetch('/api/summary').then((res) => res.json()).then(setSummary).catch(() => setSummary(emptySummary))
    fetch('/api/chat-clues').then((res) => res.json()).then(setClueDossier).catch(() => setClueDossier(emptyClueDossier))
    fetch('/api/chat-synthesis').then((res) => res.json()).then(setChatSynthesis).catch(() => setChatSynthesis(emptyChatSynthesis))
    fetch('/api/database-analysis').then((res) => res.json()).then(setDatabaseAnalysis).catch(() => setDatabaseAnalysis(emptyDatabaseAnalysis))
    fetch('/api/value-candidates').then((res) => res.json()).then(setValueCandidates).catch(() => setValueCandidates(emptyValueCandidates))
  }, [])

  const summariesByConvId = useMemo(() => {
    const map = new Map<string, InsightSummary>()
    for (const s of insights.summaries) map.set(s.convId, s)
    return map
  }, [insights.summaries])

  const openMatchedFile = (file: BrowsableFile) => {
    setSelected(file)
    if (file.storage !== 'artifact') setFileMode(file.storage)
    setFilter(file.name)
    setActiveTab('files')
  }

  const heading = TAB_TITLES[activeTab]
  const fullBleed = activeTab === 'overview' || activeTab === 'academics' || activeTab === 'chat'
  const isConfig = CONFIG_TAB_IDS.includes(activeTab)
  const workspaceClass = [
    'workspace',
    isConfig ? 'cfg' : '',
    activeTab === 'chat' ? 'chat-workspace' : '',
  ].filter(Boolean).join(' ')

  const renderNav = (items: typeof PRIMARY_NAV, label: string) => (
    <nav className={`rail-nav${label === '配置' ? ' secondary' : ''}`} aria-label={label}>
      {items.map((item) => (
        <button
          key={item.id}
          className={activeTab === item.id ? 'rail-button active' : 'rail-button'}
          onClick={() => setActiveTab(item.id)}
          title={item.label}
          type="button"
        >
          {item.icon}
          <span className="rail-label">{item.label}</span>
        </button>
      ))}
    </nav>
  )

  return (
    <main className="app-shell">
      <aside className="left-rail">
        <div className="brand-mark" title="午夜书斋">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="currentColor" width="28" height="28">
            <path d="M32 3 Q32 10 39 10 Q32 10 32 17 Q32 10 25 10 Q32 10 32 3 Z" />
            <path d="M19 12 Q19 15 22 15 Q19 15 19 18 Q19 15 16 15 Q19 15 19 12 Z" opacity="0.8" />
            <path d="M45 8 Q45 11 48 11 Q45 11 45 14 Q45 11 42 11 Q45 11 45 8 Z" opacity="0.8" />
            <path d="M10 45 C17 42 24 42 29 46" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
            <path d="M54 45 C47 42 40 42 35 46" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
            <path d="M30 24 C24 20 17 20 12 23 C11.4 23.3 11 23.9 11 24.5 L11 42.5 C11 43.4 11.8 44 12.6 43.8 C17.6 42.5 24 42.5 29.4 44.3 C29.8 44.4 30 44.2 30 43.8 Z" />
            <path d="M34 24 C40 20 47 20 52 23 C52.6 23.3 53 23.9 53 24.5 L53 42.5 C53 43.4 52.2 44 51.4 43.8 C46.4 42.5 40 42.5 34.6 44.3 C34.2 44.4 34 44.2 34 43.8 Z" />
            <path d="M31 22 L31 51 L32 49 L33 51 L33 22 Z" opacity="0.9" />
          </svg>
        </div>
        {renderNav(PRIMARY_NAV, '成果')}
        <div className="rail-div" />
        <nav className="rail-nav secondary" aria-label="配置">
          <button
            className={isConfig ? 'rail-button active' : 'rail-button'}
            onClick={() => setActiveTab(lastConfig)}
            title="配置"
            type="button"
          >
            <SlidersHorizontal size={20} />
            <span className="rail-label">配置</span>
          </button>
          {LOWER_NAV.map((item) => (
            <button
              key={item.id}
              className={activeTab === item.id ? 'rail-button active' : 'rail-button'}
              onClick={() => setActiveTab(item.id)}
              title={item.label}
              type="button"
            >
              {item.icon}
              <span className="rail-label">{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <section className={workspaceClass}>
        {!fullBleed && (
          <header className="topbar">
            <div>
              <p className="eyebrow">{heading.eyebrow}</p>
              <h1>{heading.title}</h1>
            </div>
            <div className="status-pill">
              <ShieldCheck size={16} />
              原始文件保留
            </div>
          </header>
        )}

        {isConfig && (
          <div className="config-subnav" role="tablist" aria-label="配置板块">
            {CONFIG_SUB.map((item) => (
              <button
                key={item.id}
                className={activeTab === item.id ? 'on' : ''}
                onClick={() => {
                  setActiveTab(item.id)
                  setLastConfig(item.id)
                }}
                type="button"
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        )}

        {activeTab === 'overview' ? (
          <OverviewBoard overview={overview} onGoto={(t) => setActiveTab(t)} />
        ) : activeTab === 'chat' ? (
          <ChatBoard summariesByConvId={summariesByConvId} aiConfig={aiConfig} onGotoSettings={() => setActiveTab('ai')} />
        ) : activeTab === 'insights' ? (
          <InsightsBoard insights={insights} />
        ) : activeTab === 'academics' ? (
          <AcademicsBoard insights={insights} knowledge={knowledge} />
        ) : activeTab === 'files' ? (
          <FilesBoard
            manifest={manifest}
            sourceManifest={sourceManifest}
            fileMode={fileMode}
            setFileMode={setFileMode}
            selected={selected}
            setSelected={setSelected}
            filter={filter}
            setFilter={setFilter}
          />
        ) : activeTab === 'ai' ? (
          <AISettings config={aiConfig} onChange={setAiConfig} />
        ) : activeTab === 'summary' ? (
          <SummaryReader summary={summary} />
        ) : activeTab === 'clues' ? (
          <ChatClueReader dossier={clueDossier} sourceManifest={sourceManifest} manifest={manifest} onOpenFile={openMatchedFile} />
        ) : activeTab === 'synthesis' ? (
          <ChatSynthesisReader synthesis={chatSynthesis} />
        ) : activeTab === 'media' ? (
          <MediaReview manifest={manifest} onOpenFile={openMatchedFile} />
        ) : activeTab === 'databases' ? (
          <DatabaseWorkbench analysis={databaseAnalysis} sourceManifest={sourceManifest} onOpenFile={openMatchedFile} />
        ) : activeTab === 'candidates' ? (
          <ValueCandidateWorkbench index={valueCandidates} sourceManifest={sourceManifest} onOpenFile={openMatchedFile} />
        ) : (
          <>
            <section className="source-strip">
              {knowledge.sourceStatus.map((item) => (
                <div className={`source-card ${item.status}`} key={item.source}>
                  <CheckCircle2 size={18} />
                  <strong>{item.source}</strong>
                  <p>{item.detail}</p>
                </div>
              ))}
            </section>
            <KnowledgeReader sections={knowledge.sections} />
          </>
        )}
      </section>
    </main>
  )
}

export default App
