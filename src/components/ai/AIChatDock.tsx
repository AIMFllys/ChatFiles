import { useEffect, useRef, useState } from 'react'
import { Bot, Loader2, Send, Sparkles, X } from 'lucide-react'
import { type AIConfig, type ChatTurn, estimateTokens, isConfigured, streamChat } from '../../utils/aiConfig'

type Ctx = { text: string; tokens: number; lines: number; truncated: boolean }

export function AIChatDock({
  convId,
  convName,
  config,
  onClose,
  onGotoSettings,
}: {
  convId: string
  convName: string
  config: AIConfig
  onClose: () => void
  onGotoSettings: () => void
}) {
  const [ctx, setCtx] = useState<Ctx>()
  const [ctxLoading, setCtxLoading] = useState(true)
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  // pull the conversation transcript whenever the conversation / threshold changes
  useEffect(() => {
    let cancelled = false
    setCtxLoading(true)
    setCtx(undefined)
    setTurns([])
    setError('')
    const maxChars = Math.min(config.threshold * 4, 4_000_000)
    fetch(`/api/wechat/conversation/${encodeURIComponent(convId)}/transcript?maxChars=${maxChars}`)
      .then((r) => r.json())
      .then((d: { text: string; lines: number; truncated: boolean }) => {
        if (cancelled) return
        setCtx({ text: d.text, tokens: estimateTokens(d.text), lines: d.lines, truncated: d.truncated })
        setCtxLoading(false)
      })
      .catch(() => !cancelled && setCtxLoading(false))
    return () => {
      cancelled = true
    }
  }, [convId, config.threshold])

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight })
  }, [turns])

  useEffect(() => () => abortRef.current?.abort(), [])

  const over = ctx ? ctx.tokens > config.threshold : false
  const ready = isConfigured(config) && !ctxLoading && !over

  const send = async () => {
    const text = input.trim()
    if (!text || busy || !ctx) return
    if (!isConfigured(config)) {
      setError('尚未配置 AI 接口，请先到「AI」板块填写 Base URL / Key / 模型。')
      return
    }
    if (over) {
      setError(`上下文 ${ctx.tokens.toLocaleString()} tokens 超过阈值 ${config.threshold.toLocaleString()} tokens，请在 AI 设置调高阈值或改用更大窗口模型。`)
      return
    }
    setError('')
    const system: ChatTurn = {
      role: 'system',
      content: `你是严谨的聊天记录分析助手。下面是微信会话「${convName}」的完整记录（按时间顺序，“发言人: 内容”）。请只依据这些记录回答，引用具体发言佐证，不要编造。\n\n===== 会话记录开始 =====\n${ctx.text}\n===== 会话记录结束 =====`,
    }
    const next: ChatTurn[] = [...turns, { role: 'user', content: text }, { role: 'assistant', content: '' }]
    setTurns(next)
    setInput('')
    setBusy(true)
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    try {
      await streamChat(config, [system, ...next.slice(0, -1)], (chunk) => {
        setTurns((prev) => {
          const copy = prev.slice()
          copy[copy.length - 1] = { role: 'assistant', content: copy[copy.length - 1].content + chunk }
          return copy
        })
      }, ac.signal)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ai-dock" role="dialog" aria-label="AI 解析">
      <header className="ai-dock-head">
        <span className="ai-dock-title"><Sparkles size={15} /> AI 解析 · {convName}</span>
        <button className="ai-dock-x" type="button" onClick={onClose} aria-label="关闭"><X size={16} /></button>
      </header>

      <div className="ai-dock-ctx">
        {ctxLoading ? (
          <span><Loader2 className="spin" size={12} /> 读取会话上下文…</span>
        ) : ctx ? (
          <span className={over ? 'over' : ''}>
            注入 {ctx.lines.toLocaleString()} 行 · 约 {ctx.tokens.toLocaleString()} tokens / 阈值 {config.threshold.toLocaleString()}
            {ctx.truncated ? ' · 已按阈值截断' : ''}
          </span>
        ) : (
          <span>无法读取上下文</span>
        )}
      </div>

      <div className="ai-dock-body" ref={bodyRef}>
        {!turns.length && (
          <div className="ai-dock-hint">
            <Bot size={28} />
            <p>{isConfigured(config) ? '基于本会话全文提问，例如“这段对话的核心结论是什么？”' : '先到「AI」板块配置接口，再回来解析。'}</p>
            {!isConfigured(config) && <button type="button" className="ai-dock-cfg" onClick={onGotoSettings}>前往配置 →</button>}
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`ai-turn ${t.role}`}>
            <span className="ai-turn-who">{t.role === 'user' ? '我' : 'AI'}</span>
            <div className="ai-turn-text">{t.content || (busy && i === turns.length - 1 ? <Loader2 className="spin" size={13} /> : null)}</div>
          </div>
        ))}
      </div>

      {error && <div className="ai-dock-err">{error}</div>}

      <div className="ai-dock-foot">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder={ready ? '问点什么…（Enter 发送 / Shift+Enter 换行）' : over ? '上下文超阈值，请调高阈值' : '配置后可用'}
          rows={2}
          disabled={!ready || busy}
        />
        <button className="ai-send" type="button" onClick={send} disabled={!ready || busy || !input.trim()}>
          {busy ? <Loader2 className="spin" size={16} /> : <Send size={16} />}
        </button>
      </div>
    </div>
  )
}
