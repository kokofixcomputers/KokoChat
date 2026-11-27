import type { AdvancedSettings, Provider } from '../types'

export type AdvancedKey = Exclude<keyof AdvancedSettings, 'enabled'>

export interface Param {
  key: AdvancedKey
  label: string
  /** the name in API requests, shown so people can match it to their provider's docs */
  api: string
  min: number
  max: number
  step: number
  /** where the slider starts when someone first sets it */
  start: number
  description: string
  works: string
}

export const PARAMS: Param[] = [
  { key: 'temperature', label: 'Temperature', api: 'temperature', min: 0, max: 2, step: 0.05, start: 1,
    description: 'How adventurous the wording is. Lower values give focused, predictable replies, good for facts and code. Higher values give more varied, creative ones; very high values can turn into nonsense. 0 is the most consistent, but replies can still differ.',
    works: 'Not sent to Anthropic. Many reasoning models reject it.' },
  { key: 'topP', label: 'Top P', api: 'top_p', min: 0, max: 1, step: 0.01, start: 1,
    description: 'Limits each next word to the most likely choices that together add up to this probability. 0.1 only considers a few very likely words; 1 considers them all. It does a similar job to temperature, so usually change one or the other.',
    works: 'Not sent to Anthropic. Many reasoning models reject it.' },
  { key: 'topK', label: 'Top K', api: 'top_k', min: 1, max: 200, step: 1, start: 40,
    description: 'Limits each next word to this many of the most likely choices. Lower is more predictable; higher allows more variety.',
    works: 'Only sent over Chat Completions, and not to OpenAI, Google or Groq. Mostly for OpenRouter and local models.' },
  { key: 'maxTokens', label: 'Maximum reply length', api: 'max tokens', min: 256, max: 64000, step: 256, start: 4096,
    description: 'The most tokens (pieces of words; about 4 characters each in English) the model may write in one response. A reply that reaches it is cut off. On many reasoning models, hidden thinking counts towards it too. It does not make replies longer.',
    works: 'Works with every API format, up to the model’s own limit. With Anthropic extended thinking, Koko raises it if needed to leave room for the thinking.' },
  { key: 'frequencyPenalty', label: 'Frequency penalty', api: 'frequency_penalty', min: -2, max: 2, step: 0.1, start: 0,
    description: 'Discourages repeating words in proportion to how often they have already appeared. Positive values reduce repetition; negative values encourage it. Large values can make writing sound strange.',
    works: 'Chat Completions only, and not sent to Google or Groq.' },
  { key: 'presencePenalty', label: 'Presence penalty', api: 'presence_penalty', min: -2, max: 2, step: 0.1, start: 0,
    description: 'Discourages any word that has already appeared, however often. Positive values nudge the model towards new words and topics.',
    works: 'Chat Completions only, and not sent to Google or Groq.' },
]

/**
 * Adds the chosen settings to a chat request. Only values the person set are sent, and none that a provider or API
 * format is known not to take; everything else stays at the model's own default.
 */
export function applyAdvanced(body: any, p: Provider, format: 'responses' | 'chat' | 'anthropic', adv: AdvancedSettings | undefined) {
  if (!adv?.enabled) return body
  const value = (k: AdvancedKey) => {
    const v = adv[k], spec = PARAMS.find((x) => x.key === k)!
    return typeof v === 'number' && Number.isFinite(v) ? Math.min(spec.max, Math.max(spec.min, v)) : undefined
  }
  const set = (name: string, v: number | undefined) => { if (v !== undefined) body[name] = v }
  const anthropic = format === 'anthropic' && (p.preset === 'anthropic' || /\/\/api\.anthropic\.com\//.test(p.baseUrl))
  const max = value('maxTokens')
  if (max !== undefined) {
    const tokens = Math.round(max)
    if (format === 'responses') body.max_output_tokens = tokens
    else if (format === 'anthropic') body.max_tokens = Math.max(tokens, (body.thinking?.budget_tokens ?? 0) + (body.thinking ? 1024 : 0))
    // OpenAI's reasoning models only take the newer name
    else body[p.preset === 'openai' ? 'max_completion_tokens' : 'max_tokens'] = tokens
  }
  // Anthropic's current API rejects sampling settings; extended thinking does anywhere
  if (!anthropic && !body.thinking) {
    set('temperature', value('temperature'))
    set('top_p', value('topP'))
  }
  if (format === 'chat' && !/^(gemini|groq)$/.test(p.preset)) {
    if (p.preset !== 'openai') { const k = value('topK'); set('top_k', k === undefined ? undefined : Math.round(k)) }
    set('frequency_penalty', value('frequencyPenalty'))
    set('presence_penalty', value('presencePenalty'))
  }
  return body
}
