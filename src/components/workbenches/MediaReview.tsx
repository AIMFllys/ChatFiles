import { useMemo, useState } from 'react'
import { Mic2, Search } from 'lucide-react'
import type { LibraryFile, LibraryManifest } from '../../types'
import { formatBytes } from '../../utils/format'
import { useVisibleCount } from '../../hooks/useVisibleCount'
import { asArchiveFile, fileUrl, type BrowsableFile } from '../../utils/tree'

export function MediaReview({
  manifest,
  onOpenFile,
}: {
  manifest: LibraryManifest
  onOpenFile: (file: BrowsableFile) => void
}) {
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | LibraryFile['preview']>('all')
  const mediaFiles = useMemo(
    () => manifest.files.filter((file) => ['image', 'video', 'audio', 'voice'].includes(file.preview)).map(asArchiveFile),
    [manifest.files],
  )
  const counts = useMemo(
    () =>
      mediaFiles.reduce<Record<string, number>>((acc, file) => {
        acc[file.preview] = (acc[file.preview] ?? 0) + 1
        return acc
      }, {}),
    [mediaFiles],
  )
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return mediaFiles.filter((file) => {
      if (typeFilter !== 'all' && file.preview !== typeFilter) return false
      if (!q) return true
      return `${file.name}\n${file.category}\n${file.subcategory.join(' ')}\n${file.sourceApp}\n${file.sourcePath}`.toLowerCase().includes(q)
    })
  }, [mediaFiles, query, typeFilter])

  // mount in ~300-card windows — a 5k-image grid would otherwise fire thousands
  // of requests at once and freeze the tab; off-screen cards are then culled by
  // content-visibility (see workbenches-media.css)
  const { count, sentinelRef, done } = useVisibleCount(filtered.length, 300, `${query}|${typeFilter}`)
  const shown = filtered.slice(0, count)

  return (
    <section className="media-review">
      <aside className="media-review-sidebar">
        <div className="clue-totals">
          <div>
            <span>媒体文件</span>
            <strong>{mediaFiles.length.toLocaleString()}</strong>
          </div>
          <div>
            <span>图片</span>
            <strong>{(counts.image ?? 0).toLocaleString()}</strong>
          </div>
          <div>
            <span>视频</span>
            <strong>{(counts.video ?? 0).toLocaleString()}</strong>
          </div>
          <div>
            <span>语音</span>
            <strong>{((counts.voice ?? 0) + (counts.audio ?? 0)).toLocaleString()}</strong>
          </div>
        </div>
        <div className="search-box">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索媒体名、来源或路径" />
        </div>
        <div className="filter-row" role="group" aria-label="媒体类型">
          {(['all', 'image', 'video', 'voice'] as const).map((type) => (
            <button key={type} className={typeFilter === type ? 'active' : ''} onClick={() => setTypeFilter(type)} type="button">
              {type === 'all' ? '全部' : type === 'image' ? '图片' : type === 'video' ? '视频' : '语音'}
            </button>
          ))}
        </div>
        <p className="media-note">这里展示已复制进项目 archive 的归档副本，用来快速扫图、扫视频和定位语音；点击任意卡片会进入右侧完整预览。</p>
      </aside>
      <section className="media-grid-panel">
        <header>
          <div>
            <p className="eyebrow">归档副本 / 媒体复核</p>
            <h2>{filtered.length.toLocaleString()} 个可扫媒体</h2>
          </div>
          <span>{formatBytes(filtered.reduce((sum, file) => sum + file.size, 0))}</span>
        </header>
        <div className="media-grid">
          {shown.map((file) => (
            <button key={file.treeId} className={`media-card ${file.preview}`} onClick={() => onOpenFile(file)} type="button" title={file.sourcePath}>
              <div className="media-thumb">
                {file.preview === 'image' ? (
                  <img src={fileUrl(file)} alt={file.name} loading="lazy" decoding="async" />
                ) : file.preview === 'video' ? (
                  <video src={fileUrl(file)} muted preload="none" />
                ) : (
                  <Mic2 size={34} />
                )}
              </div>
              <strong>{file.name}</strong>
              <span>{file.sourceApp} / {file.subcategory.join(' / ') || file.preview}</span>
              <em>{formatBytes(file.size)} · {new Date(file.modified).toLocaleDateString()}</em>
            </button>
          ))}
        </div>
        {!done && (
          <div ref={sentinelRef} className="lazy-sentinel">
            正在载入更多媒体… {count.toLocaleString()} / {filtered.length.toLocaleString()}
          </div>
        )}
      </section>
    </section>
  )
}
