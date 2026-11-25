import { useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react'
import { isTauri } from '../lib/tauri'
import { createTauriWebview } from '../lib/tauriBridge'
import { Blocks, FolderTree, Bot, Square, PanelRight, ArrowLeft, ArrowRight, Globe, Loader2, Plus, RotateCw, SquareTerminal, X } from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { useDock, type DockTab } from '../lib/dock'
import { koko } from '../lib/desktop'
import { Popover } from './ui'
import { MessageView } from './Message'
import { agentActivity, useAgentApproval } from './AgentCard'
import { useStore } from '../store'
import { reportOf } from '../lib/agents'
import { registerWebview } from '../lib/browser'
import { FilesView } from './FilesView'
import { usePluginUI } from '../lib/pluginHost'
import { cn } from '../lib/utils'


const css = (v: string, d: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || d

function TerminalView({ tab, visible }: { tab: DockTab; visible: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const api = useRef<{ term: Terminal; fit: FitAddon } | null>(null)
  const rename = useDock((s) => s.rename)
  const [err, setErr] = useState('')

  useEffect(() => {
    const k = koko()
    if (!k || !host.current) return
    const dark = () => document.documentElement.classList.contains('dark')
    const theme = () => ({ background: '#00000000', foreground: dark() ? '#e6e6e6' : '#1d1d1f', cursor: css('--accent', '#3f9f6b'), selectionBackground: dark() ? '#ffffff30' : '#00000022' })
    const term = new Terminal({ allowTransparency: true, fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace', fontSize: 12.5, lineHeight: 1.25, cursorBlink: true, scrollback: 5000, theme: theme(), macOptionIsMeta: true })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon((_e, url) => { const d = useDock.getState(); d.add('browser', { url }) }))
    term.open(host.current)
    api.current = { term, fit }
    try { fit.fit() } catch { /* hidden */ }
    let alive = true
    void k.term.open({ id: tab.id, cwd: tab.cwd, cols: term.cols, rows: term.rows }).then((r) => {
      if (!alive) return
      if (!r.ok) setErr(r.error.message)
      else if (tab.input) setTimeout(() => k.term.write({ id: tab.id, data: tab.input + '\r' }), 700) // the shell needs a moment to show its prompt
    })
    const offData = k.term.onData((d) => { if (d.id === tab.id) term.write(d.data) })
    const offExit = k.term.onExit((d) => { if (d.id === tab.id) term.write(`\r\n\x1b[2m[process exited${d.code ? ` with code ${d.code}` : ''}]\x1b[0m\r\n`) })
    const inp = term.onData((data) => k.term.write({ id: tab.id, data }))
    const title = term.onTitleChange((t) => { if (t) rename(tab.id, t.replace(/^.*[\\/]/, '').slice(0, 24) || t.slice(0, 24)) })
    const ro = new ResizeObserver(() => {
      if (!host.current?.offsetWidth) return
      try { fit.fit(); k.term.resize({ id: tab.id, cols: term.cols, rows: term.rows }) } catch { /* ignore */ }
    })
    ro.observe(host.current)
    const mo = new MutationObserver(() => { term.options.theme = theme() })
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-accent', 'data-palette'] })
    return () => { alive = false; offData(); offExit(); inp.dispose(); title.dispose(); ro.disconnect(); mo.disconnect(); k.term.kill({ id: tab.id }); term.dispose(); api.current = null }
  }, [tab.id]) // eslint-disable-line

  useEffect(() => { if (visible) requestAnimationFrame(() => { try { api.current?.fit.fit(); api.current?.term.focus() } catch { /* ignore */ } }) }, [visible])

  return (
    <div className={cn('absolute inset-0', !visible && 'hidden')}>
      <div ref={host} className="h-full w-full overflow-hidden" />
      {err && <p className="absolute inset-x-4 top-4 rounded-2xl bg-danger/10 px-3 py-2 text-xs text-danger">Could not start the terminal: {err}</p>}
    </div>
  )
}

const toUrl = (raw: string) => {
  const t = raw.trim()
  if (!t) return ''
  if (/^https?:\/\//i.test(t)) return t
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?([/?#]|$)/i.test(t)) return 'http://' + t
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?([/?#]\S*)?$/.test(t)) return 'https://' + t
  return 'https://duckduckgo.com/?q=' + encodeURIComponent(t)
}

/** The Rust shell's browser page: a native view that follows this box. It fills `target` before the parent's effects run. */
function TauriPage({ url, target }: { url: string; target: React.MutableRefObject<any> }) {
  const host = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = createTauriWebview(host.current!, url)
    target.current = el
    return () => el.destroy()
  }, []) // eslint-disable-line
  return <div ref={host} className="absolute inset-0" />
}

function BrowserView({ tab, visible }: { tab: DockTab; visible: boolean }) {
  const wv = useRef<any>(null)
  const rename = useDock((s) => s.rename)
  const [started, setStarted] = useState(tab.startUrl ?? '')
  const [url, setUrl] = useState(tab.startUrl ?? '')
  const [loading, setLoading] = useState(false)
  const [nav, setNav] = useState({ back: false, fwd: false })
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = wv.current
    if (!el) return
    const upd = () => { try { setNav({ back: el.canGoBack(), fwd: el.canGoForward() }) } catch { /* not ready */ } }
    const on = (n: string, f: (e: any) => void) => el.addEventListener(n, f)
    on('did-start-loading', () => setLoading(true))
    on('did-stop-loading', () => { setLoading(false); upd() })
    on('did-navigate', (e) => { setUrl(e.url); upd() })
    on('did-navigate-in-page', (e) => { if (e.isMainFrame) { setUrl(e.url); upd() } })
    on('page-title-updated', (e) => rename(tab.id, String(e.title).slice(0, 28)))
  }, [started]) // eslint-disable-line
  useEffect(() => { if (visible && !started) input.current?.focus() }, [visible, started])
  useEffect(() => (started && wv.current ? registerWebview(tab.id, wv.current) : undefined), [started]) // eslint-disable-line

  const go = (raw: string) => {
    const u = toUrl(raw)
    if (!u) return
    setUrl(u)
    if (!started) setStarted(u)
    else { try { wv.current?.loadURL(u) } catch { /* not ready */ } }
  }

  return (
    <div className={cn('absolute inset-0 flex flex-col', !visible && 'hidden')}>
      <form onSubmit={(e) => { e.preventDefault(); go(url) }} className="flex shrink-0 items-center gap-1 px-2 pb-2">
        <button type="button" disabled={!nav.back} onClick={() => wv.current?.goBack()} className="grid h-8 w-8 place-items-center rounded-full text-muted transition hover:bg-fg/5 hover:text-fg disabled:opacity-30"><ArrowLeft size={15} /></button>
        <button type="button" disabled={!nav.fwd} onClick={() => wv.current?.goForward()} className="grid h-8 w-8 place-items-center rounded-full text-muted transition hover:bg-fg/5 hover:text-fg disabled:opacity-30"><ArrowRight size={15} /></button>
        <button type="button" disabled={!started} onClick={() => wv.current?.reload()} className="grid h-8 w-8 place-items-center rounded-full text-muted transition hover:bg-fg/5 hover:text-fg disabled:opacity-30">{loading ? <Loader2 size={15} className="spin" /> : <RotateCw size={15} />}</button>
        <input ref={input} value={url} onChange={(e) => setUrl(e.target.value)} onFocus={(e) => e.currentTarget.select()} placeholder="Search or enter a URL" spellCheck={false} className="h-8 min-w-0 flex-1 rounded-full bg-fg/5 px-3.5 text-[13px] outline-none transition placeholder:text-faint focus:bg-fg/8 focus:ring-2 focus:ring-accent/40" />
      </form>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl bg-white">
        {started ? (isTauri()
          ? <TauriPage url={started} target={wv} />
          : <webview ref={wv} src={started} allowpopups={true} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />) : (
          <div className="grid h-full place-items-center bg-bg p-6 text-center">
            <div>
              <Globe size={26} className="mx-auto mb-3 text-faint" />
              <p className="text-sm text-muted">Preview your app or look something up.</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {['localhost:3000', 'localhost:5173', 'localhost:8080'].map((u) => <button key={u} onClick={() => go(u)} className="rounded-full bg-fg/5 px-3 py-1.5 text-xs text-muted transition hover:bg-fg/8 hover:text-fg">{u}</button>)}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function PluginPanelView({ tab, visible }: { tab: DockTab; visible: boolean }) {
  const def = usePluginUI((s) => s.panels.find((p) => p.pluginId === tab.pluginId && p.id === tab.panelId))
  const close = useDock((s) => s.close)
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = host.current
    if (!h || !def) return
    h.replaceChildren()
    const el = document.createElement('div')
    el.className = 'kp-panel'
    h.append(el)
    let cleanup: void | (() => void)
    cleanup = def.render(el, { close: () => close(tab.id) })
    return () => { try { cleanup?.() } catch { /* plugin bug */ } h.replaceChildren() }
  }, [def]) // eslint-disable-line
  return (
    <div className={cn('absolute inset-0 overflow-auto p-4', !visible && 'hidden')}>
      {def ? <div ref={host} /> : <p className="py-10 text-center text-sm text-muted">This panel is not available. Its plugin may be turned off.</p>}
    </div>
  )
}

function AgentDot({ chatId }: { chatId: string }) {
  const run = useStore((s) => !!s.streaming[chatId])
  const wait = useAgentApproval(chatId)
  return <span className="relative shrink-0"><Bot size={13} />{(run || wait) && <span className={cn('absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full', wait ? 'bg-danger' : 'animate-pulse bg-accent')} />}</span>
}

function AgentView({ tab, visible }: { tab: DockTab; visible: boolean }) {
  const id = tab.chatId!
  const chat = useStore((s) => s.chats.find((c) => c.id === id))
  const running = useStore((s) => !!s.streaming[id])
  const stop = useStore((s) => s.stop)
  const pending = useAgentApproval(id)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const last = chat?.messages[chat.messages.length - 1]
  const tick = (last?.blocks?.length ?? 0) + ':' + ((last?.blocks?.at(-1) as any)?.text?.length ?? 0) + ':' + JSON.stringify((last?.blocks?.at(-1) as any)?.meta?.output?.length ?? 0)
  useEffect(() => { const el = scroller.current; if (el && stick.current && visible) el.scrollTop = el.scrollHeight }, [tick, chat?.messages.length, visible])
  const rep = chat ? reportOf(chat) : null
  return (
    <div className={cn('absolute inset-0 flex flex-col', !visible && 'hidden')}>
      <div className="flex shrink-0 items-center gap-2.5 px-4 pb-2 pt-1">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{chat?.sub?.name ?? tab.title}</span>
          <span className="block truncate text-xs text-muted">{!chat ? 'This sub-agent no longer exists' : pending ? 'Waiting for your approval' : running ? agentActivity(last?.blocks) : rep?.status === 'failed' ? 'Ran into a problem' : rep?.status === 'stopped' ? 'Stopped' : 'Finished'}</span>
        </span>
        {running && <button onClick={() => stop(id)} className="flex h-8 items-center gap-1.5 rounded-full bg-danger/10 px-3 text-[13px] font-medium text-danger transition hover:bg-danger/15"><Square size={11} fill="currentColor" />Stop</button>}
      </div>
      <div ref={scroller} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60 }} className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <div className="flex flex-col gap-5">
          {chat?.messages.map((m, i) => <MessageView key={m.id} chatId={id} m={m} last={i === chat.messages.length - 1} latestUser={false} readOnly />)}
        </div>
      </div>
    </div>
  )
}

export function Dock({ cwd }: { cwd?: string }) {
  const { tabs, active, add, close, focus, setOpen } = useDock()
  const activeChat = useStore((s) => s.activeId)
  const allChats = useStore((s) => s.chats)
  const panels = usePluginUI((s) => s.panels)
  const agents = useMemo(() => allChats.filter((c) => c.sub?.parentId === activeChat), [allChats, activeChat])
  useEffect(() => koko()?.onBrowserOpen?.((u) => useDock.getState().add('browser', { url: u })), [])

  return (
    <div className="glass-strong flex h-full w-full flex-col overflow-hidden rounded-[28px]">
      <div className="flex shrink-0 items-center gap-1 px-2.5 pb-1.5 pt-2.5">
        <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <div key={t.id} onClick={() => focus(t.id)} onAuxClick={(e) => e.button === 1 && close(t.id)} className={cn('group flex h-8 max-w-[11rem] shrink-0 cursor-pointer items-center gap-1.5 rounded-full pl-3 pr-1.5 text-[13px] transition', t.id === active ? 'bg-fg/8 font-medium' : 'text-muted hover:bg-fg/5 hover:text-fg')}>
              {t.kind === 'terminal' ? <SquareTerminal size={13} className="shrink-0" /> : t.kind === 'files' ? <FolderTree size={13} className="shrink-0" /> : t.kind === 'plugin' ? <Blocks size={13} className="shrink-0" /> : t.kind === 'agent' ? <AgentDot chatId={t.chatId!} /> : <Globe size={13} className="shrink-0" />}
              <span className="min-w-0 truncate">{t.title}</span>
              <button title="Close tab" onClick={(e) => { e.stopPropagation(); close(t.id) }} className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-faint hover:bg-fg/10 hover:text-fg"><X size={12} /></button>
            </div>
          ))}
        </div>
        <Popover side="bottom" align="right" panelClassName="w-56" button={(_o, toggle) => <button title="New tab" onClick={toggle} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted transition hover:bg-fg/5 hover:text-fg"><Plus size={16} /></button>}>
          {(closeMenu) => (
            <div>
              <button onClick={() => { add('terminal', { cwd }); closeMenu() }} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition hover:bg-fg/5"><SquareTerminal size={15} className="text-accent" />Terminal</button>
              <button onClick={() => { add('files', { cwd }); closeMenu() }} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition hover:bg-fg/5"><FolderTree size={15} className="text-accent" />Files &amp; changes</button>
              <button onClick={() => { add('browser'); closeMenu() }} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition hover:bg-fg/5"><Globe size={15} className="text-accent" />Browser</button>
              {panels.length > 0 && <div className="mt-1 border-t border-line pt-1"><div className="px-2.5 pb-1 pt-1.5 text-xs font-medium text-muted">Plugin panels</div>{panels.map((p) => <button key={p.pluginId + p.id} onClick={() => { add('plugin', { pluginId: p.pluginId, panelId: p.id, title: p.title }); closeMenu() }} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition hover:bg-fg/5"><Blocks size={15} className="shrink-0 text-accent" /><span className="min-w-0 flex-1 truncate">{p.title}</span></button>)}</div>}
              {agents.length > 0 && <div className="mt-1 border-t border-line pt-1"><div className="px-2.5 pb-1 pt-1.5 text-xs font-medium text-muted">Sub-agents</div>{agents.map((c) => <button key={c.id} onClick={() => { add('agent', { chatId: c.id, title: c.sub!.name }); closeMenu() }} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition hover:bg-fg/5"><Bot size={15} className="shrink-0 text-accent" /><span className="min-w-0 flex-1 truncate">{c.sub!.name}</span></button>)}</div>}
            </div>
          )}
        </Popover>
        <button title="Close panel" onClick={() => setOpen(false)} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted transition hover:bg-fg/5 hover:text-fg"><X size={16} /></button>
      </div>
      <div className="relative min-h-0 flex-1">
        {tabs.map((t) => t.kind === 'terminal' ? <TerminalView key={t.id} tab={t} visible={t.id === active} /> : t.kind === 'agent' ? <AgentView key={t.id} tab={t} visible={t.id === active} /> : t.kind === 'files' ? <FilesView key={t.id} cwd={t.cwd} visible={t.id === active} /> : t.kind === 'plugin' ? <PluginPanelView key={t.id} tab={t} visible={t.id === active} /> : <BrowserView key={t.id} tab={t} visible={t.id === active} />)}
        {!tabs.length && (
          <div className="grid h-full place-items-center p-6 text-center">
            <div className="space-y-2">
              <p className="text-sm text-muted">Open a terminal or a browser beside your session.</p>
              <div className="flex justify-center gap-2">
                <button onClick={() => add('terminal', { cwd })} className="flex items-center gap-2 rounded-full bg-fg px-4 py-2 text-sm font-medium text-bg"><SquareTerminal size={15} />Terminal</button>
                <button onClick={() => add('browser')} className="flex items-center gap-2 rounded-full bg-fg/8 px-4 py-2 text-sm font-medium"><Globe size={15} />Browser</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** Show or hide the side panel (a terminal opens the first time). */
export function toggleDock(cwd?: string) {
  const d = useDock.getState()
  if (!d.open && !d.tabs.length) d.add('terminal', { cwd })
  else d.setOpen(!d.open)
}

export function DockToggle({ cwd, className }: { cwd?: string; className?: string }) {
  const open = useDock((s) => s.open)
  return (
    <button title={open ? 'Hide side panel' : 'Show side panel (terminal, browser)'} onClick={() => toggleDock(cwd)} className={cn('app-nodrag grid h-8 w-8 place-items-center rounded-full transition hover:bg-fg/8 hover:text-fg', open ? 'bg-fg/8 text-fg' : 'text-muted', className)}>
      <PanelRight size={17} />
    </button>
  )
}
