import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react'
import {
  ArrowLeft,
  Bot,
  FileText,
  FolderOpen,
  Link2,
  MessageSquareText,
  Pin,
  PinOff,
  Search,
  Shapes,
  Wrench,
} from 'lucide-react'
import type {
  ChatArtifactCounts,
  ChatArtifactListItem,
  ChatArtifactPage,
  ChatArtifactTab,
  WechatConversation,
} from '../../types'
import { useGridVirtualizer } from '../../hooks/useGridVirtualizer'
import { ArtifactCard } from './ArtifactCard'
import { ArtifactPreviewDialog } from './ArtifactPreviewDialog'
import {
  artifactRequestUrl,
  nextArtifactTab,
  safeExternalUrl,
  type ChatLibrarySelection,
} from './artifactModel'
import { canLoadMoreArtifacts, isArtifactPageRequestCurrent } from './artifactPagination'

const PAGE_SIZE = 120
const emptyCounts: ChatArtifactCounts = {
  all: 0,
  work: 0,
  document: 0,
  skill: 0,
  link: 0,
  chatText: 0,
}

const tabs: Array<{ id: ChatArtifactTab; label: string; icon: typeof Shapes }> = [
  { id: 'all', label: '全部', icon: Shapes },
  { id: 'work', label: '作品', icon: FolderOpen },
  { id: 'document', label: '文档', icon: FileText },
  { id: 'skill', label: 'Skills 工具', icon: Wrench },
  { id: 'link', label: '链接', icon: Link2 },
  { id: 'chatText', label: '聊天文字', icon: MessageSquareText },
]

function selectionTitle(selection: ChatLibrarySelection, conversation?: WechatConversation) {
  if (selection.kind === 'conversation') return conversation?.display ?? '会话素材'
  return selection.id === 'library' ? '我的素材库' : '全部产出'
}

function mergeUnique(current: ChatArtifactListItem[], incoming: ChatArtifactListItem[]) {
  const ids = new Set(current.map((item) => item.id))
  return [...current, ...incoming.filter((item) => !ids.has(item.id))]
}

export function ArtifactWorkspace({
  selection,
  conversation,
  pinned,
  onBack,
  onTogglePin,
  onAnalyze,
  titleRef,
}: {
  selection: ChatLibrarySelection
  conversation?: WechatConversation
  pinned: boolean
  onBack: () => void
  onTogglePin: () => void
  onAnalyze: () => void
  titleRef: Ref<HTMLHeadingElement>
}) {
  const [tab, setTab] = useState<ChatArtifactTab>(selection.kind === 'collection' && selection.id === 'library' ? 'work' : 'all')
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query.trim())
  const [items, setItems] = useState<ChatArtifactListItem[]>([])
  const [counts, setCounts] = useState<ChatArtifactCounts>(emptyCounts)
  const [matchingTotal, setMatchingTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [loadMoreError, setLoadMoreError] = useState('')
  const [previewItem, setPreviewItem] = useState<ChatArtifactListItem>()
  const scrollRef = useRef<HTMLDivElement>(null)
  const loadMoreControllerRef = useRef<AbortController | null>(null)
  const activeRequestScope = artifactRequestUrl({
    selection,
    tab,
    query: query.trim(),
    offset: 0,
    limit: PAGE_SIZE,
  })
  const activeRequestScopeRef = useRef(activeRequestScope)

  useLayoutEffect(() => {
    activeRequestScopeRef.current = activeRequestScope
    return () => loadMoreControllerRef.current?.abort()
  }, [activeRequestScope])

  useEffect(() => {
    const controller = new AbortController()
    const requestScope = artifactRequestUrl({
      selection,
      tab,
      query: deferredQuery,
      offset: 0,
      limit: PAGE_SIZE,
    })
    fetch(requestScope, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('artifact-page-unavailable')
        return response.json() as Promise<ChatArtifactPage>
      })
      .then((page) => {
        if (!isArtifactPageRequestCurrent(requestScope, activeRequestScopeRef.current)) return
        setItems(page.items)
        setCounts(page.counts)
        setMatchingTotal(page.matchingTotal)
        setLoadMoreError('')
        setLoadingMore(false)
        setLoading(false)
        scrollRef.current?.scrollTo({ top: 0 })
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        if (!isArtifactPageRequestCurrent(requestScope, activeRequestScopeRef.current)) return
        setItems([])
        setMatchingTotal(0)
        setLoadMoreError('')
        setLoadingMore(false)
        setError('素材索引暂时无法读取')
        setLoading(false)
      })
    return () => controller.abort()
  }, [deferredQuery, selection, tab])

  const loadMore = useCallback(() => {
    if (error || !canLoadMoreArtifacts({
      loading,
      loadingMore,
      loadMoreError,
      itemCount: items.length,
      matchingTotal,
    })) return

    const requestScope = activeRequestScope
    const controller = new AbortController()
    loadMoreControllerRef.current?.abort()
    loadMoreControllerRef.current = controller
    setLoadingMore(true)
    setLoadMoreError('')
    const url = artifactRequestUrl({
      selection,
      tab,
      query: deferredQuery,
      offset: items.length,
      limit: PAGE_SIZE,
    })
    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('artifact-page-unavailable')
        return response.json() as Promise<ChatArtifactPage>
      })
      .then((page) => {
        if (!isArtifactPageRequestCurrent(requestScope, activeRequestScopeRef.current)) return
        setItems((current) => mergeUnique(current, page.items))
        setMatchingTotal(page.matchingTotal)
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        if (!isArtifactPageRequestCurrent(requestScope, activeRequestScopeRef.current)) return
        setLoadMoreError('无法继续载入素材')
      })
      .finally(() => {
        if (loadMoreControllerRef.current === controller) loadMoreControllerRef.current = null
        if (isArtifactPageRequestCurrent(requestScope, activeRequestScopeRef.current)) {
          setLoadingMore(false)
        }
      })
  }, [activeRequestScope, deferredQuery, error, items.length, loadMoreError, loading, loadingMore, matchingTotal, selection, tab])

  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const onScroll = () => {
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 640) loadMore()
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [loadMore])

  const virtual = useGridVirtualizer(scrollRef, items.length, {
    minCol: tab === 'chatText' ? 280 : 220,
    rowH: 278,
    gap: 14,
    padX: 20,
    padY: 20,
    overscan: 3,
  })
  const visibleItems = useMemo(() => items.slice(virtual.start, virtual.end), [items, virtual.end, virtual.start])
  const title = selectionTitle(selection, conversation)
  const openItem = (item: ChatArtifactListItem) => {
    if (item.itemType === 'artifact' && item.category === 'link' && item.url) {
      const externalUrl = safeExternalUrl(item.url)
      if (externalUrl) {
        window.open(externalUrl, '_blank', 'noopener,noreferrer')
        return
      }
    }
    setPreviewItem(item)
  }

  return (
    <section className="artifact-workspace">
      <header className="artifact-workspace-header">
        <div className="workspace-title-row">
          <button className="mobile-back" onClick={onBack} title="返回会话列表" type="button"><ArrowLeft size={19} /></button>
          <span className={`workspace-avatar ${conversation?.is_group ? 'is-group' : ''}`}>
            {title.trim().slice(0, 1) || '库'}
          </span>
          <div className="workspace-title">
            <small>{selection.kind === 'conversation' ? (conversation?.is_group ? '群聊素材' : '私聊素材') : '跨会话资料库'}</small>
            <h1 ref={titleRef} tabIndex={-1}>{title}</h1>
          </div>
          <div className="workspace-actions">
            {selection.kind === 'conversation' && (
              <>
                <button aria-label={pinned ? '取消置顶' : '置顶会话'} aria-pressed={pinned} onClick={onTogglePin} title={pinned ? '取消置顶' : '置顶会话'} type="button">
                  {pinned ? <PinOff size={18} /> : <Pin size={18} />}
                </button>
                <button aria-label="AI 分析会话" onClick={onAnalyze} title="AI 分析" type="button"><Bot size={19} /></button>
              </>
            )}
          </div>
        </div>

        <div className="artifact-stats" aria-label="素材统计">
          <span><strong>{counts.all.toLocaleString()}</strong> 产出</span>
          <span className="stat-work">作品 <strong>{counts.work.toLocaleString()}</strong></span>
          <span className="stat-document">文档 <strong>{counts.document.toLocaleString()}</strong></span>
          <span className="stat-skill">Skills <strong>{counts.skill.toLocaleString()}</strong></span>
          <span className="stat-link">链接 <strong>{counts.link.toLocaleString()}</strong></span>
          <span className="stat-text">文字 <strong>{counts.chatText.toLocaleString()}</strong></span>
        </div>

        <div className="artifact-controls">
          <div className="artifact-tabs" role="tablist" aria-label="素材分类">
            {tabs.map((item) => {
              const Icon = item.icon
              return (
                <button
                  aria-controls="artifact-tab-panel"
                  aria-selected={tab === item.id}
                  className={tab === item.id ? 'is-active' : ''}
                  id={`artifact-tab-${item.id}`}
                  key={item.id}
                  onKeyDown={(event) => {
                    const next = nextArtifactTab(tab, event.key)
                    if (next === tab && !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                    event.preventDefault()
                    if (next !== tab) {
                      setLoading(true)
                      setError('')
                      setTab(next)
                    }
                    requestAnimationFrame(() => document.getElementById(`artifact-tab-${next}`)?.focus())
                  }}
                  onClick={() => {
                    setLoading(true)
                    setLoadingMore(false)
                    setError('')
                    setLoadMoreError('')
                    setTab(item.id)
                  }}
                  role="tab"
                  tabIndex={tab === item.id ? 0 : -1}
                  type="button"
                >
                  <Icon size={16} /><span>{item.label}</span><strong>{counts[item.id].toLocaleString()}</strong>
                </button>
              )
            })}
          </div>
          <label className="artifact-search">
            <Search size={16} aria-hidden="true" />
            <input
              aria-label="检索当前素材"
              maxLength={200}
              onChange={(event) => {
                setLoading(true)
                setLoadingMore(false)
                setError('')
                setLoadMoreError('')
                setQuery(event.target.value)
              }}
              placeholder="检索当前素材"
              value={query}
            />
          </label>
        </div>
      </header>

      <div
        aria-labelledby={`artifact-tab-${tab}`}
        className="artifact-scroll"
        id="artifact-tab-panel"
        ref={scrollRef}
        role="tabpanel"
      >
        {loading ? (
          <div className="artifact-empty"><span className="library-loader" /><p>正在载入...</p></div>
        ) : error && items.length === 0 ? (
          <div className="artifact-empty"><p>{error}</p></div>
        ) : items.length === 0 ? (
          <div className="artifact-empty"><Shapes size={34} /><p>当前分类没有匹配内容</p></div>
        ) : (
          <div className="artifact-virtual-space" style={{ height: virtual.totalHeight }}>
            <div
              className="artifact-grid-window"
              style={{
                gridTemplateColumns: `repeat(${virtual.cols}, minmax(0, 1fr))`,
                transform: `translateY(${virtual.translateY}px)`,
              }}
            >
              {visibleItems.map((item) => (
                <ArtifactCard item={item} key={item.id} onOpen={openItem} />
              ))}
            </div>
          </div>
        )}
        {loadingMore && <div className="artifact-loading-more">正在载入更多...</div>}
        {!loadingMore && loadMoreError && (
          <button className="artifact-loading-more" onClick={loadMore} type="button">
            载入失败，点击重试
          </button>
        )}
      </div>

      {previewItem && <ArtifactPreviewDialog item={previewItem} onClose={() => setPreviewItem(undefined)} />}
    </section>
  )
}
