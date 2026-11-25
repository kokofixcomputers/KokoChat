import { useState } from 'react'
import { Check, ChevronDown, Plus, Search } from 'lucide-react'
import { Popover } from './ui'
import { ModelIcon } from './ModelIcon'
import { cn } from '../lib/utils'

/** Searchable model menu in the same style as the chat's model picker. Any value can be typed, not just the listed ones. */
export function ModelSelect({ value, onChange, options, preset = 'openai', provider = '', icons = true, placeholder = 'Choose…', className }: {
  value: string
  onChange: (v: string) => void
  options: string[]
  preset?: string
  provider?: string
  /** show the model's logo (off for things like voice names) */
  icons?: boolean
  placeholder?: string
  className?: string
}) {
  const [q, setQ] = useState('')
  const all = [...new Set([...(value ? [value] : []), ...options])]
  const ql = q.trim().toLowerCase()
  const list = all.filter((m) => m.toLowerCase().includes(ql))
  const custom = q.trim() && !all.some((m) => m.toLowerCase() === ql) ? q.trim() : ''
  const icon = (m: string, size: number) => (icons ? <ModelIcon model={m} preset={preset} name={provider} size={size} /> : null)

  return (
    <Popover
      side="bottom"
      align="right"
      panelClassName="w-80 max-w-[90vw]"
      className="w-full"
      button={(open, toggle) => (
        <button type="button" onClick={() => { setQ(''); toggle() }} className={cn('flex h-10 w-full items-center gap-2.5 rounded-xl border border-line bg-surface-2/60 px-3 text-left text-sm transition hover:bg-surface-2', open && 'border-accent/60 bg-surface', className)}>
          {value && icon(value, 20)}
          <span className={cn('min-w-0 flex-1 truncate font-mono', !value && 'font-sans text-faint')}>{value || placeholder}</span>
          <ChevronDown size={15} className={cn('shrink-0 text-muted transition-transform', open && 'rotate-180')} />
        </button>
      )}
    >
      {(close) => {
        const pick = (m: string) => { onChange(m); close() }
        return (
          <div>
            <div className="relative p-1">
              <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-faint" />
              <input
                autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search or type a name"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const m = custom || list[0]; if (m) pick(m) } }}
                className="h-9 w-full rounded-full bg-fg/5 pl-9 pr-3 text-sm placeholder:text-faint"
              />
            </div>
            <div className="max-h-72 overflow-y-auto">
              {custom && (
                <button type="button" onClick={() => pick(custom)} className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm text-accent transition hover:bg-fg/5">
                  <Plus size={15} className="shrink-0" /><span className="min-w-0 flex-1 truncate">Use “{custom}”</span>
                </button>
              )}
              {list.map((m) => (
                <button key={m} type="button" onClick={() => pick(m)} className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-sm transition hover:bg-fg/5">
                  {icon(m, 22)}<span className="min-w-0 flex-1 truncate">{m}</span>{m === value && <Check size={15} className="shrink-0 text-accent" />}
                </button>
              ))}
              {!list.length && !custom && <p className="px-3 py-4 text-center text-xs text-faint">Nothing matches</p>}
            </div>
          </div>
        )
      }}
    </Popover>
  )
}
