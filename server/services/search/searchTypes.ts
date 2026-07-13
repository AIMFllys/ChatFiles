export type SearchMessage = {
  conversationId: string
  messageUid: string
  time: number
  sender: string
  senderName: string
  text: string
}

export type SearchChunk = {
  chunkId: string
  conversationId: string
  firstMessageUid: string
  lastMessageUid: string
  startTime: number
  endTime: number
  senderIds: string[]
  text: string
  ngrams: string
  tokenCount: number
}

export type EmbeddingFingerprint = {
  embeddingModel: string | null
  embeddingDimensions: number | null
}

export type SearchIndexMetadata = EmbeddingFingerprint & {
  schemaVersion: number
  sourceFingerprint: string
  chunkCount: number
}

export type SearchFilters = {
  conversationId?: string
  sender?: string
  after?: number
  before?: number
  limit?: number
}

export type RankedSearchHit = SearchChunk & {
  rank: number
  score: number
  source: 'exact' | 'keyword' | 'vector' | 'hybrid'
}
