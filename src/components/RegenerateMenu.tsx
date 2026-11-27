import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Columns2, RefreshCw, Search, Trash2 } from 'lucide-react'
import { useStore } from '../store'
import { ModelBadges } from './ModelBadges'
import type { Message } from '../types'
import { Popover } from './ui'
import { ModelIcon } from './ModelIcon'
import { cn } from '../lib/utils'
import { setCompare } from '../lib/compare'

/** Regenerate button with a menu: same model, another model, or compare models. */
export function RegenerateMenu({ chatId, m }: { chatId: string; m: Message; prompt?: string }) {
  const { providers, regenerate } = useStore()
  const [q, setQ] = useState('')
  const list = useMemo(
    () => providers.flatMap((p) => p.models.map((x) => ({ p, id: x.id }))).filter((x) => x.id.toLowerCase().includes(q.toLowerCase())).slice(0, 40),
    [providers, q],
  )
  return (
    <Popover
      side="top" align="left" panelClassName="w-72 max-w-[92vw]"
      button={(open, toggle) => (
        <button onClick={toggle} title="Regenerate" className={cn('grid h-7 w-7 place-items-center rounded-full text-muted transition hover:bg-fg/5 hover:text-fg', open && 'bg-fg/5 text-fg')}><RefreshCw size={14} /></button>
      )}
    >
      {(close) => (
        <div>
          <button onClick={() => { close(); void regenerate(chatId, m.id) }} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition hover:bg-fg/5">
            <RefreshCw size={15} className="text-accent" />Regenerate{m.model ? <span className="truncate text-xs text-muted">· {m.model}</span> : null}
          </button>
          <button onClick={() => { close(); setCompare(true) }} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition hover:bg-fg/5">
            <Columns2 size={15} className="text-accent" />Compare models (answer every message)
          </button>
          <div className="mx-1 my-1 border-t border-line" />
          <div className="px-2.5 pb-1 pt-1 text-xs font-medium text-muted">Try another model</div>
          <div className="relative px-1 pb-1">
            <Search size={13} className="absolute left-3.5 top-1/2 -translate-y-[60%] text-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search models" className="h-8 w-full rounded-full bg-fg/5 pl-8 pr-3 text-[13px] placeholder:text-faint" />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {list.map(({ p, id }) => (
              <button key={p.id + id} onClick={() => { close(); void regenerate(chatId, m.id, { providerId: p.id, model: id }) }} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-sm transition hover:bg-fg/5">
                <ModelIcon model={id} preset={p.preset} name={p.name} size={20} /><span className="min-w-0 flex-1 truncate">{id}</span><ModelBadges provider={p} id={id} compact />
              </button>
            ))}
            {!list.length && <p className="px-3 py-4 text-center text-xs text-faint">No models</p>}
          </div>
        </div>
      )}
    </Popover>
  )
}

/** ‹ 2/3 › switcher between the versions of a reply. */
export function VersionSwitcher({ chatId, m }: { chatId: string; m: Message }) {
  const { switchVersion, removeVersion } = useStore()
  const alts = m.alts ?? []
  if (!alts.length) return null
  const all = [...alts.map((a, i) => ({ t: a.createdAt, alt: i as number | null })), { t: m.createdAt, alt: null as number | null }].sort((a, b) => a.t - b.t)
  const pos = all.findIndex((x) => x.alt === null)
  const go = (d: number) => { const target = all[pos + d]; if (target?.alt != null) switchVersion(chatId, m.id, target.alt) }
  return (
    <span className="mr-1 flex items-center rounded-full bg-fg/5 px-0.5">
      <button disabled={pos === 0} onClick={() => go(-1)} title="Previous version" className="grid h-7 w-6 place-items-center rounded-full text-muted transition hover:text-fg disabled:opacity-30"><ChevronLeft size={14} /></button>
      <span className="min-w-8 text-center text-xs tabular-nums text-muted">{pos + 1}/{all.length}</span>
      <button disabled={pos === all.length - 1} onClick={() => go(1)} title="Next version" className="grid h-7 w-6 place-items-center rounded-full text-muted transition hover:text-fg disabled:opacity-30"><ChevronRight size={14} /></button>
      <button onClick={() => removeVersion(chatId, m.id)} title="Delete this version" className="grid h-7 w-6 place-items-center rounded-full text-faint transition hover:text-danger"><Trash2 size={12} /></button>
    </span>
  )
}
