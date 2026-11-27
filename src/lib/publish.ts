import { create } from 'zustand'
import { useStore } from '../store'

export type PublishKind = 'html' | 'chart' | 'diagram' | 'mermaid'
export interface PublishItem {
  ref: string
  title: string
  kind: PublishKind
  content: string
  /** also recognises a page published under an older kind of reference */
  adopts?: (page: Published) => boolean
}
export interface Published { id: string; kind?: PublishKind; ref: string; title: string; created: number; updated: number; views: number; size: number }

const cfg = () => useStore.getState().sync
const base = () => (cfg().url || (import.meta.env.VITE_SYNC_URL as string | undefined) || '').replace(/\/+$/, '')

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const { token } = cfg()
  if (!token || !base()) throw new Error('Sign in under Settings → Sync to publish pages.')
  const res = await fetch(base() + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body !== undefined ? JSON.stringify(body) : undefined })
  const j: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(j.error ?? `Server error (${res.status})`)
  return j as T
}

export const publishedUrl = (id: string) => `${base()}/artifact/${id}`

interface PubState { items: Published[]; loaded: boolean; load: () => Promise<void> }
export const usePublished = create<PubState>((set) => ({
  items: [], loaded: false,
  load: async () => { const r = await call<{ artifacts: Published[] }>('/v1/artifacts'); set({ items: r.artifacts, loaded: true }) },
}))

/** The page already published for this item, if any. */
export const findPublished = (items: Published[], item: PublishItem) => items.find((p) => p.ref === item.ref) ?? items.find((p) => item.adopts?.(p))

/** Publish a page, chart or diagram; publishing the same one again updates the page at the same address. */
export async function publishItem(item: PublishItem) {
  const { title, kind, content } = item
  // the list says whether this is an update, so publishing without it could make a second page
  if (!usePublished.getState().loaded) await usePublished.getState().load()
  const ref = findPublished(usePublished.getState().items, item)?.ref ?? item.ref
  // HTML goes as `html` so it also works with a sync server that predates charts and diagrams
  const r = await call<{ id: string; republished: boolean }>('/v1/artifacts', 'POST', kind === 'html' ? { ref, title, html: content } : { ref, title, kind, content })
  await usePublished.getState().load().catch(() => {})
  return { ...r, url: publishedUrl(r.id) }
}

/** An inline Mermaid block has no id, so its source identifies it. */
export function mermaidItem(code: string): PublishItem {
  let a = 0x811c9dc5, b = 0x01000193
  for (let i = 0; i < code.length; i++) { const c = code.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193); b = Math.imul(b ^ c, 0x85ebca6b) }
  const first = code.replace(/^\s*---[\s\S]*?\n---/, '').split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('%%')) ?? ''
  const type = first.split(/[\s-]/)[0]
  const names: Record<string, string> = { graph: 'Flowchart', flowchart: 'Flowchart', sequenceDiagram: 'Sequence diagram', classDiagram: 'Class diagram', stateDiagram: 'State diagram', erDiagram: 'Entity relationship diagram', gantt: 'Gantt chart', pie: 'Pie chart', mindmap: 'Mind map', timeline: 'Timeline', gitGraph: 'Git graph', journey: 'User journey', xychart: 'Chart' }
  const title = /^\s*title:?\s+(.+)$/m.exec(code)?.[1]?.trim() || names[type] || 'Diagram'
  return { ref: `mmd-${(a >>> 0).toString(36)}-${(b >>> 0).toString(36)}`, title, kind: 'mermaid', content: code }
}

export async function unpublish(id: string) {
  try { await call(`/v1/artifacts/${id}`, 'DELETE') } catch (e: any) { if (!/not found/i.test(e.message)) throw e }
  usePublished.setState((s) => ({ items: s.items.filter((p) => p.id !== id) }))
}
