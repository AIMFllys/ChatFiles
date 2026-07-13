import { MAX_CONTEXT_WINDOW, MIN_CONTEXT_WINDOW, type AIContextStrategy } from './aiConfig'

export type ContextBudget = {
  contextWindow: number
  rawContextMax: number
  retrievalMax: number
  summaryMax: number
  recentMax: number
  reserved: number
  outputReserve: number
  systemToolReserve: number
}

export function planContextBudget({
  contextWindow,
  strategy,
}: {
  contextWindow: number
  strategy: AIContextStrategy
}): ContextBudget {
  const window = Math.round(Math.min(MAX_CONTEXT_WINDOW, Math.max(MIN_CONTEXT_WINDOW, contextWindow)))
  const rawContextMax = Math.floor(window * 0.7)
  const reserved = window - rawContextMax
  const outputReserve = Math.min(reserved, Math.max(2_048, Math.floor(window * 0.15)))
  if (strategy === 'summary') {
    const summaryMax = Math.floor(rawContextMax * 0.35)
    const retrievalMax = Math.floor(rawContextMax * 0.35)
    return {
      contextWindow: window,
      rawContextMax,
      retrievalMax,
      summaryMax,
      recentMax: rawContextMax - summaryMax - retrievalMax,
      reserved,
      outputReserve,
      systemToolReserve: reserved - outputReserve,
    }
  }
  const retrievalMax = Math.floor(rawContextMax * 0.3)
  return {
    contextWindow: window,
    rawContextMax,
    retrievalMax,
    summaryMax: 0,
    recentMax: rawContextMax - retrievalMax,
    reserved,
    outputReserve,
    systemToolReserve: reserved - outputReserve,
  }
}

export function takeWholeMessages<T>(
  messages: readonly T[],
  maximumTokens: number,
  estimate: (message: T) => number,
) {
  const selected: T[] = []
  let usedTokens = 0
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const messageTokens = Math.max(0, Math.ceil(estimate(messages[index])))
    const separator = selected.length ? 1 : 0
    if (usedTokens + separator + messageTokens > maximumTokens) break
    selected.unshift(messages[index])
    usedTokens += separator + messageTokens
  }
  return { messages: selected, usedTokens, omitted: messages.length - selected.length }
}
