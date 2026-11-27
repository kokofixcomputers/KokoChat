import type { ModelInfo, Provider } from '../types'
import { uid } from './utils'
import { useStore } from '../store'
import { isDesktop } from './desktop'
import { capabilities } from './modelBadges'

export interface Preset {
  id: string
  name: string
  baseUrl: string
  apiMode: 'responses' | 'chat' | 'anthropic'
  keyOptional?: boolean
  hint?: string
  /** where to create an API key; for local servers, where to get the app instead */
  keyUrl?: string
  color: string
  /** asks for a Cloudflare account id (the base URL is built from it) */
  account?: boolean
  /** model id filter for model listing */
  filter?: (id: string) => boolean
}

const openaiChatOnly = (id: string) =>
  /^(gpt|o\d|chatgpt|codex)/.test(id) &&
  !/(embedding|whisper|tts|dall-e|moderation|transcribe|realtime|audio|image|search-preview|instruct|davinci|babbage)/.test(id)

export const PRESETS: Preset[] = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiMode: 'responses', keyUrl: 'https://platform.openai.com/api-keys', color: '#10a37f', filter: openaiChatOnly, hint: 'Uses the Responses API' },
  { id: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', apiMode: 'anthropic', keyUrl: 'https://platform.claude.com/settings/keys', color: '#d97757', hint: 'Claude models (Messages API)' },
  { id: '1minrelay', name: '1minRelay v4', baseUrl: 'https://v4.kokodev.cc/v1', apiMode: 'responses', keyUrl: 'https://v4.kokodev.cc', color: '#7c3aed', hint: 'OpenAI-compatible relay' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', apiMode: 'responses', keyUrl: 'https://openrouter.ai/settings/keys', color: '#6366f1' },
  { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', apiMode: 'responses', keyUrl: 'https://console.groq.com/keys', color: '#f55036' },
  { id: 'together', name: 'Together AI', baseUrl: 'https://api.together.xyz/v1', apiMode: 'responses', keyUrl: 'https://api.together.ai/settings/api-keys', color: '#0f6fff' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', apiMode: 'responses', keyUrl: 'https://platform.deepseek.com/api_keys', color: '#4d6bfe' },
  { id: 'mistral', name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', apiMode: 'responses', keyUrl: 'https://console.mistral.ai/api-keys', color: '#fa520f' },
  { id: 'xai', name: 'xAI', baseUrl: 'https://api.x.ai/v1', apiMode: 'responses', keyUrl: 'https://console.x.ai', color: '#111827' },
  { id: 'gemini', name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiMode: 'chat', keyUrl: 'https://aistudio.google.com/apikey', color: '#3b82f6', filter: (id) => /^(gemini|gemma)/.test(id) && !/(embedding|tts|image|live|aqa|imagen|veo|robotics|transcribe|native-audio)/.test(id) },
  { id: 'qwen', name: 'Alibaba Qwen', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', apiMode: 'chat', keyUrl: 'https://modelstudio.console.alibabacloud.com/?tab=playground#/api-key', color: '#615ced', hint: 'DashScope (international)' },
  { id: 'zai', name: 'Z.ai (GLM)', baseUrl: 'https://api.z.ai/api/paas/v4', apiMode: 'responses', keyUrl: 'https://z.ai/manage-apikey/apikey-list', color: '#111827' },
  { id: 'ollama', name: 'Ollama', baseUrl: 'http://localhost:11434/v1', apiMode: 'responses', keyOptional: true, keyUrl: 'https://ollama.com/download', color: '#78716c', hint: 'Local — no key needed' },
  { id: 'lmstudio', name: 'LM Studio', baseUrl: 'http://localhost:1234/v1', apiMode: 'responses', keyOptional: true, keyUrl: 'https://lmstudio.ai/download', color: '#8b5cf6', hint: 'Local — no key needed' },
  { id: 'cloudflare', name: 'Cloudflare Workers AI', baseUrl: '', apiMode: 'chat', account: true, keyUrl: 'https://dash.cloudflare.com/profile/api-tokens', color: '#f6821f', hint: 'Needs your account ID and an API token' },
  { id: 'custom', name: 'Custom provider', baseUrl: '', apiMode: 'responses', keyOptional: true, color: '#0ea5e9', hint: 'Any endpoint: pick its API shape' },
]

export const presetOf = (id: string) => PRESETS.find((p) => p.id === id) ?? PRESETS[PRESETS.length - 1]

export function makeProvider(presetId: string): Provider {
  const p = presetOf(presetId)
  return { id: uid(), preset: p.id, name: p.name, baseUrl: p.baseUrl, apiKey: '', apiMode: p.apiMode, models: [], ...(p.account ? { accountId: '' } : {}) }
}

const CF_API = 'https://api.cloudflare.com/client/v4'
export const cfBase = (accountId: string) => (accountId.trim() ? `${CF_API}/accounts/${accountId.trim()}/ai/v1` : '')

/**
 * The URL to call for a provider's base URL. Cloudflare's API cannot be called from a web page (it sends no CORS headers),
 * so in a browser those calls go through the sync server; the desktop app calls it directly.
 */
export function cleanBase(u: string) {
  const b = u.trim().replace(/\/+$/, '')
  if (b.startsWith(CF_API + '/') && !isDesktop()) {
    const sync = (useStore.getState().sync.url || (import.meta.env.VITE_SYNC_URL as string | undefined) || '').replace(/\/+$/, '')
    if (sync) return `${sync}/v1/cf${b.slice(CF_API.length)}`
  }
  return b
}

export function authHeaders(p: Provider): Record<string, string> {
  if (p.apiMode === 'anthropic') {
    return {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true', // lets Anthropic's API be called straight from a browser
      ...(p.apiKey ? { 'x-api-key': p.apiKey } : {}),
    }
  }
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (p.apiKey) h.Authorization = `Bearer ${p.apiKey}`
  if (p.preset === 'openrouter') { h['X-Title'] = 'Koko Chat' }
  return h
}

/** Workers AI lists its models (with what each one does) at a different place than the chat endpoint. */
async function fetchCloudflareModels(p: Provider): Promise<{ models: ModelInfo[]; embedModels: ModelInfo[] }> {
  const acct = /\/accounts\/([0-9a-f]{32})\//.exec(p.baseUrl)?.[1] ?? p.accountId?.trim()
  if (!acct || !/^[0-9a-f]{32}$/.test(acct)) throw new Error('Enter your Cloudflare account ID (32 letters and numbers, from the dashboard).')
  const base = cleanBase(`${CF_API}/accounts/${acct}/ai`)
  const chat = new Map<string, ModelInfo>(), embed = new Map<string, ModelInfo>()
  for (let page = 1; page <= 8; page++) {
    const res = await fetch(`${base}/models/search?per_page=100&page=${page}`, { headers: authHeaders(p) })
    const j: any = await res.json().catch(() => ({}))
    if (!res.ok || j.success === false) throw new Error(`${res.status} ${j.errors?.[0]?.message ?? res.statusText}`)
    const list: any[] = Array.isArray(j.result) ? j.result : j.result?.models ?? []
    for (const m of list) {
      const id = String(m.name ?? m.id ?? '')
      const task = String(m.task?.name ?? '')
      if (!id.startsWith('@')) continue
      const info = { id, created: typeof m.created_at === 'string' ? Math.round(Date.parse(m.created_at) / 1000) || undefined : undefined }
      if (/text generation/i.test(task)) chat.set(id, info)
      else if (/embedding/i.test(task)) embed.set(id, info)
    }
    const pages = Number(j.result_info?.total_pages ?? 0)
    if (list.length < 100 || (pages && page >= pages)) break
  }
  const sort = (a: ModelInfo, b: ModelInfo) => a.id.localeCompare(b.id)
  return { models: [...chat.values()].sort(sort), embedModels: [...embed.values()].sort(sort) }
}

/** Chat models, plus the embedding models when the provider lists them apart from the rest (Cloudflare). */
export async function fetchProviderModels(p: Provider): Promise<{ models: ModelInfo[]; embedModels?: ModelInfo[] }> {
  if (p.preset === 'cloudflare') return fetchCloudflareModels(p)
  return { models: await fetchModels(p) }
}

export async function fetchModels(p: Provider): Promise<ModelInfo[]> {
  if (p.preset === 'cloudflare') return (await fetchCloudflareModels(p)).models
  const res = await fetch(`${cleanBase(p.baseUrl)}/models${p.apiMode === 'anthropic' ? '?limit=1000' : ''}`, { headers: authHeaders(p) })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}${t ? ` — ${t.slice(0, 200)}` : ''}`)
  }
  const json = await res.json()
  const raw: any[] = Array.isArray(json) ? json : json.data ?? json.models ?? []
  const preset = PRESETS.find((x) => x.id === p.preset)
  let list: ModelInfo[] = raw
    .map((m) => ({ ...capabilities(m), id: String(m.id ?? m.name ?? '').replace(/^models\//, ''), created: typeof m.created === 'number' ? m.created : typeof m.created_at === 'string' ? Math.round(Date.parse(m.created_at) / 1000) || undefined : undefined }))
    .filter((m) => m.id)
  if (preset?.filter) list = list.filter((m) => preset.filter!(m.id))
  list.sort((a, b) => (b.created ?? 0) - (a.created ?? 0) || a.id.localeCompare(b.id))
  return list
}

/** Groq, whether it was added from the list or typed in as a custom provider. */
const isGroq = (p: Provider) => p.preset === 'groq' || /\/\/api\.groq\.com\//.test(p.baseUrl)

/**
 * The parts of a Responses API request that not every server takes. Groq rejects the whole request over `store` or
 * `include` (https://console.groq.com/docs/responses-api), and its docs only show `reasoning.effort`.
 */
export function responsesOptions(p: Provider, reasoning: boolean, effort: string): Record<string, unknown> {
  if (isGroq(p)) {
    // it has no "minimal": low is the closest
    return reasoning && effort !== 'auto' ? { reasoning: { effort: effort === 'minimal' ? 'low' : effort } } : {}
  }
  if (!reasoning) return { store: false }
  // the encrypted reasoning lets a tool loop carry its thinking forward without the server storing anything
  return { store: false, reasoning: { summary: 'auto', ...(effort !== 'auto' ? { effort } : {}) }, include: ['reasoning.encrypted_content'] }
}

/** Heuristic: does this model accept a reasoning effort parameter? */
export function supportsReasoning(p: Provider, model: string) {
  if (p.forceReasoning) return true
  // Claude models that support extended thinking
  if (p.apiMode === 'anthropic') return /claude-(3-7|(opus|sonnet|haiku)-[4-9])/.test(model)
  if (p.preset === 'openai') return /^(o\d|gpt-5|codex)/.test(model) && !/chat-latest/.test(model)
  if (p.preset === 'openrouter') return /(o\d|gpt-5|gpt-oss|deepseek-r1|claude|gemini|grok|qwen3)/.test(model)
  if (p.preset === 'gemini') return /^gemini-(2\.5|3|4)/.test(model)
  if (p.preset === 'groq') return /(gpt-oss|qwen3)/.test(model)
  if (p.preset === 'xai') return /(grok-3-mini|grok-4)/.test(model)
  return false
}
