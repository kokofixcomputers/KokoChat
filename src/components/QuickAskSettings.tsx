import { useEffect, useState } from 'react'
import { Zap } from 'lucide-react'
import { koko } from '../lib/desktop'
import { Toggle } from './ui'
import { cn } from '../lib/utils'

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
const SYMBOL: Record<string, string> = { CommandOrControl: isMac ? '⌘' : 'Ctrl', Command: '⌘', Control: isMac ? '⌃' : 'Ctrl', Ctrl: 'Ctrl', Alt: isMac ? '⌥' : 'Alt', Option: '⌥', Shift: isMac ? '⇧' : 'Shift', Super: isMac ? '⌘' : 'Win' }
const show = (acc: string) => acc.split('+').map((p) => SYMBOL[p] ?? p).join(isMac ? ' ' : ' + ')

/** KeyboardEvent -> an Electron accelerator, or null while it is only modifiers */
function toAccelerator(e: KeyboardEvent): string | null {
  const mods: string[] = []
  if (e.metaKey || e.ctrlKey) mods.push('CommandOrControl')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  const k = e.key
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(k)) return null
  const map: Record<string, string> = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Return' }
  const key = map[k] ?? (k.length === 1 ? k.toUpperCase() : k)
  if (!mods.length && !/^F\d{1,2}$/.test(key)) return null
  return [...mods, key].join('+')
}

/** Desktop only: the global shortcut that opens the floating quick-ask box. */
export function QuickAskSettings() {
  const k = koko()
  const [cfg, setCfg] = useState<{ enabled: boolean; shortcut: string; menuBar: boolean; registered: boolean; defaultShortcut: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [rec, setRec] = useState(false)
  useEffect(() => { void k?.quick.getConfig().then(setCfg) }, [k])

  useEffect(() => {
    if (!rec) return
    const on = async (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation()
      if (e.key === 'Escape') { setRec(false); return }
      const acc = toAccelerator(e)
      if (!acc) return
      setRec(false)
      const r = await k!.quick.setConfig({ shortcut: acc })
      setErr(r.error ?? null); setCfg((c) => (c ? { ...c, shortcut: r.shortcut, registered: r.registered, enabled: r.enabled } : c))
    }
    window.addEventListener('keydown', on, true)
    return () => window.removeEventListener('keydown', on, true)
  }, [rec, k])

  if (!k || !cfg) return null
  const set = async (p: { enabled?: boolean; shortcut?: string; menuBar?: boolean }) => { const r = await k.quick.setConfig(p); setErr(r.error ?? null); setCfg({ ...cfg, ...r }) }
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface/50 p-4">
      <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-soft text-accent"><Zap size={18} /></span>
        <div className="flex-1"><div className="text-sm font-medium">Quick ask</div><div className="text-xs text-muted">A shortcut that opens a small box on top of whatever you are doing. Type a question, or capture part of your screen to send with it. It opens as a new chat in Koko.</div></div>
        <Toggle on={cfg.enabled} onChange={(b) => void set({ enabled: b })} /></div>
      {cfg.enabled && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><div className="text-sm font-medium">Shortcut</div><div className="text-xs text-muted">Press it again, or Esc, to close the box.</div></div>
          <div className="flex items-center gap-2">
            <button onClick={() => { setErr(null); setRec(true) }} className={cn('h-9 min-w-[9rem] rounded-xl border px-4 font-mono text-sm transition', rec ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface-2/60 hover:border-fg/25')}>{rec ? 'Press the keys…' : show(cfg.shortcut)}</button>
            {cfg.shortcut !== cfg.defaultShortcut && <button onClick={() => void set({ shortcut: cfg.defaultShortcut })} className="text-xs font-medium text-muted hover:text-fg">Reset</button>}
          </div>
        </div>
      )}
      <div className="flex items-center gap-3"><div className="flex-1"><div className="text-sm font-medium">{isMac ? 'Show in the menu bar' : 'Show in the system tray'}</div><div className="text-xs text-muted">An icon you can click to open quick ask, even if you turn the shortcut off. Right-click it for more.</div></div><Toggle on={cfg.menuBar} onChange={(b) => void set({ menuBar: b })} /></div>
      {cfg.enabled && !cfg.registered && !err && <p className="text-xs text-danger">The shortcut is not active. Another app may be using it: choose a different one.</p>}
      {err && <p className="text-xs text-danger">{err}</p>}
      <p className="text-xs text-faint">On a Mac, the screen capture needs Screen Recording permission for Koko (System Settings → Privacy &amp; Security). The box opens with one press of the shortcut; holding the key is not detected.</p>
    </section>
  )
}
