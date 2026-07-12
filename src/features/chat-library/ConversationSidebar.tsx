import { useMemo, useState, type Ref } from 'react'
import { Archive, FolderHeart, Pin, PinOff, Search } from 'lucide-react'
import type { InsightSummary, WechatConversation } from '../../types'
import { fmtDate } from '../../utils/format'
import type { ChatLibrarySelection } from './artifactModel'
import { orderConversationsPinnedFirst } from './pins'

type Props = {
  conversations: WechatConversation[]
  loading: boolean
  pinnedIds: string[]
  selectedControlRef: Ref<HTMLButtonElement>
  selection: ChatLibrarySelection
  summariesByConvId: Map<string, InsightSummary>
  onSelect: (selection: ChatLibrarySelection) => void
  onTogglePin: (conversationId: string) => void
}

const collections = [
  { id: 'library' as const, label: '我的素材库', detail: '作品与可浏览创作', icon: FolderHeart },
  { id: 'outputs' as const, label: '全部产出', detail: '跨会话汇总', icon: Archive },
]

export function ConversationSidebar({
  conversations,
  loading,
  pinnedIds,
  selectedControlRef,
  selection,
  summariesByConvId,
  onSelect,
  onTogglePin,
}: Props) {
  const [query, setQuery] = useState('')
  const ordered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('zh-CN')
    const matches = term
      ? conversations.filter((conversation) => {
          const insight = summariesByConvId.get(conversation.id)?.summary ?? ''
          return `${conversation.display}\n${conversation.summary ?? ''}\n${insight}`
            .toLocaleLowerCase('zh-CN')
            .includes(term)
        })
      : conversations
    return orderConversationsPinnedFirst(matches, pinnedIds)
  }, [conversations, pinnedIds, query, summariesByConvId])

  const pinned = new Set(pinnedIds)
  return (
    <aside className="conversation-sidebar" aria-label="聊天资料库导航">
      <header className="conversation-sidebar-header">
        <strong>聊天资料库</strong>
        <label className="library-search">
          <Search size={16} aria-hidden="true" />
          <input
            aria-label="搜索会话"
            maxLength={120}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索会话"
            value={query}
          />
        </label>
      </header>

      <div className="conversation-scroll">
        <section className="sidebar-section" aria-labelledby="collection-heading">
          <h2 id="collection-heading">资料库</h2>
          {collections.map((collection) => {
            const Icon = collection.icon
            const selected = selection.kind === 'collection' && selection.id === collection.id
            return (
              <button
                aria-current={selected ? 'page' : undefined}
                className={`collection-row${selected ? ' is-selected' : ''}`}
                key={collection.id}
                onClick={() => onSelect({ kind: 'collection', id: collection.id })}
                ref={selected ? selectedControlRef : undefined}
                type="button"
              >
                <span className={`collection-icon collection-icon-${collection.id}`}><Icon size={19} /></span>
                <span><strong>{collection.label}</strong><small>{collection.detail}</small></span>
              </button>
            )
          })}
        </section>

        <section className="sidebar-section" aria-labelledby="conversation-heading">
          <h2 id="conversation-heading">会话 <span>{ordered.length.toLocaleString()}</span></h2>
          {loading && <p className="sidebar-status">正在载入...</p>}
          {!loading && ordered.length === 0 && <p className="sidebar-status">没有匹配的会话</p>}
          <div className="conversation-list">
            {ordered.map((conversation) => {
              const isPinned = pinned.has(conversation.id)
              const selected = selection.kind === 'conversation' && selection.id === conversation.id
              const subtitle = summariesByConvId.get(conversation.id)?.summary || conversation.summary
              return (
                <div className={`conversation-row${selected ? ' is-selected' : ''}`} key={conversation.id}>
                  <button
                    aria-current={selected ? 'page' : undefined}
                    className="conversation-main"
                    onClick={() => onSelect({ kind: 'conversation', id: conversation.id })}
                    ref={selected ? selectedControlRef : undefined}
                    type="button"
                  >
                    <span className={`conversation-avatar ${conversation.is_group ? 'is-group' : 'is-private'}`}>
                      {conversation.display.trim().slice(0, 1) || (conversation.is_group ? '群' : '聊')}
                    </span>
                    <span className="conversation-copy">
                      <span className="conversation-line">
                        <strong>{conversation.display}</strong>
                        <time>{fmtDate(conversation.last_time)}</time>
                      </span>
                      <small>{subtitle || `${conversation.msg_count.toLocaleString()} 条消息`}</small>
                    </span>
                  </button>
                  <button
                    aria-label={isPinned ? `取消置顶 ${conversation.display}` : `置顶 ${conversation.display}`}
                    aria-pressed={isPinned}
                    className="pin-button"
                    onClick={() => onTogglePin(conversation.id)}
                    title={isPinned ? '取消置顶' : '置顶'}
                    type="button"
                  >
                    {isPinned ? <PinOff size={15} /> : <Pin size={15} />}
                  </button>
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </aside>
  )
}
