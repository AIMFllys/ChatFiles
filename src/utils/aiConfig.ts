export interface AIConfig {
  baseURL: string
  apiKey: string
  model: string
  /** max context tokens we will inject (10_000 .. 800_000) */
  threshold: number
  temperature: number
}

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const KEY = 'chatfiles.ai.config'

export const MIN_THRESHOLD = 10_000
export const MAX_THRESHOLD = 800_000

export const DEFAULT_AI_CONFIG: AIConfig = {
  baseURL: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  threshold: 128_000,
  temperature: 0.6,
}

export function loadAIConfig(): AIConfig {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_AI_CONFIG }
    return { ...DEFAULT_AI_CONFIG, ...(JSON.parse(raw) as Partial<AIConfig>) }
  } catch {
    return { ...DEFAULT_AI_CONFIG }
  }
}

export function saveAIConfig(cfg: AIConfig): void {
  localStorage.setItem(KEY, JSON.stringify(cfg))
}

export function isConfigured(cfg: AIConfig): boolean {
  return Boolean(cfg.baseURL.trim() && cfg.apiKey.trim() && cfg.model.trim())
}

/**
 * Conservative token estimate. CJK glyphs cost ~1 token each; Latin/whitespace
 * pack ~3.5 chars per token. Deliberately over-estimates so the threshold gate
 * errs on the safe side. Uses code-point ranges (CJK / compat / fullwidth).
 */
export function estimateTokens(text: string): number {
  let cjk = 0
  let other = 0
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i)
    if ((c >= 0x3000 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xffef)) cjk += 1
    else other += 1
  }
  return Math.ceil(cjk + other / 3.5)
}

/**
 * Stream a completion through the local proxy (`/api/ai/chat`). The proxy
 * forwards the key upstream without persisting it. `onDelta` receives token
 * chunks as they arrive.
 */
export async function streamChat(
  cfg: AIConfig,
  messages: ChatTurn[],
  onDelta: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      baseURL: cfg.baseURL,
      apiKey: cfg.apiKey,
      model: cfg.model,
      temperature: cfg.temperature,
      messages,
    }),
    signal,
  })
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '')
    throw new Error(`AI 请求失败 (${res.status})${detail ? ' · ' + detail.slice(0, 280) : ''}`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const parts = buf.split('\n')
    buf = parts.pop() ?? ''
    for (const raw of parts) {
      const line = raw.trim()
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') return
      try {
        const json = JSON.parse(data)
        const delta = json?.choices?.[0]?.delta?.content
        if (delta) onDelta(delta)
      } catch {
        /* keep-alive / split frame — ignore */
      }
    }
  }
}
