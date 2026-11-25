import { useEffect, useState } from 'react'
import { ExternalLink, Loader2, Moon, Power, Sun, Terminal, Trash2 } from 'lucide-react'
import { useStore, type SandboxState } from '../store'
import { pauseSandbox, refreshSandboxState, wakeSandbox } from '../lib/sandbox'
import { Popover, Toggle } from './ui'
import { toast } from '../lib/toast'
import { cn } from '../lib/utils'

const LABEL: Record<SandboxState, string> = { unknown: 'Sandbox', active: 'Active', waking: 'Waking up…', sleeping: 'Going to sleep…', asleep: 'Asleep', gone: 'Expired' }
const DOT: Record<SandboxState, string> = { unknown: 'bg-faint', active: 'bg-accent', waking: 'bg-amber-400 animate-pulse', sleeping: 'bg-amber-400 animate-pulse', asleep: 'bg-faint', gone: 'bg-danger' }

/** Shows whether the chat's VM is awake or asleep. Hidden when the chat has no sandbox. */
export function SandboxStatus() {
  const { chats, activeId, sandboxState, settings, setSettings, removeSandbox } = useStore()
  const chat = chats.find((c) => c.id === activeId)
  const sb = chat?.sandbox
  const state: SandboxState = (activeId && sandboxState[activeId]) || 'unknown'
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!activeId || !sb) return
    void refreshSandboxState(activeId)
    const t = setInterval(() => { if (!document.hidden) void refreshSandboxState(activeId) }, 15_000)
    return () => clearInterval(t)
  }, [activeId, sb?.vmId]) // eslint-disable-line

  if (!chat || !sb || !settings.sandbox.apiKey) return null
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn() } catch (e: any) { toast.error(e.message) } setBusy(false) }
  const transitional = state === 'waking' || state === 'sleeping'

  return (
    <Popover
      side="top" align="left" panelClassName="w-80 max-w-[92vw]"
      button={(open, toggle) => (
        <button onClick={toggle} title={`Sandbox: ${LABEL[state]}`} className={cn('flex h-9 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium transition hover:bg-fg/5', open ? 'bg-fg/5 text-fg' : 'text-muted hover:text-fg')}>
          <Terminal size={16} />
          <span className={cn('h-2 w-2 rounded-full transition-colors', DOT[state])} />
          <span className="hidden sm:inline">{LABEL[state]}</span>
        </button>
      )}
    >
      <div className="p-2">
        <div className="flex items-center gap-3">
          <span className={cn('grid h-10 w-10 place-items-center rounded-xl', state === 'active' ? 'bg-accent-soft text-accent' : 'bg-fg/6 text-muted')}>
            {transitional ? <Loader2 size={18} className="spin" /> : state === 'active' ? <Sun size={18} /> : <Moon size={18} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{state === 'asleep' ? 'Asleep' : state === 'active' ? 'Active' : LABEL[state].replace('…', '')}</div>
            <div className="truncate font-mono text-xs text-muted">{sb.slug}</div>
          </div>
        </div>
        <p className="mt-2.5 px-0.5 text-xs leading-relaxed text-muted">
          {state === 'asleep' ? 'Paused to save compute. Files and memory are kept; it wakes up when the AI runs a command or writes a file.'
            : state === 'gone' ? 'This VM no longer exists. A fresh one is created the next time the AI needs it.'
            : sb.urls?.length ? 'A deployed app is running, so this VM stays awake after replies.'
            : settings.sandbox.sleepAfterTurn ? 'It goes to sleep after each reply and wakes when needed.' : 'It stays awake until it idles out.'}
        </p>
        {!!sb.urls?.length && (
          <div className="mt-2 flex flex-col gap-1">
            {sb.urls.map((u) => <a key={u.url} href={u.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg bg-fg/5 px-2.5 py-1.5 font-mono text-xs text-accent hover:bg-fg/8"><span className="min-w-0 flex-1 truncate">{u.url}</span><ExternalLink size={12} /></a>)}
          </div>
        )}
        <div className="mt-3 flex gap-2">
          <button disabled={busy || transitional || state === 'active' || state === 'gone'} onClick={() => run(() => wakeSandbox(chat.id))} className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full bg-fg text-[13px] font-medium text-bg active:scale-95 disabled:opacity-40"><Sun size={14} />Wake up</button>
          <button disabled={busy || transitional || state !== 'active'} onClick={() => run(() => pauseSandbox(chat.id))} className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full bg-fg/8 text-[13px] font-medium hover:bg-fg/12 active:scale-95 disabled:opacity-40"><Moon size={14} />Sleep</button>
          <button title="Delete this VM" disabled={busy} onClick={() => run(() => removeSandbox(chat.id))} className="grid h-8 w-8 place-items-center rounded-full text-faint hover:bg-danger/10 hover:text-danger"><Trash2 size={14} /></button>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-line px-0.5 pt-3">
          <div><div className="text-[13px] font-medium">Sleep after each reply</div><div className="text-xs text-muted">Saves compute between turns</div></div>
          <Toggle on={settings.sandbox.sleepAfterTurn} onChange={(b) => setSettings({ sandbox: { ...settings.sandbox, sleepAfterTurn: b } })} />
        </div>
        <div className="mt-2 flex items-center gap-1.5 px-0.5 text-[11px] text-faint"><Power size={11} />Auto-deletes after {settings.sandbox.ttlHours || '∞'} h</div>
      </div>
    </Popover>
  )
}
