import { useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Popover } from './ui'
import { cn } from '../lib/utils'

/** A field that opens a menu of choices (and lets you type your own value). */
export function FieldMenu({ label, value, options, def, onChange }: { label: string; value: string; options: string[]; def: string; onChange: (v: string) => void }) {
  const [q, setQ] = useState('')
  const shown = value || def
  const ql = q.trim().toLowerCase()
  const list = options.filter((o) => o.toLowerCase().includes(ql))
  const custom = q.trim() && !options.some((o) => o.toLowerCase() === ql) ? q.trim() : ''
  return (
    <Popover
      side="top"
      panelClassName="w-56"
      button={(open, toggle) => (
        <button type="button" onClick={toggle} className={cn('flex min-w-0 items-center gap-2 rounded-xl bg-surface/80 px-2.5 py-1.5 text-left ring-1 transition', open ? 'ring-accent/50' : 'ring-line hover:ring-fg/20')}>
          <span className="text-xs font-medium capitalize text-muted">{label}</span>
          <span className={cn('min-w-0 truncate text-[13px]', !value && 'text-faint')}>{shown || 'Choose…'}</span>
          <ChevronDown size={13} className={cn('shrink-0 text-faint transition-transform', open && 'rotate-180')} />
        </button>
      )}
    >
      {(close) => (
        <div>
          <input
            autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search or type your own…"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const v = custom || list[0]; if (v) { onChange(v); setQ(''); close() } } }}
            className="mb-1 h-9 w-full rounded-full bg-fg/5 px-3.5 text-sm placeholder:text-faint"
          />
          <div className="max-h-56 overflow-y-auto">
            {list.map((o) => (
              <button key={o} onClick={() => { onChange(o); setQ(''); close() }} className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-sm transition hover:bg-fg/5">
                <span className="flex-1 truncate">{o}</span>{shown === o && <Check size={14} className="text-accent" />}
              </button>
            ))}
            {custom && <button onClick={() => { onChange(custom); setQ(''); close() }} className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-sm text-accent transition hover:bg-fg/5">Use “{custom}”</button>}
            {!list.length && !custom && <p className="px-3 py-4 text-center text-xs text-muted">No matches.</p>}
          </div>
        </div>
      )}
    </Popover>
  )
}
