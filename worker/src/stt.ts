import type { Env } from './util'
import { HttpError, json } from './util'

const MODEL = '@cf/openai/whisper-large-v3-turbo'
const MAX_BYTES = 8 * 1024 * 1024

function b64(buf: ArrayBuffer): string {
  const u = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}

/** POST /v1/stt?language=en  — body is the raw recorded audio. Returns { text }. */
export async function transcribe(env: Env, req: Request): Promise<Response> {
  if (!env.AI) throw new HttpError(501, 'Speech-to-text is not enabled on this server.')
  const len = Number(req.headers.get('content-length') || 0)
  if (len > MAX_BYTES) throw new HttpError(413, 'Recording is too large (8 MB max).')
  const buf = await req.arrayBuffer()
  if (buf.byteLength > MAX_BYTES) throw new HttpError(413, 'Recording is too large (8 MB max).')
  if (buf.byteLength < 200) return json({ text: '' })
  const language = new URL(req.url).searchParams.get('language')?.trim()
  const input: Record<string, unknown> = { audio: b64(buf), task: 'transcribe', vad_filter: true }
  if (language && /^[a-z]{2,3}(-[A-Za-z]+)?$/.test(language)) input.language = language.slice(0, 2).toLowerCase()
  let out: any
  try { out = await env.AI.run(MODEL, input) } catch (e: any) { throw new HttpError(502, `Transcription failed: ${String(e?.message ?? e).slice(0, 200)}`) }
  return json({ text: String(out?.text ?? '').trim() })
}
