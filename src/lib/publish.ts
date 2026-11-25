import { create } from 'zustand'
import { useStore } from '../store'

export interface Published { id: string; ref: string; title: string; created: number; updated: number; views: number; size: number }

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

/** Publish an HTML artifact; publishing the same artifact again updates the page at the same address. */
export async function publishArtifact(ref: string, title: string, html: string) {
  const r = await call<{ id: string; republished: boolean }>('/v1/artifacts', 'POST', { ref, title, html })
  await usePublished.getState().load().catch(() => {})
  return { ...r, url: publishedUrl(r.id) }
}

export async function unpublish(id: string) {
  try { await call(`/v1/artifacts/${id}`, 'DELETE') } catch (e: any) { if (!/not found/i.test(e.message)) throw e }
  usePublished.setState((s) => ({ items: s.items.filter((p) => p.id !== id) }))
}
