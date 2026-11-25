import { useDock } from './dock'
import { koko } from './desktop'
import { permissionOf, requireApproval, rootOf } from './permissions'
import type { ToolDef } from './tools'

/* ----------------------------- tool definitions ----------------------------- */
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false })
const tab = { type: 'string', description: 'Browser tab id. Default: the tab you are using (the one you opened last).' }

export const BROWSER_TOOLS: ToolDef[] = [
  {
    name: 'browser_open',
    description: 'Open a URL in a NEW tab of the browser in the side panel (the user can see it) and make it your current tab. Use this to look at a website, or at the app you are building (for example http://localhost:5173). Then use browser_read to see the page.',
    parameters: obj({ url: { type: 'string', description: 'Full URL, for example https://example.com or http://localhost:3000.' } }, ['url']),
  },
  {
    name: 'browser_navigate',
    description: 'Go to another URL in your current tab, or go back, forward or reload.',
    parameters: obj({ url: { type: 'string' }, action: { type: 'string', enum: ['back', 'forward', 'reload'] }, tab }),
  },
  {
    name: 'browser_read',
    description: 'Read the page in a tab: its title, URL, the visible text, and a numbered list of the interactive elements (links, buttons, inputs). Use the numbers (refs) with browser_click and browser_type. Refs change after every read, so read again after the page changes.',
    parameters: obj({ tab }),
  },
  {
    name: 'browser_click',
    description: 'Click an element by its ref number from the latest browser_read. Only if there is no ref (for example something inside a canvas or image) pass x and y in the pixels of your latest browser_screenshot. Afterwards read the page again to see what changed.',
    parameters: obj({ ref: { type: 'number' }, x: { type: 'number' }, y: { type: 'number' }, double: { type: 'boolean' }, tab }),
  },
  {
    name: 'browser_type',
    description: 'Type text into an input, textarea or editable element by its ref (it is clicked and focused first, and its current text is replaced unless clear is false). Set submit to press Enter afterwards. Never type passwords, card numbers or other secrets: ask the user to do that in the tab themselves.',
    parameters: obj({ ref: { type: 'number' }, text: { type: 'string' }, clear: { type: 'boolean', description: 'Replace the existing text (default true).' }, submit: { type: 'boolean' }, tab }, ['ref', 'text']),
  },
  {
    name: 'browser_key',
    description: 'Press a key in the page: Enter, Tab, Escape, Backspace, Delete, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End, PageUp, PageDown, Space, or a single character.',
    parameters: obj({ key: { type: 'string' }, tab }, ['key']),
  },
  {
    name: 'browser_scroll',
    description: 'Scroll the page. direction is down, up, top or bottom. amount is in pixels (default: most of a screen).',
    parameters: obj({ direction: { type: 'string', enum: ['down', 'up', 'top', 'bottom'] }, amount: { type: 'number' }, tab }, ['direction']),
  },
  {
    name: 'browser_screenshot',
    description: 'Take a screenshot of what the tab shows right now. You receive the image as a picture you can look at. Use it to check how a page looks (layout, colours, whether a UI change worked) when the text from browser_read is not enough.',
    parameters: obj({ tab }),
  },
  {
    name: 'browser_tabs',
    description: 'List the browser tabs that are open in the side panel (id, title, URL).',
    parameters: obj({}),
  },
]

export const isBrowserTool = (name: string) => name.startsWith('browser_')

/* ------------------------------ tabs and webviews ------------------------------ */
interface Handle { el: any; wc: Promise<number> }
const handles = new Map<string, Handle>()
const current = new Map<string, string>() // chat id -> the tab it is using
const shots = new Map<string, { w: number; cssW: number }>() // tab id -> size of the last screenshot

export function registerWebview(tabId: string, el: any) {
  const wc = new Promise<number>((res) => el.addEventListener('dom-ready', () => res(el.getWebContentsId()), { once: true }))
  handles.set(tabId, { el, wc })
  return () => { if (handles.get(tabId)?.el === el) handles.delete(tabId) }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const withTimeout = <T,>(p: Promise<T>, ms: number, msg: string) => Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(msg)), ms))])

const allowedHosts = new Set<string>()
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$|\.localhost$/

/** Browsing a website the session has not visited yet needs a yes (local dev servers do not). */
async function allowHost(ctx: Ctx, url: string) {
  let host = ''
  try { host = new URL(url).hostname } catch { throw new Error(`"${url}" is not a valid URL. Use a full address such as https://example.com.`) }
  if (!/^https?:$/.test(new URL(url).protocol)) throw new Error('Only http and https pages can be opened.')
  if (LOCAL.test(host) || permissionOf(ctx.chatId) === 'bypass') return
  const key = rootOf(ctx.chatId) + '|' + host
  if (allowedHosts.has(key)) return
  await requireApproval(ctx.chatId, ctx.callId, { kind: 'tool', title: `Browse ${host}`, detail: url }, ctx.signal, ctx.update)
  allowedHosts.add(key)
}

interface Ctx { chatId: string; callId: string; signal: AbortSignal; update: (fn: (b: any) => void) => void }

function need() {
  const k = koko()
  if (!k) throw new Error('The browser only works in the Koko desktop app.')
  return k
}

async function useTab(ctx: Ctx, id?: string) {
  const tabId = id ?? current.get(ctx.chatId)
  if (!tabId) throw new Error('You have no browser tab yet. Call browser_open with a URL first.')
  const t = useDock.getState().tabs.find((x) => x.id === tabId)
  if (!t || t.kind !== 'browser') { current.delete(ctx.chatId); throw new Error('That browser tab was closed. Call browser_open to open a new one.') }
  const d = useDock.getState()
  d.focus(tabId); d.setOpen(true)
  let h = handles.get(tabId)
  for (let i = 0; !h && i < 30; i++) { await sleep(100); h = handles.get(tabId) }
  if (!h) throw new Error('That tab has no page yet. Call browser_open with a URL.')
  const wc = await withTimeout(h.wc, 20000, 'The page did not start loading.')
  await sleep(80) // let the tab become visible before capturing it
  return { tabId, el: h.el, wc }
}

async function settle(el: any, ms = 400) {
  await sleep(ms)
  if (el.isLoading?.()) await withTimeout(new Promise<void>((r) => el.addEventListener('did-stop-loading', () => r(), { once: true })), 15000, 'x').catch(() => {})
  await sleep(150)
}

/* ------------------------------ page scripts ------------------------------ */
/* these run inside the page; they must not use anything from this file */
function snapshotScript() {
  const SEL = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=switch],[role=option],[onclick],[contenteditable=""],[contenteditable=true]'
  const vis = (el: Element) => { const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0' }
  const inView = (el: Element) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth }
  const all = [...document.querySelectorAll(SEL)].filter(vis)
  const ordered = [...all.filter(inView), ...all.filter((e) => !inView(e))].slice(0, 90)
  ;(window as any).__kokoEls = ordered
  const lab = (el: any) => String(el.getAttribute('aria-label') || el.innerText || el.placeholder || el.title || el.alt || el.value || el.name || '').replace(/\s+/g, ' ').trim().slice(0, 70)
  return {
    url: location.href, title: document.title, scrollY: Math.round(scrollY), maxScroll: Math.max(0, Math.round(document.documentElement.scrollHeight - innerHeight)), total: all.length,
    text: (document.body?.innerText ?? '').replace(/\n{3,}/g, '\n\n').slice(0, 6000),
    els: ordered.map((el: any, i) => { const tag = el.tagName.toLowerCase(); const type = tag === 'input' ? el.type : ''; return { ref: i + 1, tag, type, role: el.getAttribute('role') || '', label: lab(el), value: (tag === 'input' && type !== 'password') || tag === 'textarea' ? String(el.value || '').slice(0, 60) : '', href: tag === 'a' ? String(el.getAttribute('href') || '').slice(0, 100) : '', below: !inView(el), checked: el.checked === true, disabled: el.disabled === true } }),
  }
}

function locateScript(ref: number) {
  const el: any = (window as any).__kokoEls?.[ref - 1]
  if (!el || !el.isConnected) return null
  el.scrollIntoView({ block: 'center', inline: 'center' })
  const r = el.getBoundingClientRect()
  const label = String(el.getAttribute('aria-label') || el.innerText || el.placeholder || el.title || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 60)
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, label, tag: el.tagName.toLowerCase() }
}

function selectAllScript() {
  const a: any = document.activeElement
  if (a && typeof a.select === 'function') a.select()
  else document.execCommand('selectAll')
  return true
}

const sizeScript = () => ({ w: innerWidth, h: innerHeight })
const call = (fn: Function, ...args: unknown[]) => `(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(',')})`

/* --------------------------------- running --------------------------------- */
async function run<T>(op: Parameters<NonNullable<typeof window.koko>['browser']>[0], wc: number, args?: Record<string, unknown>): Promise<T> {
  const r = await need().browser(op, wc, args)
  if (!r.ok) throw new Error(r.error.message)
  return r.data as T
}

const fmtEl = (e: any) => {
  const kind = e.tag === 'a' ? 'link' : e.tag === 'input' ? `input[${e.type || 'text'}]` : e.role || e.tag
  return `[${e.ref}] ${kind}${e.label ? ` "${e.label}"` : ''}${e.value ? ` = "${e.value}"` : ''}${e.checked ? ' (checked)' : ''}${e.disabled ? ' (disabled)' : ''}${e.href ? ` → ${e.href}` : ''}${e.below ? ' (below the fold)' : ''}`
}

export async function runBrowserTool(name: string, a: Record<string, any>, ctx: Ctx): Promise<{ output: string; images?: string[] }> {
  const meta = (m: Record<string, unknown>) => ctx.update((b) => { b.meta = { ...(b.meta ?? {}), ...m } })
  const dock = useDock.getState()

  if (name === 'browser_tabs') {
    const list = dock.tabs.filter((t) => t.kind === 'browser')
    const urls = await Promise.all(list.map(async (t) => { const h = handles.get(t.id); try { return h ? String(h.el.getURL()) : '(empty)' } catch { return '(loading)' } }))
    return { output: list.length ? list.map((t, i) => `${t.id}${current.get(ctx.chatId) === t.id ? ' (yours)' : ''}: ${t.title} — ${urls[i]}`).join('\n') : 'No browser tabs are open.' }
  }

  if (name === 'browser_open') {
    const url = String(a.url ?? '').trim()
    if (!url) throw new Error('url is required')
    const full = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : 'http://' + url
    await allowHost(ctx, full)
    const id = dock.add('browser', { url: full })
    current.set(ctx.chatId, id)
    const t = await useTab(ctx, id)
    await settle(t.el, 600)
    const title = String(t.el.getTitle?.() ?? ''), now = String(t.el.getURL?.() ?? full)
    meta({ url: now, title })
    return { output: `Opened tab ${id}: "${title}" (${now}). It is your current tab. Call browser_read to see the page.` }
  }

  const t = await useTab(ctx, a.tab ? String(a.tab) : undefined)
  current.set(ctx.chatId, t.tabId)
  const info = () => ({ url: String(t.el.getURL?.() ?? ''), title: String(t.el.getTitle?.() ?? '') })
  const after = async () => { await settle(t.el); const i = info(); meta(i); return `Now at "${i.title}" (${i.url}).` }

  if (name === 'browser_navigate') {
    if (a.action === 'back') { t.el.goBack(); return { output: `Went back. ${await after()}` } }
    if (a.action === 'forward') { t.el.goForward(); return { output: `Went forward. ${await after()}` } }
    if (a.action === 'reload') { t.el.reload(); return { output: `Reloaded. ${await after()}` } }
    const url = String(a.url ?? '').trim()
    if (!url) throw new Error('Pass a url, or an action: back, forward or reload.')
    const full = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : 'http://' + url
    await allowHost(ctx, full)
    t.el.loadURL(full)
    return { output: `Loaded. ${await after()}` }
  }

  if (name === 'browser_read') {
    const s = await run<any>('exec', t.wc, { code: call(snapshotScript) })
    meta({ url: s.url, title: s.title, summary: `${s.els.length} elements` })
    const out = [
      `Page: "${s.title}" — ${s.url}`,
      `Scroll: ${s.scrollY}px of ${s.maxScroll}px${s.maxScroll > s.scrollY ? ' (more below)' : ''}`,
      `Interactive elements${s.total > s.els.length ? ` (first ${s.els.length} of ${s.total})` : ''}:`,
      s.els.length ? s.els.map(fmtEl).join('\n') : '(none)',
      '', 'Page text:', s.text || '(no text)',
    ]
    return { output: out.join('\n') }
  }

  if (name === 'browser_click' || name === 'browser_type') {
    let x: number, y: number, label = ''
    if (a.ref != null) {
      const p = await run<any>('exec', t.wc, { code: call(locateScript, Number(a.ref)) })
      if (!p) throw new Error(`Element ${a.ref} is gone. Call browser_read again to get fresh refs.`)
      ;({ x, y, label } = p)
      await sleep(120)
      // scrolling may have moved it: measure again
      const p2 = await run<any>('exec', t.wc, { code: call(locateScript, Number(a.ref)) })
      if (p2) ({ x, y } = p2)
    } else if (name === 'browser_click' && a.x != null && a.y != null) {
      const last = shots.get(t.tabId)
      const k = last ? last.cssW / last.w : 1
      x = Number(a.x) * k; y = Number(a.y) * k
    } else throw new Error('Pass the ref of the element (from browser_read).')
    meta({ label })
    await run('click', t.wc, { x, y, double: !!a.double })
    if (name === 'browser_click') return { output: `Clicked ${label ? `"${label}"` : 'the element'}. ${await after()} Call browser_read to see what changed.` }
    if (a.clear !== false) await run('exec', t.wc, { code: call(selectAllScript) })
    await run('text', t.wc, { text: String(a.text ?? '') })
    if (a.submit) await run('key', t.wc, { key: 'Enter' })
    return { output: `Typed into ${label ? `"${label}"` : 'the field'}${a.submit ? ' and pressed Enter' : ''}. ${await after()}` }
  }

  if (name === 'browser_key') {
    const key = String(a.key ?? '')
    meta({ label: key })
    await run('key', t.wc, { key })
    return { output: `Pressed ${key}. ${await after()}` }
  }

  if (name === 'browser_scroll') {
    const size = await run<any>('exec', t.wc, { code: call(sizeScript) })
    const dir = String(a.direction)
    meta({ label: dir })
    if (dir === 'top' || dir === 'bottom') await run('exec', t.wc, { code: `window.scrollTo(0, ${dir === 'top' ? 0 : 'document.documentElement.scrollHeight'})` })
    else await run('scroll', t.wc, { x: size.w / 2, y: size.h / 2, dy: (dir === 'up' ? -1 : 1) * (Number(a.amount) || Math.round(size.h * 0.8)) })
    await sleep(250)
    const pos = await run<any>('exec', t.wc, { code: '({y:Math.round(scrollY),max:Math.max(0,Math.round(document.documentElement.scrollHeight-innerHeight))})' })
    return { output: `Scrolled ${dir}. Now at ${pos.y}px of ${pos.max}px${pos.y >= pos.max ? ' (the bottom)' : ''}.` }
  }

  if (name === 'browser_screenshot') {
    const size = await run<any>('exec', t.wc, { code: call(sizeScript) })
    const s = await run<{ dataUrl: string; thumb: string; width: number; height: number }>('shot', t.wc)
    const outW = Math.min(1280, s.width)
    const outH = Math.round((s.height * outW) / s.width)
    shots.set(t.tabId, { w: outW, cssW: size.w })
    const i = info()
    meta({ ...i, thumb: s.thumb })
    return { output: `Screenshot of "${i.title}" (${i.url}), ${outW}×${outH} px. It is attached below as an image. For browser_click with x and y, use pixels of this image.`, images: [s.dataUrl] }
  }

  throw new Error(`Unknown browser tool: ${name}`)
}

