import { useEffect, useRef, useState } from 'react'
import { Bot, Loader2, Send, Sparkles, Trash2, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  type AIConfig,
  type ChatTurn,
  type DockSize,
  clearHistory,
  estimateTokens,
  isConfigured,
  loadDockSize,
  loadHistory,
  saveDockSize,
  saveHistory,
  streamChat,
} from '../../utils/aiConfig'

type Ctx = { text: string; tokens: number; lines: number; truncated: boolean }
type CtxState = { key: string; value?: Ctx; loading: boolean }

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
  const contextKey = `${convId}:${config.threshold}`
  const [ctxState, setCtxState] = useState<CtxState>(() => ({ key: contextKey, loading: true }))
  const [turns, setTurns] = useState<ChatTurn[]>(() => loadHistory(convId))
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [size, setSize] = useState<DockSize>(loadDockSize)
  const abortRef = useRef<AbortController | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // pull the conversation transcript whenever the conversation / threshold changes
  useEffect(() => {
    let cancelled = false
    const maxChars = Math.min(config.threshold * 4, 4_000_000)
    fetch(`/api/wechat/conversation/${encodeURIComponent(convId)}/transcript?maxChars=${maxChars}`)
      .then((r) => r.json())
      .then((d: { text: string; lines: number; truncated: boolean }) => {
        if (cancelled) return
        setCtxState({
          key: contextKey,
          loading: false,
          value: { text: d.text, tokens: estimateTokens(d.text), lines: d.lines, truncated: d.truncated },
        })
      })
      .catch(() => {
        if (!cancelled) setCtxState({ key: contextKey, loading: false })
      })
    return () => {
      cancelled = true
    }
  }, [contextKey, convId, config.threshold])

  useEffect(() => saveHistory(convId, turns), [convId, turns])
  useEffect(() => bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight }), [turns])
  useEffect(() => saveDockSize(size), [size])
  useEffect(() => () => abortRef.current?.abort(), [])

  // auto-grow the input textarea to fit content
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${ta.scrollHeight}px`
  }, [input])

  const ctx = ctxState.key === contextKey ? ctxState.value : undefined
  const ctxLoading = ctxState.key !== contextKey || ctxState.loading
  const over = ctx ? ctx.tokens > config.threshold : false
  const ready = isConfigured(config) && !ctxLoading && !over

  // drag the top-left handle to resize (dock is anchored bottom-right)
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    const sx = e.clientX
    const sy = e.clientY
    const sw = size.w
    const sh = size.h
    const move = (ev: PointerEvent) =>
      setSize({
        w: Math.max(320, Math.min(window.innerWidth - 48, sw + (sx - ev.clientX))),
        h: Math.max(360, Math.min(window.innerHeight - 90, sh + (sy - ev.clientY))),
      })
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const clearCtx = () => {
    abortRef.current?.abort()
    setBusy(false)
    setTurns([])
    clearHistory(convId)
    setError('')
  }

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
      content: `你是严谨的聊天记录分析助手。下面是微信会话「${convName}」的完整记录（按时间顺序，"发言人: 内容"）。请只依据这些记录与此前对话回答，引用具体发言佐证，不要编造。可用 Markdown 排版。\n\n===== 会话记录开始 =====\n${ctx.text}\n===== 会话记录结束 =====`,
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
    <div className="ai-dock" role="dialog" aria-label="AI 解析" style={{ width: size.w, height: size.h }}>
      <div className="ai-dock-resize" onPointerDown={startResize} title="拖动调整大小" />
      <header className="ai-dock-head">
        <span className="ai-dock-title"><Sparkles size={15} /> AI 解析 · {convName}</span>
        <div className="ai-dock-acts">
          <button className="ai-dock-x" type="button" onClick={clearCtx} aria-label="清除上下文" title="清除本会话对话与上下文">
            <Trash2 size={15} />
          </button>
          <button className="ai-dock-x" type="button" onClick={onClose} aria-label="关闭"><X size={16} /></button>
        </div>
      </header>

      <div className="ai-dock-ctx">
        {ctxLoading ? (
          <span><Loader2 className="spin" size={12} /> 读取会话上下文…</span>
        ) : ctx ? (
          <span className={over ? 'over' : ''}>
            注入 {ctx.lines.toLocaleString()} 行 · 约 {ctx.tokens.toLocaleString()} tokens / 阈值 {config.threshold.toLocaleString()}
            {ctx.truncated ? ' · 已按阈值截断' : ''}{turns.some((t) => t.role === 'assistant') ? ' · 含历史对话' : ''}
          </span>
        ) : (
          <span>无法读取上下文</span>
        )}
      </div>

      <div className="ai-dock-body" ref={bodyRef}>
        {!turns.length && (
          <div className="ai-dock-hint">
            <Bot size={28} />
            <p>{isConfigured(config) ? '基于本会话全文提问，例如"这段对话的核心结论是什么？"' : '先到「AI」板块配置接口，再回来解析。'}</p>
            {!isConfigured(config) && <button type="button" className="ai-dock-cfg" onClick={onGotoSettings}>前往配置 →</button>}
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`ai-turn ${t.role}`}>
            <span className="ai-turn-who">{t.role === 'user' ? '我' : 'AI'}</span>
            {t.role === 'assistant' ? (
              <div className="ai-turn-text markdown-body">
                {t.content ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{t.content}</ReactMarkdown>
                ) : busy && i === turns.length - 1 ? (
                  <Loader2 className="spin" size={13} />
                ) : null}
              </div>
            ) : (
              <div className="ai-turn-text">{t.content}</div>
            )}
          </div>
        ))}
      </div>

      {error && <div className="ai-dock-err">{error}</div>}

      <div className="ai-dock-foot">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder={ready ? '问点什么…（Enter 发送 / Shift+Enter 换行）' : over ? '上下文超阈值，请调高阈值' : '配置后可用'}
          rows={1}
          disabled={!ready || busy}
        />
        <button className="ai-send" type="button" onClick={send} disabled={!ready || busy || !input.trim()}>
          {busy ? <Loader2 className="spin" size={16} /> : <Send size={16} />}
        </button>
      </div>
    </div>
  )
}
