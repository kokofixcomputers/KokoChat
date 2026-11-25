import { useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Monitor, Moon, PanelLeft, Plug, Search, Settings as Cog, Sun } from 'lucide-react'
import { useStore } from '../store'
import { Popover, IconButton } from './ui'
import { presetOf } from '../lib/providers'
import { cn } from '../lib/utils'
import { ModelIcon, ProviderDot } from './ModelIcon'
export { ProviderDot }
import { setCompare } from '../lib/compare'
import { NotebookPen, Share2, Columns2, MoreHorizontal } from 'lucide-react'
import { useEffect } from 'react'
import { FolderOpen } from 'lucide-react'
import { ModeSwitch } from './CodeUI'
import { baseName, isDesktop, koko } from '../lib/desktop'
import { DockToggle } from './Dock'
import { PluginSlot } from './PluginSlot'

/** Which providers are folded shut in the model menus (remembered on this device). */
function useFolded() {
  const [folded, setFolded] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem('koko:folded-providers') ?? '{}') } catch { return {} } })
  const toggle = (id: string) => setFolded((f) => { const n = { ...f, [id]: !f[id] }; try { localStorage.setItem('koko:folded-providers', JSON.stringify(n)) } catch { /* ignore */ } return n })
  return { folded, toggle }
}

function ProviderHeader({ p, count, open, onToggle, locked }: { p: { preset: string; name: string }; count: number; open: boolean; onToggle: () => void; locked: boolean }) {
  return (
    <button onClick={() => !locked && onToggle()} className={cn('flex w-full items-center gap-2 rounded-xl px-2.5 pb-1 pt-2 text-left text-xs font-medium text-muted transition', !locked && 'hover:text-fg')}>
      <ChevronRight size={13} className={cn('shrink-0 text-faint transition-transform', open && 'rotate-90', locked && 'opacity-40')} />
      <ProviderDot preset={p.preset} name={p.name} size={16} /><span className="min-w-0 flex-1 truncate">{p.name}</span><span className="tabular-nums text-faint">{count}</span>
    </button>
  )
}

function ModelPicker() {
  const { providers, selected, select, openSettings } = useStore()
  const [q, setQ] = useState('')
  const current = providers.find((p) => p.id === selected?.providerId)
  const { folded, toggle: toggleFold } = useFolded()
  const groups = useMemo(
    () => providers.map((p) => ({ p, models: p.models.filter((m) => m.id.toLowerCase().includes(q.toLowerCase())) })).filter((g) => g.models.length),
    [providers, q],
  )
  return (
    <Popover
      side="bottom"
      panelClassName="w-80 max-w-[90vw]"
      button={(open, toggle) => (
        <button data-tour="model" onClick={toggle} className={cn('flex h-10 max-w-[60vw] items-center gap-2 rounded-full px-3 text-sm font-medium transition hover:bg-fg/5', open && 'bg-fg/5')}>
          {current && selected ? <ModelIcon model={selected.model} preset={current.preset} name={current.name} size={22} /> : <Plug size={16} className="text-muted" />}
          <span className="truncate">{selected ? selected.model : 'Select a model'}</span>
          <ChevronDown size={15} className={cn('shrink-0 text-muted transition-transform', open && 'rotate-180')} />
        </button>
      )}
    >
      {(close) => (
        <div>
          <div className="relative p-1">
            <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-faint" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search models" className="h-9 w-full rounded-full bg-fg/5 pl-9 pr-3 text-sm placeholder:text-faint" />
          </div>
          <div className="max-h-80 overflow-y-auto">
            {groups.map(({ p, models }) => (
              <div key={p.id} className="pb-1">
                <ProviderHeader p={p} count={models.length} open={!folded[p.id] || !!q.trim()} locked={!!q.trim()} onToggle={() => toggleFold(p.id)} />
                {(!folded[p.id] || !!q.trim()) && models.map((m) => {
                  const on = selected?.providerId === p.id && selected.model === m.id
                  return (
                    <button key={m.id} onClick={() => { select(p.id, m.id); close() }} className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-sm transition hover:bg-fg/5">
                      <ModelIcon model={m.id} preset={p.preset} name={p.name} size={22} /><span className="flex-1 truncate">{m.id}</span>{on && <Check size={15} className="text-accent" />}
                    </button>
                  )
                })}
              </div>
            ))}
            {!groups.length && <p className="px-3 py-6 text-center text-sm text-muted">{providers.length ? 'No models match.' : 'No providers yet.'}</p>}
          </div>
          <button onClick={() => { close(); setCompare(true) }} className="mt-1 flex w-full items-center gap-2 rounded-xl border-t border-line px-2.5 py-2.5 text-sm transition hover:bg-fg/5">
            <Columns2 size={15} className="text-accent" />Compare models
          </button>
          <button onClick={() => { close(); openSettings('providers') }} className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2.5 text-sm text-accent transition hover:bg-fg/5">
            <Plug size={15} />Manage providers
          </button>
        </div>
      )}
    </Popover>
  )
}

/** Per-chat custom instructions (a small modal, so it works the same on phones and desktops). */
function InstructionsSheet() {
  const { chats, activeId, setChatSystem } = useStore()
  const chat = chats.find((c) => c.id === activeId)
  const [open, setOpen] = useState(false)
  useEffect(() => { const f = () => setOpen(true); window.addEventListener('koko:instructions', f); return () => window.removeEventListener('koko:instructions', f) }, [])
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open])
  if (!open || !chat) return null
  return (
    <div className="pointer-events-auto fixed inset-0 z-[110] grid place-items-center bg-black/35 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="glass-strong anim-pop w-full max-w-md rounded-[28px] p-5">
        <div className="mb-1 text-lg font-semibold tracking-tight">Chat instructions</div>
        <p className="mb-3 text-sm text-muted">Applies only to this chat, on top of your global system prompt.</p>
        <textarea autoFocus value={chat.system ?? ''} onChange={(e) => setChatSystem(chat.id, e.target.value)} rows={6} placeholder="e.g. Answer as a senior Rust engineer. Keep replies short." className="w-full resize-y rounded-2xl border border-line bg-surface-2/60 px-4 py-3 text-[15px] leading-relaxed placeholder:text-faint focus:border-accent/60" />
        <button onClick={() => setOpen(false)} className="mt-3 h-10 w-full rounded-full bg-fg text-sm font-medium text-bg active:scale-[0.98]">Done</button>
      </div>
    </div>
  )
}

function Check2({ on }: { on: boolean }) {
  return (
    <span className={cn('grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[6px] border-[1.5px] transition-all duration-150', on ? 'border-accent bg-accent text-accent-fg' : 'border-faint/60 bg-surface')}>
      {on && <Check size={12} strokeWidth={3.2} className="anim-pop" />}
    </span>
  )
}

/** In compare mode the model picker selects several models (2-4). */
function MultiModelPicker() {
  const { providers, settings, setSettings } = useStore()
  const [q, setQ] = useState('')
  const sel = settings.compare.models
  const { folded, toggle: toggleFold } = useFolded()
  const has = (providerId: string, model: string) => sel.some((x) => x.providerId === providerId && x.model === model)
  const toggle = (providerId: string, model: string) => {
    const on = has(providerId, model)
    if (on && sel.length <= 2) return
    if (!on && sel.length >= 4) return
    setSettings({ compare: { ...settings.compare, models: on ? sel.filter((x) => !(x.providerId === providerId && x.model === model)) : [...sel, { providerId, model }] } })
  }
  const groups = useMemo(() => providers.map((p) => ({ p, models: p.models.filter((m) => m.id.toLowerCase().includes(q.toLowerCase())) })).filter((g) => g.models.length), [providers, q])
  return (
    <Popover
      side="bottom" align="center" panelClassName="w-80 max-w-[92vw]"
      button={(open, toggleOpen) => (
        <button onClick={toggleOpen} className={cn('flex h-10 max-w-[62vw] items-center gap-2 rounded-full px-3 text-sm font-medium transition hover:bg-fg/5', open && 'bg-fg/5')}>
          <span className="flex -space-x-1.5">
            {sel.slice(0, 4).map((x, i) => { const p = providers.find((y) => y.id === x.providerId); return <span key={i} style={{ zIndex: 5 - i }} className="rounded-lg ring-2 ring-surface"><ModelIcon model={x.model} preset={p?.preset ?? 'custom'} name={p?.name ?? ''} size={22} /></span> })}
          </span>
          <span className="truncate">{sel.length} models</span>
          <ChevronDown size={15} className={cn('shrink-0 text-muted transition-transform', open && 'rotate-180')} />
        </button>
      )}
    >
      <div>
        <div className="px-2.5 pb-1 pt-1.5 text-xs text-muted">Pick 2–4 models. Each answers every message.</div>
        <div className="relative p-1">
          <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search models" className="h-9 w-full rounded-full bg-fg/5 pl-9 pr-3 text-sm placeholder:text-faint" />
        </div>
        <div className="max-h-80 overflow-y-auto">
          {groups.map(({ p, models }) => (
            <div key={p.id} className="pb-1">
              <ProviderHeader p={p} count={models.length} open={!folded[p.id] || !!q.trim()} locked={!!q.trim()} onToggle={() => toggleFold(p.id)} />
              {(!folded[p.id] || !!q.trim()) && models.map((m) => {
                const on = has(p.id, m.id)
                const blocked = (!on && sel.length >= 4) || (on && sel.length <= 2)
                return (
                  <button key={m.id} role="checkbox" aria-checked={on} onClick={() => toggle(p.id, m.id)} className={cn('flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-sm transition hover:bg-fg/5', blocked && !on && 'opacity-40')}>
                    <Check2 on={on} /><ModelIcon model={m.id} preset={p.preset} name={p.name} size={20} /><span className="min-w-0 flex-1 truncate">{m.id}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
        <button onClick={() => setSettings({ compare: { ...settings.compare, enabled: false } })} className="mt-1 flex w-full items-center gap-2 rounded-xl border-t border-line px-2.5 py-2.5 text-sm text-muted transition hover:bg-fg/5 hover:text-fg">Turn off compare mode</button>
      </div>
    </Popover>
  )
}

export function TopBar() {
  const { settings, setSettings, openSettings, sidebarOpen, setSidebar } = useStore()
  const cwd = useStore((st) => { const c = st.chats.find((x) => x.id === st.activeId); return c?.mode === 'code' ? c.cwd : undefined })
  const code = useStore((st) => st.appMode === 'code' && isDesktop())
  const mac = isDesktop() && koko()?.platform === 'darwin' // the title bar already has these buttons
  const next = { light: 'dark', dark: 'system', system: 'light' } as const
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center px-3 pt-3">
      <div className="glass-strong pointer-events-auto flex items-center gap-1 rounded-full p-1">
        {!sidebarOpen && !mac && <IconButton title="Open sidebar" onClick={() => setSidebar(true)}><PanelLeft size={18} /></IconButton>}
        {!sidebarOpen && isDesktop() && <ModeSwitch compact />}
        {settings.compare.enabled && !code ? <MultiModelPicker /> : <ModelPicker />}
        {cwd && <button onClick={() => window.koko?.openFolder(cwd)} title={`${cwd} (click to open)`} className="flex h-10 max-w-[11rem] items-center gap-2 rounded-full px-3 text-sm text-muted transition hover:bg-fg/5 hover:text-fg max-sm:hidden"><FolderOpen size={15} className="shrink-0 text-accent" /><span className="truncate">{baseName(cwd)}</span></button>}
        <div className="mx-1 h-5 w-px bg-line max-sm:hidden" />
        <div className="flex items-center gap-1 max-sm:hidden">
          <IconButton title="Chat instructions" onClick={() => window.dispatchEvent(new Event('koko:instructions'))}><NotebookPen size={17} /></IconButton>
          {!code && <IconButton title="Share chat" onClick={() => window.dispatchEvent(new Event('koko:share'))}><Share2 size={17} /></IconButton>}
          <IconButton title={`Theme: ${settings.theme}`} onClick={() => setSettings({ theme: next[settings.theme] })}>
            {settings.theme === 'light' ? <Sun size={17} /> : settings.theme === 'dark' ? <Moon size={17} /> : <Monitor size={17} />}
          </IconButton>
          <PluginSlot name="topbar" className="flex items-center gap-1" />
          <IconButton title="Settings" onClick={() => openSettings()}><Cog size={17} /></IconButton>
          {code && !mac && <DockToggle cwd={cwd} />}
        </div>
        <Popover
          side="bottom" align="right" className="sm:hidden" panelClassName="w-60"
          button={(open, toggle) => <IconButton title="More" onClick={toggle} className={cn(open && 'bg-fg/5 text-fg')}><MoreHorizontal size={18} /></IconButton>}
        >
          {(close) => (
            <div>
              {[
                { icon: <NotebookPen size={16} />, label: 'Chat instructions', run: () => window.dispatchEvent(new Event('koko:instructions')) },
                { icon: <Share2 size={16} />, label: 'Share chat', run: () => window.dispatchEvent(new Event('koko:share')) },
                { icon: <Columns2 size={16} />, label: settings.compare.enabled ? 'Turn off compare' : 'Compare models', run: () => setCompare() },
                { icon: settings.theme === 'light' ? <Sun size={16} /> : settings.theme === 'dark' ? <Moon size={16} /> : <Monitor size={16} />, label: `Theme: ${settings.theme}`, run: () => setSettings({ theme: next[settings.theme] }) },
                { icon: <Cog size={16} />, label: 'Settings', run: () => openSettings() },
              ].map((it) => (
                <button key={it.label} onClick={() => { close(); it.run() }} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition active:bg-fg/5"><span className="text-muted">{it.icon}</span>{it.label}</button>
              ))}
            </div>
          )}
        </Popover>
      </div>
      <InstructionsSheet />
    </div>
  )
}
