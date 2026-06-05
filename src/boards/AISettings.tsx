import { useState } from 'react'
import { CheckCircle2, KeyRound, Loader2, ShieldCheck, Sparkles } from 'lucide-react'
import {
  type AIConfig,
  MAX_THRESHOLD,
  MIN_THRESHOLD,
  saveAIConfig,
  streamChat,
} from '../utils/aiConfig'

type Probe = { kind: 'idle' | 'ok' | 'err' | 'busy'; note?: string }

export default function AISettings({
  config,
  onChange,
}: {
  config: AIConfig
  onChange: (next: AIConfig) => void
}) {
  const [draft, setDraft] = useState<AIConfig>(config)
  const [saved, setSaved] = useState(false)
  const [probe, setProbe] = useState<Probe>({ kind: 'idle' })

  const set = <K extends keyof AIConfig>(key: K, value: AIConfig[K]) => {
    setDraft((d) => ({ ...d, [key]: value }))
    setSaved(false)
  }

  const save = () => {
    const clean: AIConfig = {
      ...draft,
      baseURL: draft.baseURL.trim(),
      apiKey: draft.apiKey.trim(),
      model: draft.model.trim(),
      threshold: Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, Math.round(draft.threshold))),
    }
    setDraft(clean)
    saveAIConfig(clean)
    onChange(clean)
    setSaved(true)
  }

  const test = async () => {
    save()
    setProbe({ kind: 'busy' })
    try {
      let reply = ''
      await streamChat(draft, [{ role: 'user', content: '回复两个字：在线' }], (c) => (reply += c))
      setProbe({ kind: 'ok', note: reply.trim().slice(0, 40) || '连接成功' })
    } catch (e) {
      setProbe({ kind: 'err', note: String((e as Error).message).slice(0, 160) })
    }
  }

  return (
    <section className="ai-settings">
      <div className="ai-settings-head">
        <Sparkles size={20} />
        <div>
          <h2>AI 接入</h2>
          <p>配置任意 OpenAI 兼容接口。密钥仅存于本机浏览器，转发时一次性透传，绝不写入仓库或日志。</p>
        </div>
      </div>

      <div className="ai-field">
        <label>接口地址 Base URL</label>
        <input
          value={draft.baseURL}
          onChange={(e) => set('baseURL', e.target.value)}
          placeholder="https://api.openai.com/v1"
          spellCheck={false}
        />
        <small>会向 <code>{(draft.baseURL || '…').replace(/\/+$/, '')}/chat/completions</code> 发起请求。</small>
      </div>

      <div className="ai-field">
        <label><KeyRound size={13} /> API Key</label>
        <input type="password" value={draft.apiKey} onChange={(e) => set('apiKey', e.target.value)} placeholder="sk-…" spellCheck={false} />
      </div>

      <div className="ai-field-row">
        <div className="ai-field">
          <label>模型 ID</label>
          <input value={draft.model} onChange={(e) => set('model', e.target.value)} placeholder="gpt-4o-mini" spellCheck={false} />
        </div>
        <div className="ai-field">
          <label>温度 {draft.temperature.toFixed(2)}</label>
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.05}
            value={draft.temperature}
            onChange={(e) => set('temperature', Number(e.target.value))}
          />
        </div>
      </div>

      <div className="ai-field">
        <label>上下文注入阈值 · {draft.threshold.toLocaleString()} tokens</label>
        <input
          type="range"
          min={MIN_THRESHOLD}
          max={MAX_THRESHOLD}
          step={10_000}
          value={draft.threshold}
          onChange={(e) => set('threshold', Number(e.target.value))}
        />
        <small>聊天「AI 解析」会注入该会话上下文，预估超过此阈值即报错，避免超出模型窗口。范围 1万 – 80万。</small>
      </div>

      <div className="ai-actions">
        <button className="ai-save" type="button" onClick={save}>
          {saved ? <CheckCircle2 size={16} /> : null} {saved ? '已保存' : '保存配置'}
        </button>
        <button className="ai-test" type="button" onClick={test} disabled={probe.kind === 'busy'}>
          {probe.kind === 'busy' ? <Loader2 className="spin" size={15} /> : null} 测试连接
        </button>
        {probe.kind === 'ok' && <span className="ai-probe ok"><CheckCircle2 size={14} /> {probe.note}</span>}
        {probe.kind === 'err' && <span className="ai-probe err">{probe.note}</span>}
      </div>

      <p className="ai-privacy">
        <ShieldCheck size={14} /> 隐私：密钥保存在浏览器 localStorage；请求经本机 <code>/api/ai/chat</code> 透传到你的接口，服务端不落盘、不记录。
      </p>
    </section>
  )
}
