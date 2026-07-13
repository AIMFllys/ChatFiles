import type { WechatMessage } from './chatIdentity.js'

export type WechatConversation = {
  id: string
  account?: string
  username?: string
  display: string
  is_group: number
  msg_count: number
  text_count: number
  first_time: number
  last_time: number
  summary?: string
}

export type WechatConversationList = {
  conversations: WechatConversation[]
  totals: {
    conversations: number
    messages: number
    textMessages?: number
  }
}

export type WechatMessagePage = {
  meta: WechatConversation
  messages: WechatMessage[]
  offset: number
  limit: number
}

export type ChatArtifactTab = 'all' | 'work' | 'document' | 'skill' | 'link' | 'chatText'

export type ChatArtifactAvailability =
  | 'ready'
  | 'not_attempted'
  | 'key_unavailable'
  | 'source_missing'
  | 'cdn_only'
  | 'thumbnail_only'
  | 'missing_source'
  | 'decrypt_failed'
  | 'source_ambiguous'
  | 'hash_mismatch'
  | 'source_changed'
  | 'unsupported_codec'
  | 'source_unavailable'

export type ChatArtifactCounts = Record<ChatArtifactTab, number>

export type ChatArtifactItem = {
  id: string
  itemType: 'artifact'
  conversationId: string | null
  category: Exclude<ChatArtifactTab, 'all' | 'chatText'>
  kind: string
  name: string
  preview: string
  url: string | null
  createdAt: number
  senderName: string
  size: number | null
  availability: ChatArtifactAvailability
  association: {
    status: 'exact' | 'partial' | 'conflict' | 'missing' | 'legacy'
    evidence: string
  }
  source: {
    presence: 'present' | 'missing' | 'ambiguous' | 'size_mismatch' | 'not_applicable' | 'unknown'
  }
  materialization: {
    status: string
  }
  capability: {
    previewStatus: string
  }
  metadataUrl: string
}

export type ChatTextItem = {
  id: string
  itemType: 'chatText'
  conversationId: string
  messageUid: string
  createdAt: number
  senderName: string
  content: string
}

export type ChatArtifactListItem = ChatArtifactItem | ChatTextItem

export type ChatArtifactPage = {
  tab: ChatArtifactTab
  counts: ChatArtifactCounts
  total: number
  matchingTotal: number
  offset: number
  limit: number
  items: ChatArtifactListItem[]
}

export type ChatArtifactCapability = {
  metadata: string
  content?: string
  thumbnail?: string
}

export type ChatArtifactMetadata = ChatArtifactItem & {
  capabilities: ChatArtifactCapability
}
