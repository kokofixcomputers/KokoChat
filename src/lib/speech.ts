import type { Provider, Settings } from '../types'
import { authHeaders, cleanBase } from './providers'
import { useStore } from '../store'

/* ------------------------------ helpers ------------------------------ */
export const STT_SUGGESTIONS: Record<string, string[]> = {
  openai: ['gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1'],
  groq: ['whisper-large-v3-turbo', 'whisper-large-v3'],
}
export const TTS_SUGGESTIONS: Record<string, string[]> = { openai: ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'] }
export const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse']

export function pickProvider(providers: Provider[], id: string, prefer: string[]) {
  return (
    providers.find((p) => p.id === id) ??
    prefer.map((x) => providers.find((p) => p.preset === x && p.apiKey && p.apiMode !== 'anthropic')).find(Boolean) ??
    providers.find((p) => p.apiMode !== 'anthropic' && (p.apiKey || ['ollama', 'lmstudio', 'custom'].includes(p.preset)))
  )
}

export function plainText(md: string) {
  return md
    .replace(/```[\s\S]*?```/g, ' (code block omitted) ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[\d{1,2}\]/g, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/(\*\*|__|\*|_|~~)/g, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\|/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/* ------------------------- speech to text ---------------------------- */
export interface Dictation {
  level: () => number
  stop: () => Promise<string>
  cancel: () => void
}

export async function transcribe(p: Provider, model: string, blob: Blob, language?: string): Promise<string> {
  const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm'
  const fd = new FormData()
  fd.append('file', blob, `speech.${ext}`)
  fd.append('model', model)
  if (language) fd.append('language', language)
  const h = authHeaders(p)
  delete h['Content-Type']
  const res = await fetch(`${cleanBase(p.baseUrl)}/audio/transcriptions`, { method: 'POST', headers: h, body: fd })
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try { const j = await res.json(); msg = j?.error?.message ?? msg } catch { /* ignore */ }
    throw new Error(`Transcription failed: ${msg}`)
  }
  const j = await res.json()
  return String(j.text ?? '').trim()
}

/** Send a recording to the KokoChat worker, which runs Whisper on Cloudflare Workers AI. */
export async function transcribeKoko(blob: Blob, language?: string): Promise<string> {
  const sync = useStore.getState().sync
  const base = (sync.url || (import.meta.env.VITE_SYNC_URL as string | undefined) || '').replace(/\/+$/, '')
  if (!base || !sync.token) throw new Error('Sign in under Settings → Sync to use KokoChat transcription, or pick another host in Settings → Voice.')
  const res = await fetch(`${base}/v1/stt${language ? `?language=${encodeURIComponent(language)}` : ''}`, {
    method: 'POST', headers: { Authorization: `Bearer ${sync.token}`, 'Content-Type': blob.type || 'application/octet-stream' }, body: blob,
  })
  const j = await res.json().catch(() => ({} as any))
  if (!res.ok) throw new Error(`Transcription failed: ${j?.error ?? `${res.status} ${res.statusText}`}`)
  return String(j.text ?? '').trim()
}

export async function startDictation(settings: Settings, providers: Provider[]): Promise<Dictation> {
  const { engine, providerId, model, language } = settings.stt
  let provider: Provider | undefined
  if (engine === 'koko') {
    const sy = useStore.getState().sync
    if (!sy.token) throw new Error('Sign in under Settings → Sync to use KokoChat transcription, or pick another host in Settings → Voice.')
  }
  if (engine === 'api') {
    provider = pickProvider(providers, providerId, ['openai', 'groq'])
    if (!provider) throw new Error('Add a provider with an API key, then pick a speech-to-text model in Settings → Voice.')
  }
  const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
  if (engine === 'browser' && !SR) throw new Error('This browser has no built-in speech recognition. Choose a provider model in Settings → Voice.')

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => {
    throw new Error('Microphone access was denied. Allow it in your browser and try again.')
  })
  const ctx = new AudioContext()
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 256
  ctx.createMediaStreamSource(stream).connect(analyser)
  const buf = new Uint8Array(analyser.fftSize)
  const level = () => {
    analyser.getByteTimeDomainData(buf)
    let sum = 0
    for (const v of buf) sum += ((v - 128) / 128) ** 2
    return Math.min(1, Math.sqrt(sum / buf.length) * 4)
  }
  const cleanup = () => { stream.getTracks().forEach((t) => t.stop()); ctx.close().catch(() => {}) }

  if (engine === 'browser') {
    const rec = new SR()
    rec.continuous = true
    rec.interimResults = false
    if (language) rec.lang = language
    let text = ''
    rec.onresult = (e: any) => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) text += e.results[i][0].transcript + ' ' }
    const ended = new Promise<void>((r) => { rec.onend = () => r(); rec.onerror = () => r() })
    rec.start()
    return {
      level,
      cancel: () => { rec.abort(); cleanup() },
      stop: async () => { rec.stop(); await Promise.race([ended, new Promise((r) => setTimeout(r, 2500))]); cleanup(); return text.trim() },
    }
  }

  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m))
  const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
  const chunks: Blob[] = []
  mr.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  mr.start()
  return {
    level,
    cancel: () => { try { mr.stop() } catch { /* ignore */ } cleanup() },
    stop: async () => {
      await new Promise<void>((r) => { mr.onstop = () => r(); mr.stop() })
      cleanup()
      const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' })
      if (blob.size < 800) return ''
      return engine === 'koko' ? transcribeKoko(blob, language || undefined) : transcribe(provider!, model, blob, language || undefined)
    },
  }
}

/* ------------------------- text to speech ---------------------------- */
let audio: HTMLAudioElement | null = null
let token = 0

export function stopSpeaking() {
  token++
  window.speechSynthesis?.cancel()
  if (audio) { audio.pause(); audio.src = ''; }
}

function chunk(text: string, max = 3000) {
  const out: string[] = []
  let cur = ''
  for (const part of text.split(/(?<=[.!?\n])\s+/)) {
    if ((cur + ' ' + part).length > max && cur) { out.push(cur); cur = part } else cur = cur ? cur + ' ' + part : part
  }
  if (cur) out.push(cur)
  return out
}

async function fetchSpeech(p: Provider, model: string, voice: string, input: string) {
  const res = await fetch(`${cleanBase(p.baseUrl)}/audio/speech`, {
    method: 'POST', headers: authHeaders(p), body: JSON.stringify({ model, voice, input, response_format: 'mp3' }),
  })
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try { const j = await res.json(); msg = j?.error?.message ?? msg } catch { /* ignore */ }
    throw new Error(`Speech failed: ${msg}`)
  }
  return URL.createObjectURL(await res.blob())
}

export async function speak(settings: Settings, providers: Provider[], markdown: string, onPhase: (p: 'loading' | 'playing' | 'idle') => void) {
  stopSpeaking()
  const my = token
  const text = plainText(markdown)
  if (!text) return onPhase('idle')
  const t = settings.tts
  try {
    onPhase('loading')
    if (t.engine === 'browser') {
      const synth = window.speechSynthesis
      if (!synth) throw new Error('Speech synthesis is not supported in this browser.')
      const parts = chunk(text, 200)
      await new Promise<void>((resolve, reject) => {
        let i = 0
        const next = () => {
          if (my !== token) return resolve()
          if (i >= parts.length) return resolve()
          const u = new SpeechSynthesisUtterance(parts[i++])
          const v = synth.getVoices().find((x) => x.voiceURI === t.voiceURI)
          if (v) u.voice = v
          u.rate = t.rate
          u.onstart = () => my === token && onPhase('playing')
          u.onend = next
          u.onerror = (e) => (e.error === 'canceled' || e.error === 'interrupted' ? resolve() : reject(new Error('Speech synthesis failed')))
          synth.speak(u)
        }
        next()
      })
    } else {
      const p = pickProvider(providers, t.providerId, ['openai'])
      if (!p) throw new Error('Add a provider with an API key, then pick a text-to-speech model in Settings → Voice.')
      const parts = chunk(text)
      audio ??= new Audio()
      let pending = fetchSpeech(p, t.model, t.voice, parts[0])
      for (let i = 0; i < parts.length; i++) {
        const url = await pending
        if (my !== token) return URL.revokeObjectURL(url)
        if (i + 1 < parts.length) pending = fetchSpeech(p, t.model, t.voice, parts[i + 1])
        const a = audio
        a.src = url
        a.playbackRate = t.rate
        await new Promise<void>((resolve, reject) => {
          a.onended = () => resolve()
          a.onpause = () => my !== token && resolve()
          a.onerror = () => (my !== token ? resolve() : reject(new Error('Audio playback failed')))
          a.play().then(() => my === token && onPhase('playing')).catch(reject)
        })
        URL.revokeObjectURL(url)
        if (my !== token) return
      }
    }
    if (my === token) onPhase('idle')
  } catch (e) {
    if (my === token) onPhase('idle')
    throw e
  }
}
