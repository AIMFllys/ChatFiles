import { useEffect, useMemo, useRef, useState } from 'react'
import type { InsightSummary, WechatConversation, WechatConversationList } from '../../types'
import type { AIConfig } from '../../utils/aiConfig'
import { AIChatDock } from '../../components/ai/AIChatDock'
import { ArtifactWorkspace } from './ArtifactWorkspace'
import { ConversationSidebar } from './ConversationSidebar'
import type { ChatLibrarySelection } from './artifactModel'
import {
  parsePinnedConversationIds,
  serializePinnedConversationIds,
  togglePinnedConversation,
} from './pins'
import {
  parseSidebarCollapsed,
  serializeSidebarCollapsed,
  SIDEBAR_COLLAPSED_KEY,
} from './sidebarState'

const PIN_STORAGE_KEY = 'chatfiles.chat-library.pins'

export function ChatLibrary({
  summariesByConvId,
  aiConfig,
  onGotoSettings,
}: {
  summariesByConvId: Map<string, InsightSummary>
  aiConfig: AIConfig
  onGotoSettings: () => void
}) {
  const [conversationList, setConversationList] = useState<WechatConversationList>({
    conversations: [],
    totals: { conversations: 0, messages: 0 },
  })
  const [loading, setLoading] = useState(true)
  const [selection, setSelection] = useState<ChatLibrarySelection>({ kind: 'collection', id: 'outputs' })
  const [pinnedIds, setPinnedIds] = useState<string[]>([])
  const [pinsReady, setPinsReady] = useState(false)
  const [mobilePane, setMobilePane] = useState<'sidebar' | 'workspace'>('sidebar')
  const [dockConversation, setDockConversation] = useState<WechatConversation>()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => (
    parseSidebarCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY))
  ))
  const selectedControlRef = useRef<HTMLButtonElement>(null)
  const workspaceTitleRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/wechat/conversations', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('conversation-list-unavailable')
        return response.json() as Promise<WechatConversationList>
      })
      .then((data) => {
        const validIds = new Set(data.conversations.map((conversation) => conversation.id))
        setConversationList(data)
        setPinnedIds(parsePinnedConversationIds(localStorage.getItem(PIN_STORAGE_KEY), validIds))
        setPinsReady(true)
        setLoading(false)
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setPinsReady(true)
        setLoading(false)
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (pinsReady) localStorage.setItem(PIN_STORAGE_KEY, serializePinnedConversationIds(pinnedIds))
  }, [pinnedIds, pinsReady])

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, serializeSidebarCollapsed(sidebarCollapsed))
  }, [sidebarCollapsed])

  const selectedConversation = useMemo(() => (
    selection.kind === 'conversation'
      ? conversationList.conversations.find((conversation) => conversation.id === selection.id)
      : undefined
  ), [conversationList.conversations, selection])

  const select = (next: ChatLibrarySelection) => {
    setSelection(next)
    setDockConversation(undefined)
    setMobilePane('workspace')
    if (window.matchMedia('(max-width: 760px)').matches) {
      requestAnimationFrame(() => workspaceTitleRef.current?.focus())
    }
  }

  const showSidebar = () => {
    setMobilePane('sidebar')
    requestAnimationFrame(() => selectedControlRef.current?.focus())
  }

  const togglePin = (conversationId: string) => {
    setPinnedIds((current) => togglePinnedConversation(current, conversationId))
  }

  return (
    <section
      className="chat-library"
      data-mobile-pane={mobilePane}
      data-sidebar-collapsed={sidebarCollapsed}
    >
      <ConversationSidebar
        collapsed={sidebarCollapsed}
        conversations={conversationList.conversations}
        loading={loading}
        pinnedIds={pinnedIds}
        selectedControlRef={selectedControlRef}
        selection={selection}
        summariesByConvId={summariesByConvId}
        onSelect={select}
        onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
        onTogglePin={togglePin}
      />
      <ArtifactWorkspace
        key={`${selection.kind}:${selection.id}`}
        selection={selection}
        conversation={selectedConversation}
        pinned={selectedConversation ? pinnedIds.includes(selectedConversation.id) : false}
        titleRef={workspaceTitleRef}
        onBack={showSidebar}
        onTogglePin={() => selectedConversation && togglePin(selectedConversation.id)}
        onAnalyze={() => selectedConversation && setDockConversation(selectedConversation)}
      />
      {dockConversation && (
        <AIChatDock
          key={dockConversation.id}
          convId={dockConversation.id}
          convName={dockConversation.display}
          config={aiConfig}
          onClose={() => setDockConversation(undefined)}
          onGotoSettings={onGotoSettings}
        />
      )}
    </section>
  )
}
