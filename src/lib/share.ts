import type { Artifact, Chat, Message, Source } from '../types'
import { useStore, DEFAULT_SYNC } from '../store'
import { recompressImage } from './images'
import { uid } from './utils'

/* ---------------------------- shared format ---------------------------- */
export interface ShareOptions {
  artifacts: boolean // html, charts, diagrams, svg, markdown, code
  generatedImages: boolean
  attachedImages: boolean
  attachedFiles: boolean
  sources: boolean
  reasoning: boolean
  modelNames: boolean
  instructions: boolean
  /** share only up to (and including the reply to) this user message; undefined = everything */
  upToMessageId?: string
  expiresInDays: number // 0 = never
}

export const DEFAULT_SHARE_OPTIONS: ShareOptions = {
  artifacts: true, generatedImages: true, attachedImages: true, attachedFiles: true, sources: true,
  reasoning: false, modelNames: true, instructions: false, expiresInDays: 0,
}

export type SBlock = { type: 'text'; text: string } | { type: 'reasoning'; text: string } | { type: 'artifact'; id: string }
export interface SMessage {
  role: 'user' | 'assistant'
  createdAt: number
  text?: string
  quotes?: string[]
  attachments?: { name: string; kind: 'image' | 'text'; dataUrl?: string; text?: string }[]
  blocks?: SBlock[]
  artifacts?: Pick<Artifact, 'id' | 'title' | 'kind' | 'language' | 'content'>[]
  sources?: Source[]
  model?: string
}
export interface SharedChat { v: 1; title: string; createdAt: number; model?: string; instructions?: string; messages: SMessage[] }

/** Counts of what a chat contains, for the share dialog. */
export function inventory(chat: Chat, upTo?: string) {
  const msgs = cut(chat.messages, upTo)
  let artifacts = 0, generatedImages = 0, attachedImages = 0, attachedFiles = 0, sources = 0, reasoning = 0
  for (const m of msgs) {
    for (const a of m.artifacts ?? []) a.kind === 'image' ? generatedImages++ : artifacts++
    for (const a of m.attachments ?? []) a.kind === 'text' ? attachedFiles++ : attachedImages++
    sources += m.sources?.length ?? 0
    reasoning += (m.blocks ?? []).filter((b) => b.type === 'reasoning' && b.text.trim()).length
  }
  return { artifacts, generatedImages, attachedImages, attachedFiles, sources, reasoning, messages: msgs.length }
}

function cut(messages: Message[], upTo?: string) {
  if (!upTo) return messages
  const i = messages.findIndex((m) => m.id === upTo)
  if (i < 0) return messages
  // include the assistant reply that follows the chosen user message
  const next = messages[i + 1]
  return messages.slice(0, next && next.role === 'assistant' && messages[i].role === 'user' ? i + 2 : i + 1)
}

export async function buildShare(chat: Chat, o: ShareOptions, modelOfChat?: string): Promise<SharedChat> {
  const out: SMessage[] = []
  for (const m of cut(chat.messages, o.upToMessageId)) {
    if (m.status === 'streaming') continue
    if (m.role === 'user') {
      const attachments = (m.attachments ?? [])
        .filter((a) => (a.kind === 'text' ? o.attachedFiles : o.attachedImages))
        .map((a) => (a.kind === 'text' ? { name: a.name, kind: 'text' as const, text: a.text } : { name: a.name, kind: 'image' as const, dataUrl: a.dataUrl }))
      out.push({ role: 'user', createdAt: m.createdAt, text: m.text, ...(m.quotes?.length ? { quotes: m.quotes } : {}), ...(attachments.length ? { attachments } : {}) })
      continue
    }
    const artifacts: SMessage['artifacts'] = []
    for (const a of m.artifacts ?? []) {
      if (a.kind === 'video') continue // clips are stored on this device only
      if (a.kind === 'image' ? !o.generatedImages : !o.artifacts) continue
      const content = a.kind === 'image' ? await recompressImage(a.content, { maxSide: 1600, quality: 0.85 }) : a.content
      artifacts.push({ id: a.id, title: a.title, kind: a.kind, language: a.language, content })
    }
    const have = new Set(artifacts.map((a) => a.id))
    const blocks: SBlock[] = []
    for (const b of m.blocks ?? []) {
      if (b.type === 'text' && b.text.trim()) blocks.push({ type: 'text', text: b.text })
      else if (b.type === 'reasoning' && o.reasoning && b.text.trim()) blocks.push({ type: 'reasoning', text: b.text })
      else if (b.type === 'tool' && b.artifactId && have.has(b.artifactId)) blocks.push({ type: 'artifact', id: b.artifactId })
    }
    for (const a of artifacts) if (!blocks.some((b) => b.type === 'artifact' && b.id === a.id)) blocks.push({ type: 'artifact', id: a.id })
    out.push({
      role: 'assistant', createdAt: m.createdAt, blocks, ...(artifacts.length ? { artifacts } : {}),
      ...(o.sources && m.sources?.length ? { sources: m.sources } : {}), ...(o.modelNames && m.model ? { model: m.model } : {}),
    })
  }
  return {
    v: 1, title: chat.title, createdAt: chat.createdAt, ...(o.modelNames && modelOfChat ? { model: modelOfChat } : {}),
    ...(o.instructions && chat.system?.trim() ? { instructions: chat.system } : {}), messages: out,
  }
}

/* -------------------------------- api ---------------------------------- */
const syncCfg = () => useStore.getState().sync

async function call<T>(path: string, method = 'GET', body?: unknown, auth = true): Promise<T> {
  const { url, token } = syncCfg()
  const res = await fetch(url + path, {
    method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${token}` } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const j: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(j.error ?? `Server error (${res.status})`)
  return j as T
}

export async function createShare(chat: Chat, o: ShareOptions, model?: string) {
  const data = JSON.stringify(await buildShare(chat, o, model))
  const r = await call<{ id: string; created: number; expires: number | null; size: number }>('/v1/shares', 'POST', { title: chat.title, data, expiresInDays: o.expiresInDays })
  const entry = { id: r.id, created: r.created, expires: r.expires ?? undefined, size: r.size }
  useStore.getState().addShare(chat.id, entry)
  return entry
}

export async function revokeShare(chatId: string, id: string) {
  try { await call(`/v1/shares/${id}`, 'DELETE') } catch (e: any) { if (!/not found/i.test(e.message)) throw e }
  useStore.getState().removeShare(chatId, id)
}

/** Link to the public viewer. Includes the worker URL only if the app does not already know it. */
export function shareLink(id: string) {
  const { url } = syncCfg()
  const w = url && url !== DEFAULT_SYNC.url ? `?w=${encodeURIComponent(url)}` : ''
  return `${location.origin}/s/${id}${w}`
}

export async function fetchShared(id: string, worker?: string): Promise<{ title: string; created: number; expires: number | null; chat: SharedChat }> {
  const base = (worker || DEFAULT_SYNC.url || syncCfg().url).replace(/\/+$/, '')
  if (!base) throw new Error('This link does not say which server holds the chat.')
  const res = await fetch(`${base}/v1/public/shares/${id}`)
  const j: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(j.error ?? `Could not load this shared chat (${res.status}).`)
  return { title: j.title, created: j.created, expires: j.expires, chat: JSON.parse(j.data) }
}

/** Turn a shared chat into a normal local chat. */
export function sharedToChat(s: SharedChat): Chat {
  const now = Date.now()
  const messages: Message[] = s.messages.map((m, i) => {
    const base = { id: uid(), createdAt: now + i, status: 'done' as const }
    if (m.role === 'user')
      return { ...base, role: 'user' as const, text: m.text, ...(m.quotes ? { quotes: m.quotes } : {}), attachments: m.attachments?.map((a) => ({ id: uid(), name: a.name, mime: a.kind === 'text' ? 'text/plain' : 'image/png', dataUrl: a.dataUrl ?? '', ...(a.kind === 'text' ? { kind: 'text' as const, text: a.text } : {}) })) }
    const arts = (m.artifacts ?? []).map((a) => ({ ...a, version: 1 }))
    return {
      ...base, role: 'assistant' as const, model: m.model, sources: m.sources,
      artifacts: arts,
      blocks: (m.blocks ?? []).map((b) => (b.type === 'artifact'
        ? { type: 'tool' as const, id: uid(), callId: uid(), name: arts.find((a) => a.id === b.id)?.kind === 'image' ? 'generate_image' : 'create_artifact', args: '{}', status: 'done' as const, artifactId: b.id, startedAt: now }
        : b.type === 'reasoning' ? { type: 'reasoning' as const, id: uid(), text: b.text, startedAt: now, endedAt: now } : { type: 'text' as const, id: uid(), text: b.text })),
    }
  })
  return { id: uid(), title: s.title, createdAt: now, updatedAt: now, messages, titled: true, system: s.instructions }
}

/** Cheap size estimate (bytes) of what buildShare would produce. */
export function estimateShareSize(chat: Chat, o: ShareOptions): number {
  let n = 400
  for (const m of cut(chat.messages, o.upToMessageId)) {
    if (m.role === 'user') {
      n += (m.text?.length ?? 0) + (m.quotes ?? []).join('').length + 30
      for (const a of m.attachments ?? []) n += a.kind === 'text' ? (o.attachedFiles ? a.text?.length ?? 0 : 0) : o.attachedImages ? a.dataUrl.length : 0
    } else {
      for (const b of m.blocks ?? []) {
        if (b.type === 'text') n += b.text.length
        else if (b.type === 'reasoning' && o.reasoning) n += b.text.length
      }
      for (const a of m.artifacts ?? []) n += a.kind === 'image' ? (o.generatedImages ? a.content.length : 0) : o.artifacts ? a.content.length : 0
      if (o.sources) n += (m.sources ?? []).reduce((x, s) => x + s.title.length + s.url.length + s.snippet.length + 40, 0)
    }
  }
  return n
}
