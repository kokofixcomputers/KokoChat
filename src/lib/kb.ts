import { del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval'
import type { KbFile, Provider } from '../types'
import { useStore } from '../store'
import { authHeaders, cleanBase } from './providers'
import { pickProvider } from './speech'
import { recordUsage } from './usage'
import { uid } from './utils'

interface Stored { chunks: string[]; pages?: number[]; vecs?: Float32Array; dim?: number; embedModel?: string }
const key = (id: string) => `kb:${id}`

/* ------------------------------ extraction ------------------------------ */
export const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)

async function pdfText(file: File): Promise<{ text: string; pages: number }> {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const out: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const tc = await page.getTextContent()
    let line = ''
    const lines: string[] = []
    for (const it of tc.items as any[]) {
      if (typeof it.str !== 'string') continue
      line += it.str
      if (it.hasEOL) { lines.push(line); line = '' } else if (it.str && !it.str.endsWith(' ')) line += ' '
    }
    if (line) lines.push(line)
    out.push(lines.join('\n'))
  }
  return { text: out.join('\f'), pages: doc.numPages }
}

/* -------------------------------- chunking ------------------------------- */
const CHUNK = 1000
const OVERLAP = 150

export function chunkText(text: string): { chunks: string[]; pages: number[] } {
  const chunks: string[] = []
  const pages: number[] = []
  text.split('\f').forEach((pageText, pi) => {
    const paras = pageText.replace(/\r/g, '').split(/\n{2,}/).map((p) => p.replace(/[ \t]+/g, ' ').trim()).filter(Boolean)
    let cur = ''
    const flush = () => {
      if (cur.trim()) { chunks.push(cur.trim()); pages.push(pi + 1) }
      cur = cur.length > OVERLAP ? cur.slice(-OVERLAP) : ''
    }
    for (const para of paras) {
      if (para.length > CHUNK) {
        // long paragraph: cut on sentence or line boundaries
        for (const part of para.split(/(?<=[.!?。])\s+|\n/)) {
          if ((cur + ' ' + part).length > CHUNK && cur.trim()) flush()
          cur += (cur ? ' ' : '') + part
          while (cur.length > CHUNK * 1.6) { chunks.push(cur.slice(0, CHUNK)); pages.push(pi + 1); cur = cur.slice(CHUNK - OVERLAP) }
        }
      } else {
        if ((cur + '\n\n' + para).length > CHUNK && cur.trim()) flush()
        cur += (cur ? '\n\n' : '') + para
      }
    }
    if (cur.trim()) { chunks.push(cur.trim()); pages.push(pi + 1) }
  })
  return { chunks, pages }
}

/* ------------------------------- embeddings ------------------------------ */
export function embedProvider(): { p: Provider; model: string } | null {
  const { settings, providers } = useStore.getState()
  if (!settings.rag.embed) return null
  const p = pickProvider(providers, settings.rag.providerId, ['openai']) as Provider | undefined
  if (!p || p.apiMode === 'anthropic' || (!p.apiKey && !['ollama', 'lmstudio', 'custom'].includes(p.preset))) return null
  return { p, model: settings.rag.model || 'text-embedding-3-small' }
}

async function embed(p: Provider, model: string, inputs: string[], signal?: AbortSignal): Promise<Float32Array[]> {
  const out: Float32Array[] = []
  for (let i = 0; i < inputs.length; i += 64) {
    const batch = inputs.slice(i, i + 64).map((t) => t.slice(0, 6000))
    const res = await fetch(`${cleanBase(p.baseUrl)}/embeddings`, { method: 'POST', headers: authHeaders(p), body: JSON.stringify({ model, input: batch }), signal })
    if (!res.ok) throw new Error(`Embeddings failed (${res.status})`)
    const j = await res.json()
    const data = (j.data ?? []).slice().sort((a: any, b: any) => a.index - b.index)
    if (data.length !== batch.length) throw new Error('Embeddings returned an unexpected result')
    for (const d of data) out.push(Float32Array.from(d.embedding))
    recordUsage(p.id, model, { input: Number(j.usage?.prompt_tokens ?? j.usage?.total_tokens ?? 0), output: 0 })
  }
  return out
}

/* --------------------------------- index -------------------------------- */
export const kbAccept = '.pdf,application/pdf'
export const needsIndex = (f: File, textLen?: number) => isPdf(f) || (textLen ?? 0) > 24_000

export async function indexFile(file: File, scope: KbFile['scope'], onProgress?: (s: string) => void): Promise<KbFile> {
  onProgress?.('Reading')
  let text: string
  let pageCount = 0
  if (isPdf(file)) { const r = await pdfText(file); text = r.text; pageCount = r.pages }
  else text = await file.text()
  if (!text.replace(/[\f\s]/g, '')) throw new Error(isPdf(file) ? 'No text found. This PDF may be scanned images.' : 'The file is empty.')
  onProgress?.('Splitting')
  const { chunks, pages } = chunkText(text)
  const stored: Stored = { chunks, pages: pageCount ? pages : undefined }
  const id = uid()
  let embedded = false
  const ep = embedProvider()
  if (ep && chunks.length <= 3000) {
    try {
      onProgress?.('Embedding')
      const vecs = await embed(ep.p, ep.model, chunks)
      const dim = vecs[0]?.length ?? 0
      const flat = new Float32Array(dim * vecs.length)
      vecs.forEach((v, i) => flat.set(v, i * dim))
      stored.vecs = flat; stored.dim = dim; stored.embedModel = ep.model
      embedded = dim > 0
    } catch { /* keyword search still works */ }
  }
  await idbSet(key(id), stored)
  const meta: KbFile = { id, name: file.name, size: file.size, mime: file.type || (isPdf(file) ? 'application/pdf' : 'text/plain'), chunks: chunks.length, embedded, addedAt: Date.now(), scope }
  useStore.setState((s) => ({ kbFiles: [...s.kbFiles, meta] }))
  return meta
}

export async function dropKb(ids: string[]) {
  if (!ids.length) return
  useStore.setState((s) => ({ kbFiles: s.kbFiles.filter((f) => !ids.includes(f.id)) }))
  await Promise.all(ids.map((id) => idbDel(key(id)).catch(() => {})))
}

/** Files visible to a chat: its own uploads and everything in its project. */
export function kbFilesFor(chatId?: string): KbFile[] {
  const s = useStore.getState()
  const chat = s.chats.find((c) => c.id === chatId)
  if (!chat) return []
  return s.kbFiles.filter((f) => f.scope.chat === chat.id || (!!chat.projectId && f.scope.project === chat.projectId))
}

/* --------------------------------- search -------------------------------- */
const STOP = new Set('the a an and or of to in on for with is are was were be this that it as at by from how what which who when where why do does did can could should would about into your you i me my we our they them their not no'.split(' '))
const stem = (w: string) => (w.length > 4 ? w.replace(/(ing|ed|es|s)$/, '') : w)
const tok = (s: string) => (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 1 && !STOP.has(w)).map(stem)

export interface Hit { file: KbFile; text: string; page?: number; index: number; score: number }

export async function searchKb(files: KbFile[], query: string, k = 6): Promise<Hit[]> {
  const loaded = (await Promise.all(files.map(async (f) => ({ f, d: (await idbGet(key(f.id))) as Stored | undefined })))).filter((x): x is { f: KbFile; d: Stored } => !!x.d)
  if (!loaded.length) return []
  const q = tok(query)
  const docs = loaded.flatMap(({ f, d }) => d.chunks.map((t, i) => ({ f, d, i, t, w: tok(t) })))
  // BM25
  const N = docs.length
  const avg = docs.reduce((a, x) => a + x.w.length, 0) / Math.max(1, N)
  const df = new Map<string, number>()
  for (const x of docs) for (const w of new Set(x.w)) df.set(w, (df.get(w) ?? 0) + 1)
  const bm = docs.map((x) => {
    const tf = new Map<string, number>()
    for (const w of x.w) tf.set(w, (tf.get(w) ?? 0) + 1)
    let s = 0
    for (const w of q) {
      const f = tf.get(w) ?? 0
      if (!f) continue
      const idf = Math.log(1 + (N - (df.get(w) ?? 0) + 0.5) / ((df.get(w) ?? 0) + 0.5))
      s += idf * ((f * 2.2) / (f + 1.2 * (0.25 + (0.75 * x.w.length) / avg)))
    }
    return s
  })
  // semantic (only against files embedded with the model we can embed the query with)
  let sem: number[] | null = null
  const ep = embedProvider()
  if (ep && loaded.some(({ d }) => d.vecs && d.embedModel === ep.model)) {
    try {
      const [qv] = await embed(ep.p, ep.model, [query])
      let qn = 0
      for (const x of qv) qn += x * x
      qn = Math.sqrt(qn) || 1
      sem = docs.map((x) => {
        if (!x.d.vecs || x.d.embedModel !== ep.model || !x.d.dim || x.d.dim !== qv.length) return -1
        let dot = 0, n = 0
        const o = x.i * x.d.dim
        for (let j = 0; j < qv.length; j++) { const v = x.d.vecs[o + j]; dot += v * qv[j]; n += v * v }
        return dot / (qn * (Math.sqrt(n) || 1))
      })
    } catch { sem = null }
  }
  const rank = (a: number[]) => { const idx = a.map((v, i) => [v, i] as const).sort((x, y) => y[0] - x[0]); const r = new Array(a.length).fill(a.length); idx.forEach(([, i], pos) => (r[i] = pos)); return r }
  const rb = rank(bm)
  const rs = sem ? rank(sem) : null
  const scored = docs.map((x, n) => ({ x, score: (bm[n] > 0 ? 1 / (60 + rb[n]) : 0) + (rs && sem![n] > 0.15 ? 1 / (60 + rs[n]) : 0), raw: bm[n] }))
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((s) => ({ file: s.x.f, text: s.x.t, page: s.x.d.pages?.[s.x.i], index: s.x.i, score: s.score }))
}

export async function readKb(file: KbFile, from = 1, count = 4): Promise<{ text: string; total: number } | null> {
  const d = (await idbGet(key(file.id))) as Stored | undefined
  if (!d) return null
  const start = Math.max(0, from - 1)
  return { text: d.chunks.slice(start, start + count).map((t, i) => `[part ${start + i + 1}${d.pages ? `, page ${d.pages[start + i]}` : ''}]\n${t}`).join('\n\n'), total: d.chunks.length }
}
