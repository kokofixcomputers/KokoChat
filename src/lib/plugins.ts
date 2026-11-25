import { useStore } from '../store'
import type { PluginRecord, PluginSetting } from '../types'
import { toast } from './toast'
import { uid } from './utils'
import { usePluginUI, type ModalAction, type ModalBody, type SlotCtx, type SlotName, SLOTS } from './pluginHost'
import type { ToolDef } from './tools'
import { completeText } from './complete'
import { useDock } from './dock'
import { isDesktop } from './desktop'

/* ------------------------------------------------------------------------------------------------
 * Plugins are JavaScript that runs inside the app with the API below. They are trusted code:
 * they can see and change anything the app can (including your API keys), so only install code you trust.
 * ------------------------------------------------------------------------------------------------ */

export interface PluginToolDef {
  name: string
  description: string
  /** JSON Schema for the arguments */
  parameters?: Record<string, unknown>
  run: (args: any, ctx: { signal: AbortSignal; chatId: string }) => unknown
}
export interface PluginManifest {
  id: string
  name: string
  version?: string
  description?: string
  author?: string
  settings?: PluginSetting[]
  tools?: PluginToolDef[]
  /** what it needs access to; "ai" and "chat" are enforced, the others are shown to you before you install */
  permissions?: string[]
  activate?: (api: any) => void | (() => void) | Promise<void | (() => void)>
}

export const PLUGIN_API_VERSION = 1

/* ------------------------------------------------------------------------------------------------ permissions */
export const PERMISSIONS: Record<string, string> = {
  ai: 'Send prompts to your AI models (this uses your API credit)',
  chat: 'Send messages in your chats on your behalf',
  network: 'Make network requests to other websites',
  storage: 'Save data on this device',
  notifications: 'Show system notifications',
}

/** A quick look at the code for things worth knowing before it runs (this does not make it safe: plugins are trusted code). */
export function scanSource(src: string): { id: string; text: string; perm?: string }[] {
  const found: { id: string; text: string; perm?: string }[] = []
  const has = (re: RegExp) => re.test(src)
  if (has(/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource/)) found.push({ id: 'net', text: 'Makes network requests', perm: 'network' })
  if (has(/localStorage|sessionStorage|indexedDB|document\.cookie/)) found.push({ id: 'store', text: 'Reads or writes browser storage directly', perm: 'storage' })
  if (has(/\.ai\.ask|\bai\s*\.\s*ask/)) found.push({ id: 'ai', text: 'Sends prompts to your models', perm: 'ai' })
  if (has(/\.chat\.send/)) found.push({ id: 'chat', text: 'Sends chat messages', perm: 'chat' })
  if (has(/Notification|\.ui\.notify/)) found.push({ id: 'notify', text: 'Shows notifications', perm: 'notifications' })
  if (has(/\beval\s*\(|new\s+Function|import\s*\(/)) found.push({ id: 'eval', text: 'Runs code that it builds or downloads while running' })
  if (has(/window\.koko|\bkoko\.(fs|shell|term|git)/)) found.push({ id: 'desktop', text: 'Uses the desktop app bridge (files, terminal, commands)' })
  if (has(/__store|useStore|indexedDB/)) found.push({ id: 'appdata', text: 'Reads the app\'s data directly, including keys' })
  if (has(/navigator\.clipboard/)) found.push({ id: 'clip', text: 'Reads or writes the clipboard' })
  if (has(/document\.(body|querySelector|getElementById|createElement)\s*[.(]|innerHTML|insertAdjacentHTML/)) found.push({ id: 'dom', text: 'Changes the page directly (beyond the places Koko gives it)' })
  return found
}

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/* ------------------------------------------------------------------------------------------------ parsing */
const ID = /^[a-z][a-z0-9-]{1,39}$/
const TOOL = /^[a-z][a-z0-9_]{0,39}$/

/** Run the plugin's code once to read its manifest (id, name, settings, tools). */
export function parseManifest(source: string): PluginManifest {
  let m: any
  try { m = new Function('koko', '"use strict";\n' + source)({ apiVersion: PLUGIN_API_VERSION }) }
  catch (e: any) { throw new Error(`The plugin code failed to run: ${e?.message ?? e}`) }
  if (!m || typeof m !== 'object') throw new Error('The plugin must end with: return { id, name, activate(api) { … } }')
  if (typeof m.id !== 'string' || !ID.test(m.id)) throw new Error('The plugin needs an id of lowercase letters, numbers and dashes, for example "word-counter".')
  if (typeof m.name !== 'string' || !m.name.trim()) throw new Error('The plugin needs a name.')
  if (m.activate != null && typeof m.activate !== 'function') throw new Error('activate must be a function.')
  if (m.permissions != null && (!Array.isArray(m.permissions) || m.permissions.some((x: unknown) => typeof x !== 'string' || !(x in PERMISSIONS)))) throw new Error(`permissions can only list: ${Object.keys(PERMISSIONS).join(', ')}.`)
  const keys = new Set<string>()
  for (const s of m.settings ?? []) {
    if (!s || typeof s.key !== 'string' || !s.key || typeof s.label !== 'string') throw new Error('Each setting needs a key and a label.')
    if (!['boolean', 'string', 'number', 'select', 'textarea'].includes(s.type)) throw new Error(`Setting "${s.key}" has an unknown type "${s.type}".`)
    if (keys.has(s.key)) throw new Error(`Setting "${s.key}" is listed twice.`)
    keys.add(s.key)
  }
  const names = new Set<string>()
  for (const t of m.tools ?? []) {
    if (!t || typeof t.name !== 'string' || !TOOL.test(t.name)) throw new Error('Each tool needs a name of lowercase letters, numbers and underscores.')
    if (typeof t.description !== 'string' || typeof t.run !== 'function') throw new Error(`Tool "${t.name}" needs a description and a run function.`)
    if (names.has(t.name)) throw new Error(`Tool "${t.name}" is listed twice.`)
    names.add(t.name)
  }
  return m as PluginManifest
}

/** What gets saved when a plugin is installed. */
export function recordFromSource(source: string, prev?: PluginRecord, extra?: { sourceUrl?: string; hash?: string }): PluginRecord {
  const m = parseManifest(source)
  return {
    id: m.id, name: m.name.trim(), version: String(m.version ?? '1.0.0'), description: m.description, author: m.author, source,
    enabled: prev?.enabled ?? true, toolsOff: prev?.toolsOff ?? [], values: prev?.values ?? {},
    settings: (m.settings ?? []).map((s) => ({ key: s.key, label: s.label, type: s.type, default: s.default, description: s.description, options: s.options, min: s.min, max: s.max, placeholder: s.placeholder })),
    tools: (m.tools ?? []).map((t) => ({ name: t.name, description: t.description })),
    installedAt: prev?.installedAt ?? Date.now(),
    permissions: m.permissions ?? [],
    sourceUrl: extra && 'sourceUrl' in extra ? extra.sourceUrl : prev?.sourceUrl,
    hash: extra?.hash ?? prev?.hash,
  }
}

/* ------------------------------------------------------------------------------------------------ running plugins */
interface Live {
  manifest: PluginManifest
  source: string
  cleanups: (() => void)[]
  tools: Map<string, PluginToolDef>
  settingListeners: Set<(key: string, value: unknown) => void>
  events: Map<string, Set<(payload: any) => void>>
  beforeSend: Set<(text: string) => unknown>
}
const live = new Map<string, Live>()

const setError = (id: string, msg: string | null) => usePluginUI.setState((s) => { const e = { ...s.errors }; if (msg) e[id] = msg; else delete e[id]; return { errors: e } })
const message = (e: any) => String(e?.message ?? e)

/** Wrap something a plugin gave us so its mistakes never break the app. */
function guard<A extends any[], R>(id: string, what: string, fn: (...a: A) => R): (...a: A) => R | undefined {
  return (...a: A) => {
    try {
      const r: any = fn(...a)
      if (r && typeof r.then === 'function') r.catch((e: any) => { console.error(`[plugin ${id}] ${what}`, e); setError(id, `${what}: ${message(e)}`) })
      return r
    } catch (e) { console.error(`[plugin ${id}] ${what}`, e); setError(id, `${what}: ${message(e)}`); return undefined }
  }
}

const recOf = (id: string) => useStore.getState().plugins.find((p) => p.id === id)
const settingDef = (id: string, key: string) => recOf(id)?.settings.find((s) => s.key === key)
const valueOf = (id: string, key: string) => { const r = recOf(id); return r && key in r.values ? r.values[key] : settingDef(id, key)?.default }

function h(tag: string, props?: Record<string, any> | null, ...children: any[]) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue
    if (k === 'class' || k === 'className') el.className = String(v)
    else if (k === 'style') { if (typeof v === 'string') el.setAttribute('style', v); else Object.assign(el.style, v) }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v)
    else if (k === 'text') el.textContent = String(v)
    else el.setAttribute(k, v === true ? '' : String(v))
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)))
  return el
}

function buildApi(id: string, L: Live) {
  const own = <A extends any[], R>(what: string, fn: (...a: A) => R) => guard(id, what, fn)
  const cleanup = (fn: () => void) => { L.cleanups.push(fn) }
  const m = L.manifest

  /* ---- settings & storage */
  const settings = {
    get: (key: string) => valueOf(id, key),
    all: () => Object.fromEntries((recOf(id)?.settings ?? []).map((s) => [s.key, valueOf(id, s.key)])),
    set: (key: string, value: unknown) => useStore.getState().patchPlugin(id, (r) => ({ ...r, values: { ...r.values, [key]: value } })),
    onChange: (cb: (key: string, value: unknown) => void) => { const f = own('settings.onChange', cb) as any; L.settingListeners.add(f); return () => L.settingListeners.delete(f) },
  }
  const sk = (k: string) => `koko:plugin:${id}:${k}`
  const storage = {
    get: (k: string, fallback?: unknown) => { try { const v = localStorage.getItem(sk(k)); return v == null ? fallback : JSON.parse(v) } catch { return fallback } },
    set: (k: string, v: unknown) => { try { localStorage.setItem(sk(k), JSON.stringify(v)) } catch { /* full or blocked */ } },
    remove: (k: string) => { try { localStorage.removeItem(sk(k)) } catch { /* ignore */ } },
  }

  /* ---- css */
  const root = document.documentElement
  const css = {
    getVariable: (name: string) => getComputedStyle(root).getPropertyValue(name).trim(),
    setVariable: (name: string, value: string) => {
      const n = name.startsWith('--') ? name : '--' + name
      const before = root.style.getPropertyValue(n)
      root.style.setProperty(n, value)
      cleanup(() => { if (before) root.style.setProperty(n, before); else root.style.removeProperty(n) })
    },
    setVariables: (vars: Record<string, string>) => { for (const [k, v] of Object.entries(vars)) css.setVariable(k, v) },
    inject: (text: string) => {
      const el = h('style', { 'data-plugin': id, text })
      document.head.append(el)
      const remove = () => el.remove()
      cleanup(remove)
      return remove
    },
  }

  /* ---- ui */
  const mount = (slot: SlotName, fn: (el: HTMLElement, ctx: SlotCtx) => void | (() => void)) => {
    if (!SLOTS.includes(slot)) throw new Error(`Unknown slot "${slot}". Slots: ${SLOTS.join(', ')}`)
    const mid = uid()
    usePluginUI.setState((s) => ({ mounts: [...s.mounts, { id: mid, pluginId: id, slot, fn: guard(id, `ui.mount(${slot})`, fn) as any }] }))
    const remove = () => usePluginUI.setState((s) => ({ mounts: s.mounts.filter((x) => x.id !== mid) }))
    cleanup(remove)
    return remove
  }
  const toastFn: any = (text: string, kind: 'info' | 'success' | 'error' = 'info') => (toast as any)[kind](String(text))
  toastFn.info = (t: string) => toast.info(String(t)); toastFn.success = (t: string) => toast.success(String(t)); toastFn.error = (t: string) => toast.error(String(t))

  const modal = (o: { title?: string; body?: ModalBody; actions?: ModalAction[]; dismissValue?: unknown }) => new Promise<any>((resolve) => {
    const mid = uid()
    const close = (v: unknown) => { usePluginUI.setState((s) => ({ modals: s.modals.filter((x) => x.id !== mid) })); resolve(v) }
    cleanup(() => close(o.dismissValue ?? null))
    usePluginUI.setState((s) => ({ modals: [...s.modals, { id: mid, pluginId: id, title: o.title, body: o.body ?? '', actions: o.actions ?? [{ label: 'OK', value: true, primary: true }], dismissValue: o.dismissValue ?? null, resolve: close }] }))
  })
  const ui = {
    toast: toastFn,
    modal,
    confirm: (text: string, o: { title?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean } = {}) => modal({ title: o.title, body: text, dismissValue: false, actions: [{ label: o.cancelLabel ?? 'Cancel', value: false }, { label: o.confirmLabel ?? 'OK', value: true, primary: true, danger: o.danger }] }) as Promise<boolean>,
    prompt: (text: string, o: { title?: string; default?: string; placeholder?: string } = {}) => {
      let value = o.default ?? ''
      return modal({
        title: o.title, dismissValue: null,
        body: (el) => { el.append(h('p', { class: 'kp-muted', style: 'margin-bottom:10px' }, text)); const input = h('input', { class: 'kp-input', value, placeholder: o.placeholder ?? '' }) as HTMLInputElement; input.value = value; input.addEventListener('input', () => (value = input.value)); el.append(input); setTimeout(() => input.focus(), 30) },
        actions: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true, value: '__submit__' }],
      }).then((v) => (v === '__submit__' ? value : null)) as Promise<string | null>
    },
    notify: async (title: string, body?: string) => {
      try {
        if (typeof Notification !== 'undefined') {
          if (Notification.permission === 'default') await Notification.requestPermission()
          if (Notification.permission === 'granted') { new Notification(String(title), { body: body ? String(body) : undefined, silent: true }); return true }
        }
      } catch { /* fall through */ }
      toast.info(body ? `${title}: ${body}` : String(title))
      return false
    },
    mount,
    /** Add a full tab to the side panel (desktop app). It is created the first time the user opens it from the + menu, or with openPanel. */
    registerPanel: (def: { id: string; title: string; icon?: string; render: (el: HTMLElement, ctx: { close: () => void }) => void | (() => void) }) => {
      if (!def || !/^[\w-]{1,40}$/.test(def.id) || typeof def.render !== 'function') throw new Error('A panel needs an id, a title and a render(el) function.')
      usePluginUI.setState((s) => ({ panels: [...s.panels.filter((x) => !(x.pluginId === id && x.id === def.id)), { pluginId: id, id: def.id, title: String(def.title || def.id), icon: def.icon, render: guard(id, `panel ${def.id}`, def.render) as any }] }))
      const remove = () => usePluginUI.setState((s) => ({ panels: s.panels.filter((x) => !(x.pluginId === id && x.id === def.id)) }))
      cleanup(remove)
      return remove
    },
    openPanel: (panelId: string) => {
      if (!isDesktop()) { toast.info('Plugin panels are available in the Koko desktop app.'); return false }
      const def = usePluginUI.getState().panels.find((x) => x.pluginId === id && x.id === panelId)
      if (!def) throw new Error(`No panel "${panelId}" is registered.`)
      useDock.getState().add('plugin', { pluginId: id, panelId, title: def.title })
      return true
    },
    h,
    addButton: (o: { slot?: SlotName; title?: string; label?: string; icon?: string; onClick: (data: any) => void }) => mount(o.slot ?? 'composer.toolbar', (el, ctx) => {
      const b = h('button', { class: 'kp-btn', type: 'button', title: o.title ?? o.label ?? '' }) as HTMLButtonElement
      if (o.icon) { const i = h('span', { class: 'kp-icon' }); if (o.icon.trim().startsWith('<')) i.innerHTML = o.icon; else i.textContent = o.icon; b.append(i) }
      if (o.label) b.append(h('span', null, o.label))
      b.addEventListener('click', guard(id, 'button click', () => o.onClick(ctx.data)))
      el.append(b)
    }),
  }

  /* ---- chat, events, hooks */
  const allowed = (perm: string) => (recOf(id)?.permissions ?? m.permissions ?? []).includes(perm)
  const need = (perm: string, what: string) => { if (!allowed(perm)) throw new Error(`This plugin did not ask for the "${perm}" permission, so it cannot ${what}. Add "${perm}" to its permissions.`) }
  const ai = {
    /** Ask one of your models and get the reply as text. Needs the "ai" permission. */
    ask: async (prompt: string, o: { system?: string; providerId?: string; model?: string } = {}) => {
      need('ai', 'use your AI models')
      const s = useStore.getState()
      const sel = o.providerId && o.model ? { providerId: o.providerId, model: o.model } : s.selected
      const p = s.providers.find((x) => x.id === sel?.providerId)
      if (!p || !sel) throw new Error('No model is selected in Koko.')
      return completeText(p, sel.model, o.system ?? 'You are a helpful assistant running inside a Koko plugin. Answer concisely.', String(prompt))
    },
    models: () => useStore.getState().providers.flatMap((p) => p.models.map((x) => ({ providerId: p.id, provider: p.name, model: x.id }))),
  }
  const chat = {
    current: () => { const s = useStore.getState(); const c = s.chats.find((x) => x.id === s.activeId); return c ? { id: c.id, title: c.title, mode: c.mode ?? 'chat', messageCount: c.messages.length } : null },
    send: (text: string) => { need('chat', 'send messages'); return useStore.getState().send(String(text), []) },
    setInput: (text: string) => window.dispatchEvent(new CustomEvent('koko:set-input', { detail: String(text) })),
  }
  const on = (event: string, cb: (payload: any) => void) => {
    const f = own(`on(${event})`, cb) as any
    const set = L.events.get(event) ?? new Set(); set.add(f); L.events.set(event, set)
    return () => set.delete(f)
  }
  const hooks = {
    /** Change or cancel what the user is about to send: return the new text, or null to cancel. */
    beforeSend: (fn: (text: string) => unknown) => { const f = guard(id, 'hooks.beforeSend', fn as any) as any; L.beforeSend.add(f); return () => L.beforeSend.delete(f) },
  }

  /* ---- tools */
  const refreshTools = () => usePluginUI.setState((s) => ({ tools: { ...s.tools, [id]: [...L.tools.values()].map((t) => ({ name: t.name, description: t.description })) } }))
  const tools = {
    register: (def: PluginToolDef) => {
      if (!def || !TOOL.test(def.name) || typeof def.run !== 'function') throw new Error('A tool needs a name (lowercase, numbers, underscores), a description and a run function.')
      L.tools.set(def.name, def); refreshTools()
      return () => { L.tools.delete(def.name); refreshTools() }
    },
    list: () => [...L.tools.keys()],
  }
  for (const t of m.tools ?? []) L.tools.set(t.name, t)
  refreshTools()

  const info = { id, name: m.name, version: String(m.version ?? '1.0.0') }
  return Object.freeze({
    apiVersion: PLUGIN_API_VERSION, plugin: info, settings, storage, css, ui, ai, chat, on, hooks, tools, cleanup,
    app: { theme: () => (root.classList.contains('dark') ? 'dark' : 'light') },
    log: (...a: unknown[]) => console.log(`[plugin ${id}]`, ...a),
  })
}

async function activate(rec: PluginRecord) {
  deactivate(rec.id)
  let manifest: PluginManifest
  try { manifest = parseManifest(rec.source) } catch (e) { setError(rec.id, message(e)); return }
  setError(rec.id, null)
  const L: Live = { manifest, source: rec.source, cleanups: [], tools: new Map(), settingListeners: new Set(), events: new Map(), beforeSend: new Set() }
  live.set(rec.id, L)
  usePluginUI.setState((s) => ({ running: { ...s.running, [rec.id]: true } }))
  try {
    const api = buildApi(rec.id, L)
    const res = await manifest.activate?.(api)
    if (typeof res === 'function') L.cleanups.push(res)
  } catch (e) {
    console.error(`[plugin ${rec.id}] activate failed`, e)
    setError(rec.id, `activate failed: ${message(e)}`)
    deactivate(rec.id, true)
  }
}

function deactivate(id: string, keepError = false) {
  const L = live.get(id)
  if (L) for (const c of L.cleanups.reverse()) { try { c() } catch (e) { console.error(`[plugin ${id}] cleanup`, e) } }
  live.delete(id)
  usePluginUI.setState((s) => {
    const tools = { ...s.tools }; delete tools[id]
    const running = { ...s.running }; delete running[id]
    const errors = { ...s.errors }; if (!keepError) delete errors[id]
    return { panels: s.panels.filter((x) => x.pluginId !== id), mounts: s.mounts.filter((x) => x.pluginId !== id), modals: s.modals.filter((x) => x.pluginId !== id), tools, running, errors }
  })
}

/** Start or stop plugins so they match what is installed and enabled. */
function reconcile() {
  const recs = useStore.getState().plugins
  for (const id of [...live.keys()]) { const r = recs.find((p) => p.id === id); if (!r || !r.enabled || live.get(id)!.source !== r.source) deactivate(id) }
  for (const r of recs) if (r.enabled && !live.has(r.id)) void activate(r)
}

let started = false
export function startPlugins() {
  if (started) return
  started = true
  reconcile()
  useStore.subscribe((s, prev) => {
    if (s.plugins === prev.plugins) return
    reconcile()
    for (const r of s.plugins) {
      const before = prev.plugins.find((p) => p.id === r.id)
      const L = live.get(r.id)
      if (!before || !L || before.values === r.values) continue
      for (const k of new Set([...Object.keys(before.values), ...Object.keys(r.values)])) if (before.values[k] !== r.values[k]) for (const cb of L.settingListeners) cb(k, valueOf(r.id, k))
    }
  })
}

/* ------------------------------------------------------------------------------------------------ used by the app */
export function emitPluginEvent(event: string, payload: unknown) {
  for (const L of live.values()) for (const cb of L.events.get(event) ?? []) cb(payload)
}

/** Let plugins change or cancel an outgoing message. */
export async function runBeforeSend(text: string): Promise<string | null> {
  let t = text
  for (const L of live.values()) for (const f of L.beforeSend) {
    const r = await f(t)
    if (r === null || r === false) return null
    if (typeof r === 'string') t = r
  }
  return t
}
export const hasBeforeSend = () => [...live.values()].some((L) => L.beforeSend.size > 0)

const toolName = (id: string, tool: string) => `${id.replace(/-/g, '_')}_${tool}`

/** Tools provided by running plugins that the user has left switched on. */
export function pluginTools(): ToolDef[] {
  const out: ToolDef[] = []
  const recs = useStore.getState().plugins
  for (const [id, L] of live) {
    const r = recs.find((p) => p.id === id)
    if (!r?.enabled) continue
    for (const t of L.tools.values()) {
      if (r.toolsOff.includes(t.name)) continue
      out.push({ name: toolName(id, t.name), description: `${t.description} (provided by the "${r.name}" plugin)`, parameters: (t.parameters as any) ?? { type: 'object', properties: {}, additionalProperties: false } })
    }
  }
  return out
}
export const isPluginTool = (name: string) => { for (const [id, L] of live) for (const t of L.tools.values()) if (toolName(id, t.name) === name) return true; return false }

export async function runPluginTool(name: string, args: any, ctx: { signal: AbortSignal; chatId: string }): Promise<{ output: string }> {
  for (const [id, L] of live) for (const t of L.tools.values()) {
    if (toolName(id, t.name) !== name) continue
    if (useStore.getState().plugins.find((p) => p.id === id)?.toolsOff.includes(t.name)) throw new Error('This tool is turned off in Settings → Plugins.')
    try {
      const r: any = await t.run(args ?? {}, ctx)
      const out = typeof r === 'string' ? r : r && typeof r === 'object' && typeof r.output === 'string' ? r.output : JSON.stringify(r ?? null)
      return { output: out.length > 20000 ? out.slice(0, 20000) + '\n…[truncated]' : out }
    } catch (e) { setError(id, `tool ${t.name}: ${message(e)}`); throw e }
  }
  throw new Error(`Unknown plugin tool: ${name}`)
}
