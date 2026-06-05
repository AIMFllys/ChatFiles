import { useEffect, useMemo, useState } from 'react'
import { BookOpenText, CheckCircle2, ShieldCheck } from 'lucide-react'
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
import { CONFIG_NAV, PRIMARY_NAV, TAB_TITLES, type Tab } from './boards/navConfig'
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
    setFileMode(file.storage)
    setFilter(file.name)
    setActiveTab('files')
  }

  const heading = TAB_TITLES[activeTab]
  const fullBleed = activeTab === 'overview' || activeTab === 'academics'

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
          <BookOpenText size={22} />
        </div>
        {renderNav(PRIMARY_NAV, '成果')}
        <div className="rail-div" />
        {renderNav(CONFIG_NAV, '配置')}
      </aside>

      <section className="workspace">
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
