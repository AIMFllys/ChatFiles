import type { TimelineMessage, TimelineParticipant } from '../../types'

export type TimelineDayItem = { kind: 'day'; key: string; label: string }
export type TimelineMessageItem = {
  kind: 'message'
  key: string
  message: TimelineMessage
  showIdentity: boolean
}
export type TimelineRenderItem = TimelineDayItem | TimelineMessageItem
export type TimelinePageWindow = { id: string; messages: TimelineMessage[] }

function localDateKey(timestamp: number) {
  const date = new Date(timestamp * 1000)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function dateLabel(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date(timestamp * 1000))
}

export function groupTimelineMessages(messages: readonly TimelineMessage[]): TimelineRenderItem[] {
  const items: TimelineRenderItem[] = []
  let previous: TimelineMessage | undefined
  let previousDay = ''
  for (const message of messages) {
    const day = localDateKey(message.time)
    if (day !== previousDay) {
      items.push({ kind: 'day', key: `day:${day}`, label: dateLabel(message.time) })
      previousDay = day
    }
    const showIdentity = !previous
      || day !== localDateKey(previous.time)
      || previous.sender !== message.sender
      || message.time - previous.time > 300
    items.push({ kind: 'message', key: message.message_uid, message, showIdentity })
    previous = message
  }
  return items
}

function compareMessages(left: TimelineMessage, right: TimelineMessage) {
  if (left.time !== right.time) return left.time - right.time
  return left.message_uid < right.message_uid ? -1 : left.message_uid > right.message_uid ? 1 : 0
}

export function mergeTimelineMessages(
  current: readonly TimelineMessage[],
  incoming: readonly TimelineMessage[],
) {
  const unique = new Map<string, TimelineMessage>()
  for (const message of [...current, ...incoming]) unique.set(message.message_uid, message)
  return [...unique.values()].sort(compareMessages)
}

export function trimTimelinePages<T extends TimelinePageWindow>(
  pages: readonly T[],
  maxPages: number,
  anchorUid?: string,
) {
  if (pages.length <= maxPages) return [...pages]
  const anchorIndex = anchorUid
    ? pages.findIndex((page) => page.messages.some((message) => message.message_uid === anchorUid))
    : pages.length - 1
  const center = anchorIndex >= 0 ? anchorIndex : pages.length - 1
  const start = Math.max(0, Math.min(pages.length - maxPages, center - Math.floor(maxPages / 2)))
  return pages.slice(start, start + maxPages)
}

export function participantMatches(participant: TimelineParticipant, query: string) {
  const term = query.trim().toLocaleLowerCase('zh-CN')
  if (!term) return true
  return `${participant.name}\n${participant.id}`.toLocaleLowerCase('zh-CN').includes(term)
}

export function timelineAnchorTarget(messages: readonly TimelineMessage[], messageUid: string | undefined) {
  if (!messageUid) return undefined
  return messages.find((message) => message.message_uid === messageUid)
}
