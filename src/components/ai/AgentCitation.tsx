import { FileText, MessageSquareText } from 'lucide-react'
import type { AgentCitation as Citation } from '../../types'

export function AgentCitation({ citation, onOpen }: { citation: Citation; onOpen: (citation: Citation) => void }) {
  return (
    <button className="agent-citation" onClick={() => onOpen(citation)} title="定位原始证据" type="button">
      {citation.kind === 'message' ? <MessageSquareText /> : <FileText />}
      <span>{citation.citation}</span>
    </button>
  )
}
