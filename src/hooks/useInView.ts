import { useEffect, useRef } from 'react'

/**
 * Fire `onEnter` whenever the returned ref's node scrolls into view. Used for
 * auto "load the next page" sentinels. `enabled` gates the observer so we stop
 * firing once there is nothing left to load (or a fetch is in flight).
 */
export function useInView(onEnter: () => void, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const cb = useRef(onEnter)
  cb.current = onEnter

  useEffect(() => {
    const node = ref.current
    if (!node || !enabled) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) cb.current()
      },
      { rootMargin: '400px 0px' },
    )
    io.observe(node)
    return () => io.disconnect()
  }, [enabled])

  return ref
}
