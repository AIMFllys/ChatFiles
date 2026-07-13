import type { WechatMessage } from './chatIdentity'

export type TimelineCursor = { time: number; messageUid: string }

export type TimelineMessage = WechatMessage & { message_uid: string }

export type TimelineParticipant = {
  id: string
  name: string
  messageCount: number
  lastTime: number
}

export type TimelineBucket = {
  key: string
  label: string
  startTime: number
  endTime: number
  messageCount: number
  cursor: string
}

export type TimelinePageInfo = {
  olderCursor: string | null
  newerCursor: string | null
  hasOlder: boolean
  hasNewer: boolean
}

export type TimelinePage = {
  conversationId: string
  limit: number
  messages: TimelineMessage[]
  participants: TimelineParticipant[]
  buckets: TimelineBucket[]
  pageInfo: TimelinePageInfo
}
