import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TimelineBucket, TimelineMessage, TimelinePage, TimelineParticipant } from '../../types'
import { mergeTimelineMessages, trimTimelinePages, type TimelinePageWindow } from './timelineModel'

const PAGE_SIZE = 120
const MAX_PAGES = 5

type LoadedWindow = TimelinePageWindow & { pageInfo: TimelinePage['pageInfo'] }
type AnchorRequest = { kind: 'cursor' | 'uid'; value: string; messageUid?: string } | null

function timelineUrl(
  conversationId: string,
  query: string,
  sender: string,
  cursor?: { kind: 'before' | 'after' | 'around' | 'aroundUid'; value: string },
) {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
  if (query.trim()) params.set('q', query.trim())
  if (sender) params.set('sender', sender)
  if (cursor) params.set(cursor.kind, cursor.value)
  return `/api/wechat/conversation/${encodeURIComponent(conversationId)}/timeline?${params}`
}

async function readPage(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error('timeline-unavailable')
  return response.json() as Promise<TimelinePage>
}

function pageWindow(page: TimelinePage): LoadedWindow {
  const first = page.messages[0]?.message_uid ?? 'empty'
  const last = page.messages[page.messages.length - 1]?.message_uid ?? 'empty'
  return { id: `${first}:${last}`, messages: page.messages, pageInfo: page.pageInfo }
}

function browserCursor(message: TimelineMessage) {
  const bytes = new TextEncoder().encode(JSON.stringify([message.time, message.message_uid]))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

export function useChatTimeline(conversationId: string, query: string, focusMessageUid?: string) {
  const [sender, setSender] = useState('')
  const [anchorRequest, setAnchorRequest] = useState<AnchorRequest>(() => (
    focusMessageUid ? { kind: 'uid', value: focusMessageUid, messageUid: focusMessageUid } : null
  ))
  const [pages, setPages] = useState<LoadedWindow[]>([])
  const [participants, setParticipants] = useState<TimelineParticipant[]>([])
  const [buckets, setBuckets] = useState<TimelineBucket[]>([])
  const [resolvedScope, setResolvedScope] = useState('')
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [loadingNewer, setLoadingNewer] = useState(false)
  const [errorState, setErrorState] = useState<{ scope: string; message: string }>()
  const [focusUid, setFocusUid] = useState<string>()
  const [revision, setRevision] = useState(0)
  const pagingControllers = useRef(new Set<AbortController>())
  const scope = `${conversationId}\n${query.trim()}\n${sender}\n${anchorRequest?.kind ?? ''}:${anchorRequest?.value ?? ''}`
  const scopeRef = useRef(scope)

  useEffect(() => {
    scopeRef.current = scope
  }, [scope])

  useEffect(() => {
    const controller = new AbortController()
    for (const pending of pagingControllers.current) pending.abort()
    pagingControllers.current.clear()
    const url = timelineUrl(
      conversationId,
      query,
      sender,
      anchorRequest ? { kind: anchorRequest.kind === 'uid' ? 'aroundUid' : 'around', value: anchorRequest.value } : undefined,
    )
    readPage(url, controller.signal)
      .then((page) => {
        setPages([pageWindow(page)])
        setParticipants(page.participants)
        setBuckets(page.buckets)
        setFocusUid(anchorRequest?.messageUid)
        setErrorState(undefined)
        setResolvedScope(scope)
        setRevision((value) => value + 1)
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        setPages([])
        setErrorState({ scope, message: '聊天时间轴暂时无法读取' })
        setResolvedScope(scope)
      })
    return () => controller.abort()
  }, [anchorRequest, conversationId, query, scope, sender])

  const active = resolvedScope === scope
  const loading = !active
  const activePages = useMemo(() => active ? pages : [], [active, pages])

  const loadDirection = useCallback(async (kind: 'before' | 'after') => {
    if (loading || (kind === 'before' ? loadingOlder : loadingNewer)) return false
    const edge = kind === 'before' ? activePages[0] : activePages[activePages.length - 1]
    const cursor = kind === 'before' ? edge?.pageInfo.olderCursor : edge?.pageInfo.newerCursor
    const available = kind === 'before' ? edge?.pageInfo.hasOlder : edge?.pageInfo.hasNewer
    if (!cursor || !available) return false
    const activeScope = scopeRef.current
    const controller = new AbortController()
    pagingControllers.current.add(controller)
    if (kind === 'before') setLoadingOlder(true)
    else setLoadingNewer(true)
    try {
      const page = await readPage(timelineUrl(conversationId, query, sender, { kind, value: cursor }), controller.signal)
      if (activeScope !== scopeRef.current) return false
      setPages((current) => {
        const next = kind === 'before' ? [pageWindow(page), ...current] : [...current, pageWindow(page)]
        const anchor = page.messages[Math.floor(page.messages.length / 2)]?.message_uid
        return trimTimelinePages(next, MAX_PAGES, anchor)
      })
      setRevision((value) => value + 1)
      return true
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
        setErrorState({ scope: activeScope, message: '无法继续载入时间轴' })
      }
      return false
    } finally {
      pagingControllers.current.delete(controller)
      if (kind === 'before') setLoadingOlder(false)
      else setLoadingNewer(false)
    }
  }, [activePages, conversationId, loading, loadingNewer, loadingOlder, query, sender])

  const messages = useMemo(() => (
    activePages.reduce<TimelineMessage[]>((all, page) => mergeTimelineMessages(all, page.messages), [])
  ), [activePages])

  const filterBySender = useCallback((nextSender: string, anchor?: TimelineMessage) => {
    setSender(nextSender)
    setAnchorRequest(anchor ? { kind: 'cursor', value: browserCursor(anchor), messageUid: anchor.message_uid } : null)
  }, [])

  return {
    messages,
    participants: active ? participants : [],
    buckets: active ? buckets : [],
    sender,
    loading,
    loadingOlder,
    loadingNewer,
    error: errorState?.scope === scope ? errorState.message : '',
    focusUid: active ? focusUid : undefined,
    revision,
    hasOlder: Boolean(activePages[0]?.pageInfo.hasOlder),
    hasNewer: Boolean(activePages[activePages.length - 1]?.pageInfo.hasNewer),
    loadOlder: () => loadDirection('before'),
    loadNewer: () => loadDirection('after'),
    filterBySender,
    clearSender: (anchor?: TimelineMessage) => filterBySender('', anchor),
    jumpToBucket: (bucket: TimelineBucket) => setAnchorRequest({ kind: 'cursor', value: bucket.cursor }),
  }
}
