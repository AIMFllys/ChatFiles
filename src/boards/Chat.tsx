import type { InsightSummary } from '../types'
import type { AIConfig } from '../utils/aiConfig'
import { ChatLibrary } from '../features/chat-library/ChatLibrary'

export default function ChatBoard({
  summariesByConvId,
  aiConfig,
  onGotoSettings,
}: {
  summariesByConvId: Map<string, InsightSummary>
  aiConfig: AIConfig
  onGotoSettings: () => void
}) {
  return (
    <ChatLibrary
      summariesByConvId={summariesByConvId}
      aiConfig={aiConfig}
      onGotoSettings={onGotoSettings}
    />
  )
}
