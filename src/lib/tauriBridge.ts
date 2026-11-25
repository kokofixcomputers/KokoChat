/** Gives the Rust shell the same `window.koko` bridge the Electron preload provides, so Code mode runs unchanged. */
import type { KokoApi } from './desktop'

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>

export async function installTauriBridge() {
  const [{ invoke }, { getCurrentWebview }] = await Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/api/webview')])
  const call = invoke as Invoke
  const view = getCurrentWebview()

  // listen once per event, up front, so nothing is missed between subscribing and the first message
  const channel = async <T>(name: string) => {
    const subs = new Set<(v: T) => void>()
    await view.listen<T>(name, (e) => subs.forEach((f) => f(e.payload)))
    return (cb: (v: T) => void) => { subs.add(cb); return () => { subs.delete(cb) } }
  }
  const [shellData, ptyData, ptyExit, closeRequest, openSettings, browserOpen, browserEvent] = await Promise.all([
    channel<{ id: string; chunk: string }>('koko:shell:data'), channel<{ id: string; data: string }>('koko:pty:data'), channel<{ id: string; code: number }>('koko:pty:exit'),
    channel<number>('koko:close-request'), channel<null>('koko:open-settings'), channel<string>('koko:browser:open'), channel<BrowserEvent>('koko:browser:event'),
  ])
  const [notifyEvent, focus] = await Promise.all([channel<{ id: string; type: 'click' | 'action'; index?: number }>('koko:notify:event'), channel<boolean>('koko:focus')])
  // notifications only appear when you are not looking: ask the window itself, the web view can miss it
  let focused = true
  focus((f) => { focused = f })
  const webFocus = document.hasFocus.bind(document)
  document.hasFocus = () => focused && webFocus()
  browserEvents = browserEvent
  invokeRef = call

  const failed = (e: unknown) => ({ ok: false as const, error: { message: String(e), code: 'ERR' } })
  const op = (name: string) => (args: unknown) => call<any>('koko', { op: name, args }).catch(failed)
  const ops = (prefix: string, names: string[]) => Object.fromEntries(names.map((n) => [n, op(`${prefix}:${n}`)])) as any
  const send = (cmd: string, args: Record<string, unknown>) => { void call(cmd, args).catch((e) => console.error(cmd, e)) }

  const noQuick = { enabled: false, shortcut: '', menuBar: false, registered: false, defaultShortcut: '' }
  const later = 'is not in the Rust app yet.'
  const nothing = () => () => {}

  const api: KokoApi & { setBusy: (n: number) => void } = {
    isElectron: true, // means "desktop shell"; the interface checks this name
    platform: /Mac/.test(navigator.platform) ? 'darwin' : /Win/.test(navigator.platform) ? 'win32' : 'linux',
    setBusy: (n) => send('set_busy', { n }),
    pickFolder: () => call<string | null>('pick_folder'),
    reveal: (path) => call<void>('reveal', { path }),
    openFolder: (path) => call<string>('open_folder', { path }),
    fs: ops('fs', ['read', 'write', 'append', 'edit', 'writeBase64', 'list', 'find', 'search', 'tree', 'readRaw']),
    git: ops('git', ['status', 'diff', 'stage', 'unstage', 'discard', 'commit', 'branches', 'checkout', 'push', 'pull', 'log', 'changes', 'branchchanges']),
    checkpoint: ops('checkpoint', ['info', 'revert']),
    project: ops('project', ['context']),
    shell: { run: op('shell:run') as any, kill: (id) => call<boolean>('shell_kill', { id }), onData: shellData },
    term: {
      open: (a) => call<any>('pty_open', a as any).catch(failed),
      write: (a) => send('pty_write', a),
      resize: (a) => send('pty_resize', a),
      kill: (a) => send('pty_kill', a),
      onData: ptyData, onExit: ptyExit,
    },
    browser: (name, id, args) => call<any>('browser_op', { op: name, id, args: args ?? {} }).catch(failed),
    onBrowserOpen: browserOpen,
    onOpenSettings: (cb) => openSettings(() => cb()),
    onCloseRequest: closeRequest,
    closeAnswer: (ok) => send('close_answer', { ok }),
    // not ported yet
    quick: {
      submit: () => {}, hide: () => {}, resize: () => {}, selectReady: () => {}, selectDone: () => {}, openScreenSettings: async () => {},
      capture: async () => ({ error: `Screen capture ${later}` }), onShow: nothing, onSubmit: nothing, onSelectImage: nothing,
      getConfig: async () => noQuick, setConfig: async () => ({ ...noQuick, error: `Quick ask ${later}` }),
    },
    oauth: { popup: async () => ({ error: `Signing in with 1minRelay ${later} Paste an API key instead.` }) },
    notify: {
      show: async (note) => {
        const problem = await call<string>('notify_show', { note }).catch(String)
        notifyProblem = problem
        if (problem) console.warn('notification:', problem)
        return !problem
      },
      close: (id) => send('notify_close', { id }),
      onEvent: notifyEvent,
    },
  }
  window.koko = api
}

/** Why the last notification was not shown (empty when it was). */
export let notifyProblem = ''

/* ------------------------------ side-panel browser ------------------------------ */
interface BrowserEvent { id: number; type: 'started' | 'stopped' | 'title'; value: string }
interface PageState { url: string; title: string; loading: boolean; back: boolean; forward: boolean }
let browserEvents: (cb: (e: BrowserEvent) => void) => () => void
let invokeRef: Invoke
let nextId = Math.floor(Math.random() * 1_000_000) + 1

/** Is the panel's spot actually showing? The native page sits above all HTML, so hide it whenever something covers that spot. */
function visibleRect(host: HTMLElement) {
  const r = host.getBoundingClientRect()
  if (r.width < 2 || r.height < 2 || !host.isConnected) return null
  const xs = [r.left + 6, r.left + r.width / 2, r.right - 6], ys = [r.top + 6, r.top + r.height / 2, r.bottom - 6]
  for (const x of xs) for (const y of ys) { const top = document.elementFromPoint(x, y); if (!top || !host.contains(top)) return null }
  return { x: r.left, y: r.top, w: r.width, h: r.height }
}

/**
 * A stand-in for Electron's <webview> element, backed by a native child web view that follows `host`.
 * It offers the same methods and events, so the side panel and the agent's browser tools need no changes.
 */
export function createTauriWebview(host: HTMLElement, startUrl: string) {
  const id = nextId++
  const el = new EventTarget() as EventTarget & Record<string, any>
  let state: PageState = { url: startUrl, title: '', loading: true, back: false, forward: false }
  let gone = false, ready = false, created = false, placed = ''
  const emit = (type: string, extra: Record<string, unknown> = {}) => el.dispatchEvent(Object.assign(new Event(type), extra))

  const refresh = async () => {
    if (gone || !created) return
    const s = await invokeRef<PageState>('browser_state', { id }).catch(() => null)
    if (!s || gone) return
    const was = state
    state = { ...s, url: s.url || was.url, loading: was.loading && s.loading }
    if (state.url !== was.url || state.back !== was.back || state.forward !== was.forward) emit('did-navigate', { url: state.url })
    if (s.title && s.title !== was.title) emit('page-title-updated', { title: s.title })
  }
  const finished = () => {
    state = { ...state, loading: false }
    if (!ready) { ready = true; emit('dom-ready') }
    void refresh().then(() => emit('did-stop-loading'))
  }
  const stopListening = browserEvents((e) => {
    if (e.id !== id) return
    if (e.type === 'started') { state = { ...state, loading: true }; emit('did-start-loading') }
    else if (e.type === 'stopped') finished()
    else void refresh()
  })

  const place = () => {
    if (gone || !created) return
    const rect = visibleRect(host)
    const key = JSON.stringify(rect)
    if (key === placed) return
    placed = key
    void invokeRef('browser_bounds', { id, rect }).catch(() => {})
  }
  const follow = setInterval(place, 80)
  const poll = setInterval(() => void refresh(), 1000) // pages that change their address without loading
  window.addEventListener('resize', place)

  const r = host.getBoundingClientRect()
  invokeRef('browser_create', { id, url: startUrl, rect: { x: r.left, y: r.top, w: r.width, h: r.height } })
    .then(() => { created = true; if (gone) void invokeRef('browser_close', { id }); else place() })
    .catch((e) => { console.error(e); finished() })

  const nav = (action: string, url?: string) => { void invokeRef('browser_nav', { id, action, url }).catch(() => { state = { ...state, loading: false }; emit('did-stop-loading') }) }
  Object.assign(el, {
    getWebContentsId: () => id,
    getURL: () => state.url,
    getTitle: () => state.title,
    isLoading: () => state.loading,
    canGoBack: () => state.back,
    canGoForward: () => state.forward,
    goBack: () => nav('back'),
    goForward: () => nav('forward'),
    reload: () => nav('reload'),
    loadURL: (u: string) => { state = { ...state, loading: true }; nav('load', u) },
    destroy: () => {
      gone = true
      clearInterval(follow); clearInterval(poll); window.removeEventListener('resize', place); stopListening()
      if (created) void invokeRef('browser_close', { id }).catch(() => {})
    },
  })
  return el
}
