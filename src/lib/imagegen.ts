import type { Provider } from '../types'
import { authHeaders, cleanBase } from './providers'
import { imageCost } from './pricing'

export type Aspect = 'auto' | 'square' | 'landscape' | 'portrait'

/** Popular image models. The first group works with an OpenAI provider, then Google, xAI and Alibaba. */
export const IMAGE_MODEL_SUGGESTIONS = [
  'gpt-image-1', 'gpt-image-1.5', 'gpt-image-2', 'gpt-image-1-mini', 'dall-e-3',
  'gemini-nano-banana-2.1', 'gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image', 'gemini-3-pro-image',
  'grok-imagine-image', 'grok-imagine-image-2.0',
  'qwen-image-2.0', 'qwen-image-2.0-pro', 'qwen-image-3.0', 'qwen-image-3.0-pro',
]

export type ImageBackend = 'openai' | 'gemini' | 'xai' | 'qwen'
export const imageBackend = (p: Provider, model: string): ImageBackend =>
  /^gemini-|nano-banana/.test(model) || p.preset === 'gemini' ? 'gemini'
  : /^grok-/.test(model) || p.preset === 'xai' ? 'xai'
  : /^(qwen-image|wan\d|z-image)/.test(model) || p.preset === 'qwen' ? 'qwen'
  : 'openai'

/** Which kind of provider a model needs (for picking a default provider). */
export const imageProviderPref = (model: string) => (/^gemini-|nano-banana/.test(model) ? 'gemini' : /^grok-/.test(model) ? 'xai' : /^(qwen-image|wan\d|z-image)/.test(model) ? 'qwen' : 'openai')

const isDalle3 = (m: string) => /dall-e-3/.test(m)
const isDalle2 = (m: string) => /dall-e-2/.test(m)

export function sizeFor(model: string, aspect: Aspect): string {
  if (isDalle2(model)) return '1024x1024'
  if (isDalle3(model)) return { auto: '1024x1024', square: '1024x1024', landscape: '1792x1024', portrait: '1024x1792' }[aspect]
  // never send "auto": some servers only accept the explicit sizes
  return { auto: '1024x1024', square: '1024x1024', landscape: '1536x1024', portrait: '1024x1536' }[aspect]
}

async function readError(res: Response) {
  let msg = `${res.status} ${res.statusText}`
  try {
    const j = await res.json()
    msg = j?.error?.message ?? j?.message ?? msg
  } catch { /* ignore */ }
  return msg
}

export interface GeneratedImage { dataUrl: string; revisedPrompt?: string; /** USD for this image, when known */ costUsd?: number | null }

const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(r.result as string)
  r.onerror = () => reject(r.error)
  r.readAsDataURL(blob)
})

/** Download a temporary image URL so it stays viewable after it expires (falls back to the URL itself). */
async function keepUrl(url: string, signal?: AbortSignal) {
  try { return await blobToDataUrl(await (await fetch(url, { signal })).blob()) } catch { return url }
}

const ASPECT_RATIO = { auto: '1:1', square: '1:1', landscape: '3:2', portrait: '2:3' } as const

/* --------------------------------- Google --------------------------------- */
async function geminiImage(p: Provider, model: string, prompt: string, o: { aspect: Aspect; quality: string }, signal?: AbortSignal): Promise<GeneratedImage> {
  const root = cleanBase(p.baseUrl).replace(/\/openai$/, '')
  const size = o.quality === 'high' ? '2K' : '1K'
  const format: any = { type: 'image', mime_type: 'image/jpeg', aspect_ratio: ASPECT_RATIO[o.aspect] }
  if (!/gemini-2\.5/.test(model)) format.image_size = size
  const res = await fetch(`${root}/interactions?key=${encodeURIComponent(p.apiKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, input: prompt, response_format: format }), signal })
  if (!res.ok) throw new Error(await readError(res))
  const j = await res.json()
  let data: string | undefined = j.output_image?.data
  let mime = j.output_image?.mime_type
  for (const step of j.steps ?? []) {
    if (step.type !== 'model_output') continue
    for (const part of step.content ?? []) if (!data && part.type === 'image' && part.data) { data = part.data; mime = part.mime_type }
  }
  if (!data) throw new Error('The model returned no image. It may have declined the request; try rephrasing.')
  return { dataUrl: `data:${mime || 'image/jpeg'};base64,${data}`, costUsd: imageCost(model, { quality: o.quality, size }) }
}

/* ---------------------------------- xAI ----------------------------------- */
async function xaiImage(p: Provider, model: string, prompt: string, o: { aspect: Aspect; quality: string }, signal?: AbortSignal): Promise<GeneratedImage> {
  const body: any = { model, prompt, n: 1, aspect_ratio: ASPECT_RATIO[o.aspect], resolution: '1k', response_format: 'b64_json' }
  if (/2\.0/.test(model)) body.quality = o.quality === 'low' ? 'low' : o.quality === 'medium' ? 'medium' : 'auto' // only Image 2.0 takes a quality
  const res = await fetch(`${cleanBase(p.baseUrl)}/images/generations`, { method: 'POST', headers: authHeaders(p), body: JSON.stringify(body), signal })
  if (!res.ok) throw new Error(await readError(res))
  const j = await res.json()
  const item = j.data?.[0]
  if (!item) throw new Error('The image API returned no image.')
  // xAI reports the exact cost of the request
  const ticks = Number(j.usage?.cost_in_usd_ticks)
  const costUsd = ticks > 0 ? ticks / 1e10 : imageCost(model, { quality: o.quality })
  if (item.b64_json) return { dataUrl: `data:${item.mime_type || 'image/jpeg'};base64,${item.b64_json}`, costUsd }
  if (item.url) return { dataUrl: await keepUrl(item.url, signal), costUsd }
  throw new Error('Unrecognized image response.')
}

/* --------------------------------- Alibaba -------------------------------- */
const QWEN_SIZE = { auto: '1024*1024', square: '1024*1024', landscape: '1536*1024', portrait: '1024*1536' } as const
async function qwenImage(p: Provider, model: string, prompt: string, o: { aspect: Aspect; quality: string }, signal?: AbortSignal): Promise<GeneratedImage> {
  let origin = 'https://dashscope-intl.aliyuncs.com'
  try { const u = new URL(cleanBase(p.baseUrl)); if (!/compatible-mode/.test(u.pathname) || /aliyuncs|maas/.test(u.host)) origin = u.origin } catch { /* default */ }
  // the model already got an enhanced prompt from the chat model, so Alibaba's own rewriting is off
  const body = { model, input: { messages: [{ role: 'user', content: [{ text: prompt }] }] }, parameters: { size: QWEN_SIZE[o.aspect], n: 1, prompt_extend: false, watermark: false } }
  const res = await fetch(`${origin}/api/v1/services/aigc/multimodal-generation/generation`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.apiKey}` }, body: JSON.stringify(body), signal })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || j.code) throw new Error(j.message ?? `${res.status} ${res.statusText}`)
  const img = (j.output?.choices?.[0]?.message?.content ?? []).find((c: any) => c.image)?.image
  if (!img) throw new Error('The image API returned no image.')
  return { dataUrl: await keepUrl(img, signal), costUsd: imageCost(model, { quality: o.quality }) } // the link expires after 24 hours, so the picture is saved now
}

/* --------------------------------- OpenAI --------------------------------- */
async function openaiImage(p: Provider, model: string, prompt: string, o: { aspect: Aspect; quality: string }, signal?: AbortSignal): Promise<GeneratedImage> {
  const body: any = { model, prompt, n: 1, size: sizeFor(model, o.aspect) }
  // Always send an explicit quality: some servers reject "auto"/missing and require low | medium | high.
  const q = ['low', 'medium', 'high'].includes(o.quality) ? o.quality : 'medium'
  if (isDalle3(model)) {
    body.response_format = 'b64_json'
    body.quality = q === 'high' ? 'hd' : 'standard'
  } else if (isDalle2(model)) {
    body.response_format = 'b64_json'
  } else {
    body.quality = q
  }
  const res = await fetch(`${cleanBase(p.baseUrl)}/images/generations`, { method: 'POST', headers: authHeaders(p), body: JSON.stringify(body), signal })
  if (!res.ok) throw new Error(await readError(res))
  const j = await res.json()
  const item = j.data?.[0]
  if (!item) throw new Error('The image API returned no image.')
  const costUsd = imageCost(model, { quality: q, usage: j.usage })
  if (item.b64_json) {
    const mime = body.output_format === 'jpeg' ? 'image/jpeg' : 'image/png'
    return { dataUrl: `data:${mime};base64,${item.b64_json}`, revisedPrompt: item.revised_prompt, costUsd }
  }
  if (item.url) return { dataUrl: await keepUrl(item.url, signal), revisedPrompt: item.revised_prompt, costUsd }
  throw new Error('Unrecognized image response.')
}

export function generateImage(p: Provider, model: string, prompt: string, opts: { aspect: Aspect; quality: string }, signal?: AbortSignal): Promise<GeneratedImage> {
  const b = imageBackend(p, model)
  return (b === 'gemini' ? geminiImage : b === 'xai' ? xaiImage : b === 'qwen' ? qwenImage : openaiImage)(p, model, prompt, opts, signal)
}
