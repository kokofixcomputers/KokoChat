import { useMemo, useState } from 'react'
import { askConfirm } from '../lib/confirm'
import { Brain, Plus, Search, Trash2, Undo2 } from 'lucide-react'
import type { Block, Memory } from '../types'
import { useStore } from '../store'
import { Toggle } from './ui'
import { baseName } from '../lib/desktop'
import { uid } from '../lib/utils'
import type { MemoryMeta } from '../lib/memory'
import { cn } from '../lib/utils'

type Tool = Extract<Block, { type: 'tool' }>

/** A quiet line in the reply when the AI saved, updated or forgot something, with an undo. */
export function MemoryPill({ block }: { block: Tool }) {
  const m = (block.meta as MemoryMeta | undefined)?.memory
  const { addMemory, updateMemory, deleteMemory, openSettings } = useStore()
  const [undone, setUndone] = useState(false)
  if (block.status === 'running' || !m) return block.status === 'running' ? <span className="shimmer w-fit text-xs font-medium text-muted">Updating memory…</span> : null
  if (block.status === 'error') return null
  if (m.action === 'found') return <span className="flex w-fit items-center gap-1.5 text-xs text-faint"><Brain size={13} />Looked through memory{m.count ? ` (${m.count} found)` : ''}</span>
  const label = m.action === 'saved' ? 'Saved to memory' : m.action === 'updated' ? 'Updated memory' : 'Forgot'
  const undo = () => {
    if (m.action === 'saved' && m.id) deleteMemory(m.id)
    else if (m.action === 'updated' && m.before) updateMemory(m.before.id, { text: m.before.text, source: m.before.source })
    else if (m.action === 'forgot' && m.before) addMemory(m.before)
    setUndone(true)
  }
  return (
    <div className={cn('anim-fade-up flex w-fit max-w-full items-center gap-2 rounded-full border border-line bg-surface/70 py-1 pl-2.5 pr-1.5 text-xs text-muted', undone && 'opacity-60')}>
      <Brain size={13} className="shrink-0 text-accent" />
      <button onClick={() => openSettings('memory')} title="Open memory" className="flex min-w-0 items-center gap-1.5 text-left hover:text-fg">
        <span className="shrink-0 font-medium">{undone ? 'Undone' : label}</span>
        {m.text && <span className={cn('min-w-0 truncate text-faint', undone && 'line-through')}>{m.text}</span>}
      </button>
      {!undone && <button onClick={undo} title="Undo" className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-faint transition hover:bg-fg/8 hover:text-fg"><Undo2 size={12} /></button>}
    </div>
  )
}

const field = 'h-10 w-full rounded-xl border border-line bg-surface-2/60 px-3.5 text-sm transition placeholder:text-faint focus:border-accent/60 focus:bg-surface'

function Row({ m }: { m: Memory }) {
  const { updateMemory, deleteMemory } = useStore()
  const [edit, setEdit] = useState(false)
  const [v, setV] = useState(m.text)
  const save = () => { const t = v.trim(); if (t && t !== m.text) updateMemory(m.id, { text: t, source: 'user' }); else setV(m.text); setEdit(false) }
  return (
    <div className="group flex items-start gap-3 rounded-xl px-3 py-2.5 transition hover:bg-fg/4">
      <div className="min-w-0 flex-1">
        {edit ? (
          <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setV(m.text); setEdit(false) } }} className={cn(field, 'h-9')} />
        ) : (
          <button onClick={() => setEdit(true)} className="block w-full text-left text-sm leading-snug" title="Click to edit">{m.text}</button>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-faint">
          <span>{m.source === 'ai' ? 'Saved by the AI' : 'Added by you'}</span><span>·</span><span>{new Date(m.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
          {m.cwd && <span className="rounded-md bg-fg/6 px-1.5 py-px text-muted">project: {baseName(m.cwd)}</span>}
        </div>
      </div>
      <button title="Delete" onClick={() => deleteMemory(m.id)} className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-faint opacity-0 transition hover:bg-danger/10 hover:text-danger group-hover:opacity-100 max-sm:opacity-100"><Trash2 size={14} /></button>
    </div>
  )
}

export function MemorySettings() {
  const { settings, setSettings, memories, addMemory, clearMemories } = useStore()
  const [q, setQ] = useState('')
  const [draft, setDraft] = useState('')
  const m = settings.memory
  const list = useMemo(() => [...memories].sort((a, b) => b.updatedAt - a.updatedAt).filter((x) => !q.trim() || x.text.toLowerCase().includes(q.toLowerCase())), [memories, q])
  const add = () => { const t = draft.trim(); if (!t) return; addMemory({ id: uid(), text: t.slice(0, 300), createdAt: Date.now(), updatedAt: Date.now(), source: 'user' }); setDraft('') }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">Memory lets the AI remember things about you across chats: your preferences, projects and how you like answers. It is added to every conversation automatically, and the AI saves new things by itself as you talk. Memories sync with your other devices.</p>
      <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface/50 p-4">
        <div className="flex items-center gap-3"><div className="flex-1"><div className="text-sm font-medium">Use memory</div><div className="text-xs text-muted">Give the AI what it has remembered in every chat.</div></div><Toggle on={m.enabled} onChange={(b) => setSettings({ memory: { ...m, enabled: b } })} /></div>
        {m.enabled && <div className="flex items-center gap-3"><div className="flex-1"><div className="text-sm font-medium">Save automatically</div><div className="text-xs text-muted">The AI adds and updates memories on its own. You will see a small note under the reply, with an undo.</div></div><Toggle on={m.auto} onChange={(b) => setSettings({ memory: { ...m, auto: b } })} /></div>}
      </section>
      <div className="flex gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Add something to remember, for example: I prefer short answers" className={field} />
        <button onClick={add} disabled={!draft.trim()} className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-fg px-4 text-sm font-medium text-bg transition active:scale-95 disabled:opacity-40"><Plus size={14} />Add</button>
      </div>
      {memories.length > 6 && <div className="relative"><Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search memories" className={cn(field, 'pl-9')} /></div>}
      <div className="flex flex-col rounded-2xl border border-line bg-surface/50 p-1.5">
        {list.length ? list.map((x) => <Row key={x.id} m={x} />) : <p className="px-3 py-8 text-center text-sm text-faint">{memories.length ? 'No memories match.' : 'Nothing remembered yet. Tell the AI about yourself, or add something above.'}</p>}
      </div>
      {memories.length > 0 && <div className="flex items-center justify-between text-xs text-faint"><span>{memories.length} {memories.length === 1 ? 'memory' : 'memories'}</span><button onClick={async () => { if (await askConfirm(`Delete all ${memories.length} memories? This also removes them from your synced devices.`)) clearMemories() }} className="font-medium text-danger/80 hover:text-danger">Clear all</button></div>}
    </div>
  )
}
