import { useEffect, useRef, useState } from 'react'
import type { LinkPreview } from '../../types'

export type LinkPreviewLoadStatus = 'idle' | 'loading' | 'ready' | 'fallback'

function isLinkPreview(value: unknown): value is LinkPreview {
  if (!value || typeof value !== 'object') return false
  const preview = value as Partial<LinkPreview>
  return (preview.status === 'ready' || preview.status === 'fallback')
    && ['url', 'domain', 'title', 'description', 'siteName', 'updatedAt']
      .every((key) => typeof preview[key as keyof LinkPreview] === 'string')
}

export function useLinkPreview(artifactId: string, enabled: boolean) {
  const ref = useRef<HTMLSpanElement>(null)
  const [entered, setEntered] = useState(() => typeof IntersectionObserver === 'undefined')
  const [data, setData] = useState<LinkPreview | null>(null)
  const [resultStatus, setResultStatus] = useState<'ready' | 'fallback' | null>(null)

  useEffect(() => {
    const node = ref.current
    if (!node || !enabled || entered) return
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setEntered(true)
      },
      { rootMargin: '240px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [enabled, entered])

  useEffect(() => {
    if (!enabled || !entered) return
    const controller = new AbortController()
    fetch(`/api/wechat/artifact/${artifactId}/link-preview`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('preview_unavailable')
        const body: unknown = await response.json()
        if (!isLinkPreview(body)) throw new Error('invalid_preview')
        setData(body)
        setResultStatus(body.status)
      })
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== 'AbortError') setResultStatus('fallback')
      })
    return () => controller.abort()
  }, [artifactId, enabled, entered])

  const status: LinkPreviewLoadStatus = !enabled || !entered
    ? 'idle'
    : resultStatus ?? 'loading'
  return { data, ref, status }
}
