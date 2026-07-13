export type AgentCitation = {
  citation: string
  kind: 'message' | 'file'
  id: string
  conversationId?: string
  time?: number
  title?: string
}

export type AgentSummaryItem = { text: string; sourceUids: string[] }
export type AgentSummarySections = {
  facts: AgentSummaryItem[]
  people: AgentSummaryItem[]
  dates: AgentSummaryItem[]
  quotes: AgentSummaryItem[]
  decisions: AgentSummaryItem[]
  disputes: AgentSummaryItem[]
  openItems: AgentSummaryItem[]
}
export type AgentContextSummary = {
  version: 1
  sourceHash: string
  sourceRange: { firstUid: string; lastUid: string; count: number }
  sections: AgentSummarySections
}

export type AgentStreamEvent =
  | { type: 'step'; step: number; label: string }
  | { type: 'tool'; step: number; name: string; status: 'running' | 'complete' | 'rejected' | 'duplicate' }
  | ({ type: 'citation' } & AgentCitation)
  | { type: 'delta'; content: string }
  | {
      type: 'done'
      mode: 'agent' | 'fallback'
      strategy: 'recent' | 'summary'
      evidenceCount: number
      steps: number
      summary?: AgentContextSummary
      summaryReason?: 'not_needed' | 'summary_invalid' | 'summary_failed'
    }
  | { type: 'error'; code: string }

export type AgentClientTurn = { role: 'user' | 'assistant'; content: string }

export type AgentRequestConfig = {
  baseURL: string
  apiKey: string
  model: string
  temperature: number
  contextWindow: number
  contextStrategy: 'recent' | 'summary'
  embedding: {
    enabled: boolean
    baseURL: string
    apiKey: string
    model: string
    dimensions: number
    batchSize: number
  }
}

export type AgentStreamRequest = {
  question: string
  conversationId?: string
  conversationName?: string
  anchorMessageUid?: string
  history: AgentClientTurn[]
  summary?: AgentContextSummary
  config: AgentRequestConfig
}
