import type { WechatMessage } from '../types'

// Owner identity is supplied via env (set in the gitignored .env.local), so the
// repo carries no personal wxid / display name. Falls back to neutral values.
const OWNER_WXID = (import.meta.env.VITE_OWNER_WXID ?? '').trim()
const OWNER_NAME = (import.meta.env.VITE_OWNER_NAME ?? '').trim()
const OWNER_RE = OWNER_WXID ? new RegExp(OWNER_WXID, 'i') : null

function fmtDayLabel(unixSeconds: number) {
  const d = new Date(unixSeconds * 1000)
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

function fmtTime(unixSeconds: number) {
  const d = new Date(unixSeconds * 1000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function dayKey(unixSeconds: number) {
  const d = new Date(unixSeconds * 1000)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function isOwn(m: WechatMessage) {
  if (OWNER_RE && OWNER_RE.test(m.sender || '')) return true
  if (OWNER_NAME && (m.sender_name || '').includes(OWNER_NAME)) return true
  return false
}

const KIND_LABELS: Record<string, string> = {
  image: '图片',
  voice: '语音',
  video: '视频',
  sticker: '表情',
  emoji: '表情',
  system: '系统',
  link: '链接',
  url: '链接',
  file: '文件',
  card: '名片',
  location: '位置',
  transfer: '转账',
  redpacket: '红包',
  music: '音乐',
  quote: '引用',
}

function kindChip(m: WechatMessage) {
  const raw = m.type_label || ''
  if (KIND_LABELS[raw]) return `[${KIND_LABELS[raw]}]`
  if (!raw || raw.startsWith('type_')) return '[消息]'
  return `[${raw}]`
}

export function MessageList({ messages }: { messages: WechatMessage[] }) {
  const blocks: React.ReactNode[] = []
  let lastDay = ''
  let lastSender = ''
  let groupStartIdx = -1

  messages.forEach((m, i) => {
    const dk = dayKey(m.time)
    if (dk !== lastDay) {
      blocks.push(
        <div className="day-sep" key={`day-${dk}-${i}`}>
          <span>{fmtDayLabel(m.time)}</span>
        </div>,
      )
      lastDay = dk
      lastSender = ''
    }
    const own = isOwn(m)
    const newGroup = m.sender !== lastSender || groupStartIdx === -1
    if (newGroup) groupStartIdx = i
    lastSender = m.sender

    blocks.push(
      <div className={`msg ${own ? 'msg-own' : 'msg-other'} ${newGroup ? 'msg-lead' : 'msg-cont'}`} key={`${m.seq}-${i}`}>
        {newGroup && (
          <div className="msg-head">
            <span className="msg-name">{own ? (OWNER_NAME ? `我 · ${OWNER_NAME}` : '我') : m.sender_name || m.sender}</span>
            <span className="msg-time">{fmtTime(m.time)}</span>
          </div>
        )}
        <div className="msg-bubble">
          {m.type !== 1 && !/^\s*[[【]/.test(m.text || '') && <span className="msg-kind">{kindChip(m)}</span>}
          {m.text ? <span className="msg-text">{m.text}</span> : m.type === 1 ? <span className="msg-text msg-empty">（空）</span> : null}
        </div>
      </div>,
    )
  })

  return <div className="msg-stream">{blocks}</div>
}
