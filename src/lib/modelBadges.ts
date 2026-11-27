import type { ModelInfo } from '../types'

export interface Badge { label: string; hint: string; tone: 'free' | 'plain' }

/**
 * Gemini API models whose text input and output are "Free of charge" in the Free Tier column of
 * https://ai.google.dev/gemini-api/docs/pricing, checked 2026-11-27. Google's model list does not say this, so it has to
 * be kept here. Exact ids only: a new or renamed model gets no badge until it is checked. (Chat models only.)
 */
const GEMINI_FREE = new Set([
  'gemini-4-hydrogen', 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite',
  'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite',
])

export function modelBadges(preset: string, id: string, info?: ModelInfo, baseUrl = ''): Badge[] {
  const out: Badge[] = []
  // OpenRouter names its free variants. Zero prices alone are not enough: some per-request models list them too.
  if (preset === 'openrouter' && (id.endsWith(':free') || id === 'openrouter/free'))
    out.push({ label: 'Free', hint: 'Free on OpenRouter, with rate limits', tone: 'free' })
  const google = preset === 'gemini' || baseUrl.includes('//generativelanguage.googleapis.com/')
  if (google && (GEMINI_FREE.has(id) || id.startsWith('gemma-4')))
    out.push({ label: 'Free tier', hint: 'Has a free tier in the Gemini API, with rate limits. A project with billing turned on is charged. Google may use free-tier data to improve its products.', tone: 'free' })
  // a local server can also pass requests on to a hosted model, which its name says
  if ((preset === 'ollama' || preset === 'lmstudio') && !/cloud/i.test(id) && (!baseUrl || /\/\/(localhost|127\.|\[::1\])/.test(baseUrl)))
    out.push({ label: 'Local', hint: 'Runs on your computer, with no API charges', tone: 'free' })
  if (info?.vision) out.push({ label: 'Vision', hint: 'Accepts images', tone: 'plain' })
  if (info?.reasoning) out.push({ label: 'Reasoning', hint: 'Supports reasoning', tone: 'plain' })
  return out
}

/** What a server's model list says a model can do. Only OpenRouter and a few others say anything. */
export function capabilities(m: any): Pick<ModelInfo, 'vision' | 'reasoning'> {
  const inputs = m?.architecture?.input_modalities ?? m?.input_modalities
  return {
    ...(Array.isArray(inputs) && inputs.includes('image') ? { vision: true } : {}),
    ...(Array.isArray(m?.supported_parameters) && m.supported_parameters.includes('reasoning') ? { reasoning: true } : {}),
  }
}
