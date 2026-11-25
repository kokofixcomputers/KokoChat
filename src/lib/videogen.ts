import { del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval'
import { useEffect, useState } from 'react'
import type { Provider } from '../types'
import { authHeaders, cleanBase } from './providers'

export type VideoAspect = 'landscape' | 'portrait'

/** Models people can pick. OpenAI's Sora API was shut down on 2026-09-24, but relays may still serve the same /videos API. */
export const VIDEO_MODEL_SUGGESTIONS = ['gemini-omni-1.2-flash', 'sora-2', 'sora-2-pro']

/** Which wire format a model speaks. */
export const videoBackend = (p: Provider, model: string): 'gemini' | 'openai' => (p.preset === 'gemini' || /^gemini-/.test(model) ? 'gemini' : 'openai')

async function readError(res: Response) {
  let msg = `${res.status} ${res.statusText}`
  try { const j = await res.json(); msg = j?.error?.message ?? j?.message ?? msg } catch { /* ignore */ }
  return msg
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((res, rej) => {
  const t = setTimeout(res, ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Aborted', 'AbortError')) }, { once: true })
})

export interface VideoOpts { aspect: VideoAspect; seconds: number; resolution: string }
export interface GeneratedVideo { blob: Blob; revisedPrompt?: string }

/* ------------------------------ OpenAI-style ------------------------------ */
const SORA_SIZES: Record<VideoAspect, string> = { landscape: '1280x720', portrait: '720x1280' }
const soraSeconds = (s: number) => (s <= 6 ? '4' : s <= 10 ? '8' : '12')

async function openaiVideo(p: Provider, model: string, prompt: string, o: VideoOpts, signal?: AbortSignal, onProgress?: (pct: number, status: string) => void): Promise<GeneratedVideo> {
  const base = cleanBase(p.baseUrl)
  const res = await fetch(`${base}/videos`, { method: 'POST', headers: authHeaders(p), body: JSON.stringify({ model, prompt, seconds: soraSeconds(o.seconds), size: SORA_SIZES[o.aspect] }), signal })
  if (!res.ok) throw new Error(await readError(res))
  let job = await res.json()
  if (!job?.id) throw new Error('The video API did not return a job.')
  onProgress?.(job.progress ?? 0, job.status ?? 'queued')
  for (let i = 0; i < 180 && job.status !== 'completed'; i++) { // up to ~15 minutes
    if (job.status === 'failed') throw new Error(job.error?.message ?? 'Video generation failed.')
    await sleep(job.status === 'queued' ? 3000 : 5000, signal)
    const r = await fetch(`${base}/videos/${encodeURIComponent(job.id)}`, { headers: authHeaders(p), signal })
    if (!r.ok) throw new Error(await readError(r))
    job = await r.json()
    onProgress?.(job.progress ?? 0, job.status)
  }
  if (job.status !== 'completed') throw new Error('Video generation timed out.')
  const c = await fetch(`${base}/videos/${encodeURIComponent(job.id)}/content`, { headers: authHeaders(p), signal })
  if (!c.ok) throw new Error(await readError(c))
  const blob = await c.blob()
  return { blob: blob.type.startsWith('video/') ? blob : new Blob([blob], { type: 'video/mp4' }) }
}

/* --------------------------------- Gemini --------------------------------- */
/** Gemini's video models answer synchronously with the clip as base64 (POST /v1beta/interactions). */
async function geminiVideo(p: Provider, model: string, prompt: string, o: VideoOpts, signal?: AbortSignal, onProgress?: (pct: number, status: string) => void): Promise<GeneratedVideo> {
  const root = cleanBase(p.baseUrl).replace(/\/openai$/, '')
  onProgress?.(0, 'in_progress')
  const res = await fetch(`${root}/interactions?key=${encodeURIComponent(p.apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: prompt, response_format: { type: 'video', aspect_ratio: o.aspect === 'portrait' ? '9:16' : '16:9', resolution: o.resolution, duration: `${Math.min(15, Math.max(3, Math.round(o.seconds)))}s` } }),
    signal,
  })
  if (!res.ok) throw new Error(await readError(res))
  const j = await res.json()
  for (const step of j.steps ?? []) {
    if (step.type !== 'model_output') continue
    for (const part of step.content ?? []) {
      if (part.type === 'video' && part.data) {
        const bin = atob(part.data)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        return { blob: new Blob([bytes], { type: part.mime_type || 'video/mp4' }) }
      }
    }
  }
  throw new Error('The model returned no video. It may have declined the request; try rephrasing.')
}

export const generateVideo = (p: Provider, model: string, prompt: string, o: VideoOpts, signal?: AbortSignal, onProgress?: (pct: number, status: string) => void) =>
  (videoBackend(p, model) === 'gemini' ? geminiVideo : openaiVideo)(p, model, prompt, o, signal, onProgress)

/* ------------------------------ local storage ------------------------------ */
// Clips are megabytes, so they live in IndexedDB (not in the chat, which is synced and size-limited).
const key = (id: string) => `video:${id}`
export const saveVideo = (id: string, blob: Blob) => idbSet(key(id), blob)
export const loadVideo = async (id: string) => (await idbGet(key(id))) as Blob | undefined
export const deleteVideo = (id: string) => idbDel(key(id))

/** An object URL for a stored clip ('missing' when it is not on this device). */
export function useVideoUrl(id: string): string | 'missing' | null {
  const [url, setUrl] = useState<string | 'missing' | null>(null)
  useEffect(() => {
    let live = true
    let made: string | undefined
    loadVideo(id).then((b) => { if (!live) return; if (!b) return setUrl('missing'); made = URL.createObjectURL(b); setUrl(made) }, () => live && setUrl('missing'))
    return () => { live = false; if (made) URL.revokeObjectURL(made) }
  }, [id])
  return url
}
