import type { Chat, McpServer, Message, Provider, Settings } from '../types'
import { DEFAULT_SETTINGS, mergeIntegrations, useStore, type BaseEntry, type SyncState } from '../store'
import { toast } from './toast'
import { fmtBytes } from './utils'
import { shrinkChatImages } from './images'

export const DEFAULT_SYNC_URL = 'https://kokochat-sync.kokodev.workers.dev'

function envSyncUrl(): string {
  return (import.meta.env.VITE_SYNC_URL as string | undefined) ?? ''
}

export function effectiveSyncUrl(storeUrl?: string): string {
  const u = (storeUrl || envSyncUrl() || DEFAULT_SYNC_URL) as string
  return u.replace(/\s+|\/+$/g, '')
}

/* ------------------------------------------------------------------ *
 *  Sync engine
 *
 *  Every synced thing is an item with a key:
 *    settings · selected · provider:<id> · mcp:<id> · chat:<id>
 *  The server keeps a revision number per item (optimistic concurrency).
 *  Each device remembers, per key, the last revision + content it saw
 *  (the "base"). That makes proper three-way merges possible:
 *
 *    - only I changed it        -> push
 *    - only the server changed  -> adopt it
 *    - both changed             -> merge (chats: union of messages,
 *                                  settings & co: field-by-field)
 *    - deleted on one side      -> delete wins unless the other side edited it
 * ------------------------------------------------------------------ */

export class SyncError extends Error {
  constructor(message: string, public code?: 'auth' | 'passphrase' | 'network') { super(message) }
}

/* ------------------------------ helpers ------------------------------ */
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const hashCache = new WeakMap<object, string>()

async function sha(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
async function hashOf(v: any): Promise<string> {
  if (v && typeof v === 'object') {
    const c = hashCache.get(v)
    if (c) return c
    const h = await sha(JSON.stringify(v))
    hashCache.set(v, h)
    return h
  }
  return sha(JSON.stringify(v))
}

export const normalizeUrl = (u: string) => {
  let x = u.trim().replace(/\/+$/, '')
  if (x && !/^https?:\/\//i.test(x)) x = (/^(localhost|127\.|\[::1\])/.test(x) ? 'http://' : 'https://') + x
  return x
}

/* ----------------------------- encryption ---------------------------- */
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
let keyCache: { id: string; key: CryptoKey } | null = null

async function getKey(pass: string, salt: string): Promise<CryptoKey> {
  const id = pass + '|' + salt
  if (keyCache?.id === id) return keyCache.key
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 200_000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  keyCache = { id, key }
  return key
}

async function encode(sync: SyncState, value: unknown): Promise<string> {
  const plain = JSON.stringify(value)
  if (!sync.passphrase) return plain
  const key = await getKey(sync.passphrase, sync.salt)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)))
  return JSON.stringify({ e: 1, iv: b64(iv), ct: b64(ct) })
}

async function decode(sync: SyncState, raw: string): Promise<any> {
  const j = JSON.parse(raw)
  if (j && j.e === 1 && typeof j.ct === 'string') {
    if (!sync.passphrase) throw new SyncError('This account uses end-to-end encryption. Enter your passphrase in Settings → Sync.', 'passphrase')
    try {
      const key = await getKey(sync.passphrase, sync.salt)
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(j.iv) }, key, unb64(j.ct))
      return JSON.parse(new TextDecoder().decode(pt))
    } catch { throw new SyncError('Could not decrypt your data. Is the passphrase correct?', 'passphrase') }
  }
  return j
}

/* ------------------------------- http -------------------------------- */
async function api<T>(sync: Pick<SyncState, 'url' | 'token'>, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(sync.url + path, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json', ...(sync.token ? { Authorization: `Bearer ${sync.token}` } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
  } catch { throw new SyncError('Could not reach the sync server. Check the URL and your connection.', 'network') }
  const j: any = await res.json().catch(() => ({}))
  if (res.status === 401 && sync.token) throw new SyncError(j.error ?? 'Session expired. Sign in again.', 'auth')
  if (!res.ok) throw new SyncError(j.error ?? `Server error (${res.status})`)
  return j as T
}

/* ------------------------------ sign in ------------------------------ */
export const requestCode = (url: string, email: string) => api<{ ok: true }>({ url: normalizeUrl(url), token: '' }, '/v1/auth/request', { body: { email } })

export async function verifyCode(url: string, email: string, code: string) {
  const u = normalizeUrl(url)
  const r = await api<{ token: string; email: string; salt: string; admin?: boolean }>({ url: u, token: '' }, '/v1/auth/verify', { body: { email, code } })
  useStore.getState().setSync({ url: u, email: r.email, token: r.token, salt: r.salt, admin: !!r.admin, auto: true, base: {}, lastSyncAt: undefined })
  void syncNow()
}

export async function signOut() {
  const s = useStore.getState().sync
  if (s.token) await api(s, '/v1/auth/logout', { body: {} }).catch(() => {})
  useStore.getState().setSync({ token: '', base: {}, lastSyncAt: undefined })
  useStore.getState().setSyncStatus({ phase: 'idle' })
}

export async function deleteCloudData() {
  const s = useStore.getState().sync
  await api(s, '/v1/account', { method: 'DELETE' })
  useStore.getState().setSync({ token: '', base: {}, lastSyncAt: undefined })
}

/* ------------------------------- items ------------------------------- */
const isPristine = (c: Chat) => !c.messages.length && c.title === 'New chat' && !c.deleted?.length && !c.system
const isStreamingChat = (c: Chat) => c.messages.some((m) => m.status === 'streaming')

function localItems(): { items: Map<string, any>; skip: Set<string> } {
  const s = useStore.getState()
  const items = new Map<string, any>()
  const skip = new Set<string>()
  items.set('settings', s.settings)
  if (s.selected) items.set('selected', s.selected)
  for (const p of s.providers) items.set('provider:' + p.id, p)
  for (const m of s.mcpServers) items.set('mcp:' + m.id, m)
  // co-worker jobs sync to every device (only the desktop app shows and runs them); skip one while it is mid-run
  for (const m of s.memories) items.set('memory:' + m.id, m)
  for (const j of s.coworkers) { const k = 'cowork:' + j.id; if (j.runs.some((r) => r.status === 'running')) skip.add(k); else items.set(k, j) }
  for (const c of s.chats) {
    if (c.mode === 'code') continue // folders and permissions only make sense on this computer
    const key = 'chat:' + c.id
    if (isStreamingChat(c)) skip.add(key)
    else if (!isPristine(c) || s.sync.base[key]) items.set(key, c)
  }
  return { items, skip }
}

/* -------------------------------- merge ------------------------------ */
function mergeObj(base: any, local: any, remote: any): any {
  if (!base || typeof base !== 'object' || typeof local !== 'object' || typeof remote !== 'object') return sameJson(local, base) ? remote : local
  const out: any = {}
  for (const k of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const l = local[k], r = remote[k], b = base[k]
    if (sameJson(l, r)) out[k] = l
    else if (sameJson(l, b)) out[k] = r // only remote changed
    else if (sameJson(r, b)) out[k] = l // only local changed
    else if (l && r && typeof l === 'object' && typeof r === 'object' && !Array.isArray(l) && !Array.isArray(r)) out[k] = mergeObj(b, l, r)
    else out[k] = l // both changed the same field: this device wins
    if (out[k] === undefined) delete out[k]
  }
  return out
}

export function mergeChats(l: Chat, r: Chat): Chat {
  const deleted = [...new Set([...(l.deleted ?? []), ...(r.deleted ?? [])])].slice(-500)
  const gone = new Set(deleted)
  const lNewer = (l.updatedAt ?? 0) >= (r.updatedAt ?? 0)
  const byId = new Map<string, Message>()
  for (const m of [...r.messages, ...l.messages]) {
    if (gone.has(m.id)) continue
    const prev = byId.get(m.id)
    if (!prev) { byId.set(m.id, m); continue }
    if (sameJson(prev, m)) continue
    // same message edited/finished on both sides: prefer a finished one, else the newer chat's copy
    const a = prev, b = m
    const aLive = a.status === 'streaming', bLive = b.status === 'streaming'
    if (aLive !== bLive) byId.set(m.id, aLive ? b : a)
    else byId.set(m.id, lNewer ? (l.messages.includes(a) ? a : b) : (r.messages.includes(a) ? a : b))
  }
  const messages = [...byId.values()].sort((a, b) => a.createdAt - b.createdAt)
  const win = lNewer ? l : r, lose = lNewer ? r : l
  return {
    ...lose,
    ...win,
    title: win.title === 'New chat' && lose.title !== 'New chat' ? lose.title : win.title,
    messages,
    deleted: deleted.filter((id) => !byId.has(id)),
    updatedAt: Math.max(l.updatedAt ?? 0, r.updatedAt ?? 0),
    titled: !!(l.titled || r.titled),
    forkedFrom: l.forkedFrom ?? r.forkedFrom,
  }
}

const fixStreaming = (c: Chat): Chat =>
  c.messages.some((m) => m.status === 'streaming') ? { ...c, messages: c.messages.map((m) => (m.status === 'streaming' ? { ...m, status: 'stopped' as const } : m)) } : c

/* ------------------------------- the sync ---------------------------- */
interface RemoteEntry { rev: number; deleted: boolean; updatedAt: number }

let running = false
let again = false

export async function syncNow(opts: { quiet?: boolean } = {}): Promise<void> {
  const st0 = useStore.getState()
  if (!st0.sync.token || !st0.sync.url) return
  if (running) { again = true; return }
  running = true
  st0.setSyncStatus({ phase: 'syncing' })
  try {
    const stats: Stats = { pulled: 0, pushed: 0, merged: 0, tooBig: [] }
    for (let attempt = 0; attempt < 4; attempt++) {
      const retry = await syncPass(stats)
      if (!retry) break
      if (attempt === 3) throw new SyncError('Sync kept conflicting; will retry shortly.')
    }
    const t = Date.now()
    useStore.getState().setSync({ lastSyncAt: t })
    if (stats.tooBig.length) {
      const st = useStore.getState()
      const label = (k: string) => (k.startsWith('chat:') ? st.chats.find((c) => 'chat:' + c.id === k)?.title : k) ?? k
      const items = stats.tooBig.map((x) => `"${label(x.key)}"${x.size ? ` (${fmtBytes(x.size)})` : ''}`)
      const u = st.sync.usage
      const free = u ? Math.max(0, u.quota - u.used) : 0
      useStore.getState().setSyncStatus({
        phase: 'error', code: 'quota', at: t,
        message: `Not uploaded, too big for your free cloud space${u ? ` (${fmtBytes(free)} free of ${fmtBytes(u.quota).replace('.00', '')})` : ''}: ${items.slice(0, 3).join(', ')}${items.length > 3 ? ` and ${items.length - 3} more` : ''}. Delete large chats or images to make room.`,
      })
    } else useStore.getState().setSyncStatus({ phase: 'idle', at: t })
    if (stats.merged && !opts.quiet) toast.info(`Merged changes from another device (${stats.merged} item${stats.merged === 1 ? '' : 's'})`)
  } catch (e: any) {
    const err = e instanceof SyncError ? e : new SyncError(String(e?.message ?? e))
    if (err.code === 'auth') useStore.getState().setSync({ token: '' })
    useStore.getState().setSyncStatus({ phase: 'error', message: err.message, code: err.code })
  } finally {
    running = false
    if (again) { again = false; setTimeout(() => void syncNow({ quiet: true }), 500) }
  }
}

interface Stats { pulled: number; pushed: number; merged: number; tooBig: { key: string; size?: number }[] }

async function syncPass(stats: Stats): Promise<boolean> {
  const sync = useStore.getState().sync
  const { items: local, skip } = localItems()
  const index = await api<{ items: Record<string, RemoteEntry & { size?: number }>; usage?: { used: number; quota: number }; admin?: boolean }>(sync, '/v1/sync/index')
  const idx = index.items
  let usage = index.usage
  if (usage) useStore.getState().setSync({ usage })
  if (index.admin !== undefined && index.admin !== sync.admin) useStore.getState().setSync({ admin: index.admin })
  const base: Record<string, BaseEntry> = { ...sync.base }

  type Task = { key: string; L?: any; Lh?: string; B?: BaseEntry; R?: RemoteEntry; localChanged: boolean; localDeleted: boolean; remoteChanged: boolean }
  const tasks: Task[] = []
  for (const key of new Set([...local.keys(), ...Object.keys(idx), ...Object.keys(base)])) {
    if (skip.has(key)) continue
    const L = local.get(key)
    const Lh = L !== undefined ? await hashOf(L) : undefined
    const B = base[key], R = idx[key]
    const localChanged = L !== undefined && (!B || B.hash !== Lh)
    const localDeleted = L === undefined && !!B && B.hash !== null
    const remoteChanged = !!R && (!B || R.rev !== B.rev)
    if (!localChanged && !localDeleted && !remoteChanged) continue
    tasks.push({ key, L, Lh, B, R, localChanged, localDeleted, remoteChanged })
  }
  if (!tasks.length) return false

  // pull what we need
  const needPull = tasks.filter((t) => t.remoteChanged && !t.R!.deleted).map((t) => t.key)
  const remote: Record<string, any> = {}
  for (let i = 0; i < needPull.length; i += 8) {
    const r = await api<{ items: Record<string, { data: string | null }> }>(sync, '/v1/sync/get', { body: { keys: needPull.slice(i, i + 8) } })
    for (const [k, v] of Object.entries(r.items)) if (v.data != null) remote[k] = await decode(sync, v.data)
  }

  const apply: Record<string, any | null> = {} // key -> value (null = delete locally)
  const pushes: { key: string; baseRev: number; value: any | null; final: any }[] = []
  const isChat = (k: string) => k.startsWith('chat:')

  for (const t of tasks) {
    const { key, L, B, R } = t
    if (!t.remoteChanged) {
      if (t.localChanged) pushes.push({ key, baseRev: B?.rev ?? R?.rev ?? 0, value: L, final: L })
      else if (t.localDeleted) pushes.push({ key, baseRev: B!.rev, value: null, final: null })
      continue
    }
    stats.pulled++
    if (R!.deleted) {
      if (t.localChanged) pushes.push({ key, baseRev: R!.rev, value: L, final: L }) // edited here, deleted there: keep the edit
      else { apply[key] = null; base[key] = { rev: R!.rev, hash: null } }
      continue
    }
    let D = remote[key]
    if (D === undefined) continue
    if (isChat(key)) D = fixStreaming(D)
    const Dh = await hashOf(D)
    let final = D
    if (L !== undefined && (t.localChanged || !B)) {
      final = isChat(key) ? mergeChats(L, D) : B ? mergeObj(B.data, L, D) : D // new device adopting an account: remote wins for settings
      stats.merged++
    }
    const finalH = await hashOf(final)
    base[key] = { rev: R!.rev, hash: Dh, ...(isChat(key) ? {} : { data: D }) }
    if (finalH !== (L !== undefined ? t.Lh : undefined)) apply[key] = final
    if (finalH !== Dh) pushes.push({ key, baseRev: R!.rev, value: final, final })
  }

  // apply remote results locally in one update
  applyLocal(apply)
  await persistBase(base)

  // push (never upload something the server would reject for exceeding the storage quota)
  let conflicted = false
  const ready: { p: (typeof pushes)[number]; data: string | null; size: number }[] = []
  for (const p of pushes) {
    let data = p.value === null ? null : await encode(sync, p.value)
    let size = data === null ? 0 : new TextEncoder().encode(data).length
    const old = idx[p.key] && !idx[p.key].deleted ? idx[p.key].size ?? 0 : 0
    if (usage && data !== null && usage.used - old + size > usage.quota && p.key.startsWith('chat:')) {
      // too big: shrink large images in this chat (also locally) and try again
      const smaller = await shrinkChatImages(p.value)
      if (smaller !== p.value) {
        applyLocal({ [p.key]: smaller })
        p.value = smaller; p.final = smaller
        data = await encode(sync, smaller)
        size = new TextEncoder().encode(data).length
      }
    }
    if (usage && data !== null) {
      if (usage.used - old + size > usage.quota) { stats.tooBig.push({ key: p.key, size }); continue }
      usage = { ...usage, used: usage.used - old + size }
    } else if (usage) {
      usage = { ...usage, used: Math.max(0, usage.used - old) }
    }
    ready.push({ p, data, size })
  }
  for (let i = 0; i < ready.length; i += 6) {
    const batch = ready.slice(i, i + 6)
    const changes = batch.map(({ p, data }) => ({ key: p.key, baseRev: p.baseRev, deleted: p.value === null, data }))
    const r = await api<{ results: { key: string; status: string; rev?: number; error?: string }[]; usage?: { used: number; quota: number } }>(sync, '/v1/sync/put', { body: { changes } })
    if (r.usage) useStore.getState().setSync({ usage: r.usage })
    for (const res of r.results) {
      const p = batch.find((x) => x.p.key === res.key)!.p
      if (res.status === 'ok') {
        stats.pushed++
        base[res.key] = { rev: res.rev!, hash: p.final === null ? null : await hashOf(p.final), ...(isChat(res.key) || p.final === null ? {} : { data: p.final }) }
      } else if (res.status === 'conflict') conflicted = true
      else if (res.status === 'quota') stats.tooBig.push({ key: res.key })
    }
  }
  await persistBase(base)
  return conflicted
}

async function persistBase(base: Record<string, BaseEntry>) {
  useStore.getState().setSync({ base })
}

/* ------------------------- apply to local store ----------------------- */
function applyLocal(apply: Record<string, any | null>) {
  const keys = Object.keys(apply)
  if (!keys.length) return
  useStore.setState((s) => {
    let settings: Settings = s.settings
    let selected = s.selected
    let providers: Provider[] = s.providers
    let mcpServers: McpServer[] = s.mcpServers
    let chats: Chat[] = s.chats
    let coworkers = s.coworkers
    let memories = s.memories
    for (const key of keys) {
      const v = apply[key]
      if (key === 'settings') {
        if (v) settings = { ...DEFAULT_SETTINGS, ...v, memory: { ...DEFAULT_SETTINGS.memory, ...v.memory }, notifications: { ...DEFAULT_SETTINGS.notifications, ...v.notifications }, appearance: { ...DEFAULT_SETTINGS.appearance, ...v.appearance }, rag: { ...DEFAULT_SETTINGS.rag, ...v.rag }, prompts: Array.isArray(v.prompts) ? v.prompts : DEFAULT_SETTINGS.prompts, integrations: mergeIntegrations(v.integrations), compare: { ...DEFAULT_SETTINGS.compare, ...v.compare }, sandbox: { ...DEFAULT_SETTINGS.sandbox, ...v.sandbox }, image: { ...DEFAULT_SETTINGS.image, ...v.image }, video: { ...DEFAULT_SETTINGS.video, ...v.video }, stt: { ...DEFAULT_SETTINGS.stt, ...v.stt }, tts: { ...DEFAULT_SETTINGS.tts, ...v.tts } }
      } else if (key === 'selected') {
        if (v) selected = v
      } else if (key.startsWith('provider:')) {
        const id = key.slice(9)
        providers = v ? (providers.some((p) => p.id === id) ? providers.map((p) => (p.id === id ? v : p)) : [...providers, v]) : providers.filter((p) => p.id !== id)
      } else if (key.startsWith('mcp:')) {
        const id = key.slice(4)
        mcpServers = v ? (mcpServers.some((m) => m.id === id) ? mcpServers.map((m) => (m.id === id ? v : m)) : [...mcpServers, v]) : mcpServers.filter((m) => m.id !== id)
      } else if (key.startsWith('memory:')) {
        const id = key.slice(7)
        memories = v ? (memories.some((m) => m.id === id) ? memories.map((m) => (m.id === id ? v : m)) : [v, ...memories]) : memories.filter((m) => m.id !== id)
      } else if (key.startsWith('cowork:')) {
        const id = key.slice(7)
        coworkers = v ? (coworkers.some((j) => j.id === id) ? coworkers.map((j) => (j.id === id ? v : j)) : [...coworkers, v]) : coworkers.filter((j) => j.id !== id)
      } else if (key.startsWith('chat:')) {
        const id = key.slice(5)
        if (v) chats = chats.some((c) => c.id === id) ? chats.map((c) => (c.id === id ? v : c)) : [v, ...chats]
        else chats = chats.filter((c) => c.id !== id)
      }
    }
    // selected model must still point at an existing provider
    if (selected && !providers.some((p) => p.id === selected!.providerId)) selected = s.selected && providers.some((p) => p.id === s.selected!.providerId) ? s.selected : null
    const activeId = chats.some((c) => c.id === s.activeId) ? s.activeId : chats[0]?.id ?? null
    return { settings, selected, providers, mcpServers, chats, activeId, coworkers, memories }
  })
}

/* ----------------------------- encryption ctl ------------------------- */
/** Call after changing the passphrase: forces every local item to be re-uploaded (re-encrypted). */
export function markAllDirty() {
  const s = useStore.getState().sync
  const base: Record<string, BaseEntry> = {}
  for (const [k, v] of Object.entries(s.base)) base[k] = { ...v, hash: v.hash === null ? null : 'dirty' }
  useStore.getState().setSync({ base })
}

/* ------------------------------ auto sync ----------------------------- */
let started = false
export function startAutoSync() {
  if (started) return
  started = true
  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = (ms: number) => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      const s = useStore.getState()
      if (!s.sync.auto || !s.sync.token) return
      if (Object.keys(s.streaming).length) return schedule(4000) // wait until generation finishes
      void syncNow({ quiet: true })
    }, ms)
  }
  let prev = useStore.getState()
  useStore.subscribe((s) => {
    const changed = s.chats !== prev.chats || s.providers !== prev.providers || s.mcpServers !== prev.mcpServers || s.coworkers !== prev.coworkers || s.memories !== prev.memories || s.settings !== prev.settings || s.selected !== prev.selected
    const justSignedIn = !prev.sync.token && !!s.sync.token
    prev = s
    if (changed && s.sync.auto && s.sync.token) schedule(5000)
    if (justSignedIn) schedule(300)
  })
  window.addEventListener('focus', () => schedule(400))
  window.addEventListener('online', () => schedule(400))
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(400) })
  setInterval(() => schedule(100), 45_000)
  schedule(800)
}
