import { useState } from 'react'
import {
  Archive,
  AudioLines,
  Code2,
  ExternalLink,
  File,
  FileJson,
  FileSpreadsheet,
  FileText,
  Image,
  Link2,
  MessageSquareText,
  Play,
  Presentation,
  Wrench,
} from 'lucide-react'
import type { ChatArtifactListItem } from '../../types'
import { formatBytes } from '../../utils/format'
import { previewForArtifactName } from './artifactModel'

const previewLabels: Record<string, string> = {
  archive: '压缩包',
  audio: '音频',
  code: '代码',
  docx: 'Word',
  download: '文件',
  html: 'HTML',
  image: '图片',
  json: 'JSON',
  link: '链接',
  markdown: 'Markdown',
  pdf: 'PDF',
  presentation: '演示',
  sheet: '表格',
  text: '文本',
  video: '视频',
  voice: '语音',
}

function PreviewIcon({ preview }: { preview: string }) {
  if (preview === 'image') return <Image />
  if (preview === 'video') return <Play />
  if (preview === 'audio' || preview === 'voice') return <AudioLines />
  if (preview === 'code' || preview === 'html') return <Code2 />
  if (preview === 'sheet') return <FileSpreadsheet />
  if (preview === 'presentation') return <Presentation />
  if (preview === 'archive') return <Archive />
  if (preview === 'json') return <FileJson />
  if (preview === 'link') return <Link2 />
  if (preview === 'markdown' || preview === 'text' || preview === 'pdf' || preview === 'docx') return <FileText />
  return <File />
}

function displayDate(timestamp: number) {
  if (!timestamp) return '未知时间'
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', year: 'numeric' })
    .format(new Date(timestamp * 1000))
}

export function ArtifactCard({
  item,
  onOpen,
}: {
  item: ChatArtifactListItem
  onOpen: (item: ChatArtifactListItem) => void
}) {
  const [failedThumbnail, setFailedThumbnail] = useState(false)
  if (item.itemType === 'chatText') {
    return (
      <button className="artifact-card chat-text-card" onClick={() => onOpen(item)} type="button">
        <span className="artifact-card-preview">
          <MessageSquareText aria-hidden="true" />
          <span>{item.content}</span>
        </span>
        <span className="artifact-card-copy">
          <strong>{item.senderName || '未知发送者'}</strong>
          <small>{displayDate(item.createdAt)}</small>
        </span>
      </button>
    )
  }

  const preview = previewForArtifactName(item.name, item.preview)
  const canThumbnail = (preview === 'image' || preview === 'video')
    && (item.availability === 'ready' || item.availability === 'thumbnail_only')
  return (
    <button
      className={`artifact-card artifact-${item.category}`}
      data-availability={item.availability}
      onClick={() => onOpen(item)}
      type="button"
    >
      <span className="artifact-card-preview">
        {canThumbnail && !failedThumbnail ? (
          <img
            alt=""
            loading="lazy"
            onError={() => setFailedThumbnail(true)}
            src={`/api/wechat/artifact/${item.id}/thumbnail?w=360`}
          />
        ) : (
          <span className="artifact-preset"><PreviewIcon preview={preview} /></span>
        )}
        <span className="artifact-type">{previewLabels[preview] ?? preview}</span>
        <span className="artifact-state" aria-label={item.availability} />
      </span>
      <span className="artifact-card-copy">
        <strong>{item.name}</strong>
        <span className="artifact-card-meta">
          <span>{item.senderName || '未知发送者'}</span>
          <span>{displayDate(item.createdAt)}</span>
        </span>
        <span className="artifact-card-footer">
          <span>{item.size === null ? '大小未知' : formatBytes(item.size)}</span>
          {item.category === 'link' ? <ExternalLink size={14} /> : item.category === 'skill' ? <Wrench size={14} /> : null}
        </span>
      </span>
    </button>
  )
}
