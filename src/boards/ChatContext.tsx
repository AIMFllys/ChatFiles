import { Sparkles, Users } from 'lucide-react'
import type { InsightSummary, WechatConversation } from '../types'
import { fmtDate } from '../utils/format'

/** Right-hand context panel for the chat board: insight footnote, facts, and
 *  the launcher for the floating AI-analysis dock. */
export function ChatContext({
  meta,
  summary,
  onAnalyze,
}: {
  meta?: WechatConversation
  summary?: InsightSummary
  onAnalyze: () => void
}) {
  return (
    <aside className="chat-ctx">
      <div className="chat-ctx-top">
        <p className="eyebrow">CONTEXT · 会话注脚</p>
        <button className="ai-analyze" type="button" onClick={onAnalyze} disabled={!meta} title="读取本会话全文与 AI 对话">
          <Sparkles size={14} /> AI 解析
        </button>
      </div>

      {summary ? (
        <>
          <section className="ctx-block">
            <h4>摘要</h4>
            <p>{summary.summary}</p>
          </section>
          {summary.topics && summary.topics.length > 0 && (
            <section className="ctx-block">
              <h4>话题</h4>
              <div className="ctx-tags">
                {summary.topics.map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
            </section>
          )}
          {summary.keyPeople && summary.keyPeople.length > 0 && (
            <section className="ctx-block">
              <h4><Users size={14} /> 关键人物</h4>
              <div className="ctx-tags">
                {summary.keyPeople.map((p) => (
                  <span key={p} className="ctx-tag-person">{p}</span>
                ))}
              </div>
            </section>
          )}
        </>
      ) : meta?.summary ? (
        <section className="ctx-block">
          <h4>会话备注</h4>
          <p>{meta.summary}</p>
        </section>
      ) : (
        <section className="ctx-block">
          <p className="ctx-muted">这段会话还没有生成洞察注脚。AI 札记正在淘洗中…可点上方「AI 解析」即时对话。</p>
        </section>
      )}

      {meta && (
        <section className="ctx-block ctx-facts">
          <div><span>首条</span><strong>{fmtDate(meta.first_time)}</strong></div>
          <div><span>末条</span><strong>{fmtDate(meta.last_time)}</strong></div>
          <div><span>文字</span><strong>{meta.text_count.toLocaleString()}</strong></div>
          <div><span>消息</span><strong>{meta.msg_count.toLocaleString()}</strong></div>
        </section>
      )}
    </aside>
  )
}
