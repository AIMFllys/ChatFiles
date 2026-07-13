import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, ExternalLink, Loader2, X } from 'lucide-react'
import type { ChatArtifactListItem, ChatArtifactMetadata, LibraryFile } from '../../types'
import { FilePreview } from '../../components/file-preview/FilePreview'
import type { BrowsableFile } from '../../utils/tree'
import { previewForArtifactName } from './artifactModel'
import { nextDialogFocusIndex } from './dialogFocus'

const previewTypes = new Set<LibraryFile['preview']>([
  'image', 'video', 'audio', 'voice', 'pdf', 'docx', 'sheet', 'text', 'markdown',
  'code', 'html', 'json', 'presentation', 'archive', 'database', 'font', 'download',
])

const stateLabels: Record<string, string> = {
  not_attempted: '源文件尚未经过验证物化，暂时无法预览',
  key_unavailable: '当前没有可用的短生命周期解密密钥',
  source_missing: '没有找到可验证的本地源文件',
  source_changed: '本地源文件内容已与构建时证据不同',
  cdn_only: '这条消息只保留了 CDN 引用，本地没有缓存',
  decrypt_failed: '文件仍是加密载荷，暂时无法预览',
  hash_mismatch: '本地文件与消息证据不一致',
  missing_source: '没有找到可验证的本地源文件',
  source_ambiguous: '存在多个候选文件，无法安全确认',
  source_unavailable: '本地源文件当前不可用',
  unsupported_codec: '当前环境不支持此媒体编码',
}

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableElements(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
    .filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true')
}

function makeBackgroundInert(modal: HTMLElement) {
  const changed: Array<{ element: HTMLElement, inert: boolean, ariaHidden: string | null }> = []
  let branch: HTMLElement | null = modal

  while (branch.parentElement) {
    for (const sibling of branch.parentElement.children) {
      if (sibling === branch || !(sibling instanceof HTMLElement)) continue
      changed.push({
        element: sibling,
        inert: sibling.inert,
        ariaHidden: sibling.getAttribute('aria-hidden'),
      })
      sibling.inert = true
      sibling.setAttribute('aria-hidden', 'true')
    }
    branch = branch.parentElement
  }

  return () => {
    for (const { element, inert, ariaHidden } of changed) {
      element.inert = inert
      if (ariaHidden === null) element.removeAttribute('aria-hidden')
      else element.setAttribute('aria-hidden', ariaHidden)
    }
  }
}

function extension(name: string) {
  const match = name.match(/(\.[^./\\]+)$/u)
  return match?.[1]?.toLowerCase() ?? ''
}

function artifactFile(metadata: ChatArtifactMetadata): BrowsableFile | undefined {
  const contentUrl = metadata.capabilities.content
  if (!contentUrl) return undefined
  const normalizedPreview = previewForArtifactName(metadata.name, metadata.preview)
  const preview = previewTypes.has(normalizedPreview as LibraryFile['preview'])
    ? normalizedPreview as LibraryFile['preview']
    : 'download'
  return {
    id: metadata.id,
    treeId: `artifact:${metadata.id}`,
    storage: 'artifact',
    contentUrl,
    thumbnailUrl: metadata.capabilities.thumbnail,
    name: metadata.name,
    ext: extension(metadata.name),
    mime: '',
    size: metadata.size ?? 0,
    modified: new Date(metadata.createdAt * 1000).toISOString(),
    category: '素材',
    subcategory: [],
    archivePath: '',
    sourcePath: '',
    sourceApp: '微信',
    preview,
    sha256: metadata.id,
  }
}

export function ArtifactPreviewDialog({
  item,
  onClose,
}: {
  item: ChatArtifactListItem
  onClose: () => void
}) {
  const [metadata, setMetadata] = useState<ChatArtifactMetadata>()
  const [error, setError] = useState('')
  const backdropRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const backdrop = backdropRef.current
    const dialog = dialogRef.current
    if (!backdrop || !dialog) return

    closeButtonRef.current?.focus()
    const restoreBackground = makeBackgroundInert(backdrop)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const controls = focusableElements(dialog)
      const currentIndex = controls.indexOf(document.activeElement as HTMLElement)
      const nextIndex = nextDialogFocusIndex(currentIndex, controls.length, event.shiftKey)
      if (nextIndex < 0) return
      event.preventDefault()
      controls[nextIndex]?.focus()
    }
    const onFocusIn = (event: FocusEvent) => {
      if (!dialog.contains(event.target as Node)) focusableElements(dialog)[0]?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('focusin', onFocusIn)
      restoreBackground()
      opener?.focus()
    }
  }, [])

  useEffect(() => {
    if (item.itemType !== 'artifact') return
    const controller = new AbortController()
    fetch(item.metadataUrl, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('metadata-unavailable')
        return response.json() as Promise<ChatArtifactMetadata>
      })
      .then(setMetadata)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        setError('素材详情暂时无法读取')
      })
    return () => controller.abort()
  }, [item])

  const file = useMemo(() => metadata ? artifactFile(metadata) : undefined, [metadata])
  const title = item.itemType === 'chatText' ? item.senderName || '聊天文字' : item.name
  const openUrl = metadata?.capabilities.content

  return (
    <div ref={backdropRef} className="artifact-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} aria-label={title} aria-modal="true" className="artifact-dialog" role="dialog">
        <header className="artifact-dialog-toolbar">
          <strong>{title}</strong>
          <div>
            {openUrl && (
              <a href={openUrl} rel="noreferrer" target="_blank" title="在新标签页打开">
                <ExternalLink size={18} />
              </a>
            )}
            <button ref={closeButtonRef} aria-label="关闭预览" onClick={onClose} title="关闭" type="button"><X size={19} /></button>
          </div>
        </header>
        <div className="artifact-dialog-body">
          {item.itemType === 'chatText' ? (
            <article className="chat-text-preview">
              <time>{new Date(item.createdAt * 1000).toLocaleString('zh-CN')}</time>
              <p>{item.content}</p>
            </article>
          ) : error ? (
            <div className="artifact-preview-state"><AlertCircle /><p>{error}</p></div>
          ) : !metadata ? (
            <div className="artifact-preview-state"><Loader2 className="spin" /><p>正在载入...</p></div>
          ) : file ? (
            <FilePreview file={file} />
          ) : (
            <div className="artifact-preview-state">
              <AlertCircle />
              <h2>暂不可预览</h2>
              <p>{stateLabels[metadata.availability] ?? '这条记录没有可安全打开的本地内容'}</p>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
