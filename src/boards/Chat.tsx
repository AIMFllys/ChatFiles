import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, MessagesSquare, Search } from 'lucide-react'
import type {
  InsightSummary,
  WechatConversation,
  WechatConversationList,
  WechatMessage,
  WechatMessagePage,
} from '../types'
import type { AIConfig } from '../utils/aiConfig'
import { fmtDate } from '../utils/format'
import { useInView } from '../hooks/useInView'
import { MessageList } from './ChatMessageList'
import { ChatContext } from './ChatContext'
import { AIChatDock } from '../components/ai/AIChatDock'

const PAGE = 400

export default function ChatBoard({
  summariesByConvId,
  aiConfig,
  onGotoSettings,
}: {
  summariesByConvId: Map<string, InsightSummary>
  aiConfig: AIConfig
  onGotoSettings: () => void
}) {
  const [list, setList] = useState<WechatConversationList>({ conversations: [], totals: { conversations: 0, messages: 0 } })
  const [listLoading, setListLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<'all' | 'group' | 'private'>('all')
  const [activeId, setActiveId] = useState<string>()

  const [messages, setMessages] = useState<WechatMessage[]>([])
  const [meta, setMeta] = useState<WechatConversation>()
  const [offset, setOffset] = useState(0)
  const [msgLoading, setMsgLoading] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [msgQuery, setMsgQuery] = useState('')
  const [committedMsgQuery, setCommittedMsgQuery] = useState('')
  const [dockOpen, setDockOpen] = useState(false)
  const threadRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    setListLoading(true)
    fetch('/api/wechat/conversations')
      .then((res) => res.json())
      .then((data: WechatConversationList) => {
        if (cancelled) return
        setList(data)
        if (!activeId && data.conversations.length) setActiveId(data.conversations[0].id)
        setListLoading(false)
      })
      .catch(() => !cancelled && setListLoading(false))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return list.conversations
      .filter((c) => {
        if (scope === 'group' && !c.is_group) return false
        if (scope === 'private' && c.is_group) return false
        return !q || c.display.toLowerCase().includes(q)
      })
      .sort((a, b) => b.last_time - a.last_time)
  }, [list.conversations, query, scope])

  // (re)load a conversation from the oldest page; start at the top and let the
  // reader scroll DOWN to lazily pull newer pages
  useEffect(() => {
    if (!activeId) return
    let cancelled = false
    setMsgLoading(true)
    setMessages([])
    setOffset(0)
    setDockOpen(false)
    const url = `/api/wechat/conversation/${encodeURIComponent(activeId)}/messages?offset=0&limit=${PAGE}${
      committedMsgQuery ? `&q=${encodeURIComponent(committedMsgQuery)}` : ''
    }`
    fetch(url)
      .then((res) => res.json())
      .then((data: WechatMessagePage) => {
        if (cancelled) return
        setMeta(data.meta)
        setMessages(data.messages)
        setHasMore(data.messages.length >= PAGE)
        setMsgLoading(false)
        requestAnimationFrame(() => threadRef.current?.scrollTo({ top: 0 }))
      })
      .catch(() => !cancelled && setMsgLoading(false))
    return () => {
      cancelled = true
    }
  }, [activeId, committedMsgQuery])

  const loadMore = () => {
    if (!activeId || msgLoading || !hasMore) return
    const next = offset + PAGE
    setMsgLoading(true)
    const url = `/api/wechat/conversation/${encodeURIComponent(activeId)}/messages?offset=${next}&limit=${PAGE}${
      committedMsgQuery ? `&q=${encodeURIComponent(committedMsgQuery)}` : ''
    }`
    fetch(url)
      .then((res) => res.json())
      .then((data: WechatMessagePage) => {
        setMessages((prev) => [...prev, ...data.messages])
        setOffset(next)
        setHasMore(data.messages.length >= PAGE)
        setMsgLoading(false)
      })
      .catch(() => setMsgLoading(false))
  }

  const sentinelRef = useInView(loadMore, Boolean(meta) && hasMore && !msgLoading && messages.length > 0)
  const summary = activeId ? summariesByConvId.get(activeId) : undefined
  const groupCount = list.conversations.filter((c) => c.is_group).length
  const privateCount = list.conversations.length - groupCount

  return (
    <section className="chat3">
      <aside className="chat-rail">
        <div className="chat-rail-head">
          <div className="search-box">
            <Search size={16} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索会话名" />
          </div>
          <div className="seg" role="group" aria-label="会话范围">
            {([
              ['all', `全部 ${list.conversations.length}`],
              ['group', `群聊 ${groupCount}`],
              ['private', `私聊 ${privateCount}`],
            ] as const).map(([id, label]) => (
              <button key={id} className={scope === id ? 'on' : ''} type="button" onClick={() => setScope(id)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="chat-rail-list">
          {listLoading ? (
            <div className="chat-rail-empty"><Loader2 className="spin" size={18} /> 载入会话…</div>
          ) : (
            filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`conv-row ${c.id === activeId ? 'on' : ''}`}
                onClick={() => {
                  setActiveId(c.id)
                  setMsgQuery('')
                  setCommittedMsgQuery('')
                }}
              >
                <div className="conv-row-top">
                  <span className={`chip ${c.is_group ? 'chip-group' : 'chip-private'}`}>{c.is_group ? '群' : '私'}</span>
                  <strong className="conv-name">{c.display}</strong>
                </div>
                <div className="conv-row-meta">
                  <span>{c.msg_count.toLocaleString()} 条</span>
                  <span>{fmtDate(c.last_time)}</span>
                </div>
              </button>
            ))
          )}
          {!listLoading && !filtered.length && <div className="chat-rail-empty">没有匹配的会话。</div>}
        </div>
      </aside>

      <div className="chat-thread">
        <header className="chat-thread-head">
          <div>
            <p className="eyebrow">{meta?.is_group ? '群聊' : '私聊'} · {meta ? meta.msg_count.toLocaleString() : 0} 条</p>
            <h2>{meta?.display ?? '选择一个会话'}</h2>
          </div>
          <div className="search-box small">
            <Search size={15} />
            <input
              value={msgQuery}
              onChange={(e) => setMsgQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && setCommittedMsgQuery(msgQuery.trim())}
              placeholder="在会话内检索…回车"
            />
          </div>
        </header>

        <div className="chat-thread-body" ref={threadRef}>
          {msgLoading && !messages.length ? (
            <div className="chat-thread-empty"><Loader2 className="spin" size={22} /><p>载入消息…</p></div>
          ) : !meta ? (
            <div className="chat-thread-empty"><MessagesSquare size={40} /><p>从左侧选择一段对话开始重读。</p></div>
          ) : !messages.length ? (
            <div className="chat-thread-empty">
              <MessagesSquare size={40} />
              <p>{committedMsgQuery ? '这段会话里没有命中检索词。' : '此会话暂无可显示的消息。'}</p>
            </div>
          ) : (
            <>
              <MessageList messages={messages} />
              {hasMore && (
                <div ref={sentinelRef} className="lazy-sentinel">
                  {msgLoading ? <Loader2 className="spin" size={14} /> : null} 下滑加载更多消息…
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <ChatContext meta={meta} summary={summary} onAnalyze={() => setDockOpen(true)} />

      {dockOpen && meta && activeId && (
        <AIChatDock
          convId={activeId}
          convName={meta.display}
          config={aiConfig}
          onClose={() => setDockOpen(false)}
          onGotoSettings={onGotoSettings}
        />
      )}
    </section>
  )
}
