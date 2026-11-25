import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '../lib/utils'

export function Popover({
  button, children, side = 'top', align = 'left', className, panelClassName, defaultOpen,
}: {
  defaultOpen?: boolean
  button: (open: boolean, toggle: () => void) => ReactNode
  children: ReactNode | ((close: () => void) => ReactNode)
  side?: 'top' | 'bottom'
  align?: 'left' | 'right' | 'center'
  className?: string
  panelClassName?: string
}) {
  const [open, setOpen] = useState(!!defaultOpen)
  const [eff, setEff] = useState(side)
  const ref = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  // open on whichever side has room (a menu near the top of the page must not run off the screen)
  useLayoutEffect(() => {
    const el = panel.current, anchor = ref.current
    if (!open || !el || !anchor) { setEff(side); return }
    const place = () => {
      el.style.maxHeight = ''
      const a = anchor.getBoundingClientRect()
      const h = el.scrollHeight
      const above = a.top - 12, below = window.innerHeight - a.bottom - 12
      let s = side
      if (side === 'top' && h > above && below > above) s = 'bottom'
      else if (side === 'bottom' && h > below && above > below) s = 'top'
      el.style.maxHeight = `${Math.max(160, s === 'top' ? above : below)}px`
      el.style.overflowY = 'auto'
      setEff(s)
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, side])
  // nudge the panel back on screen (phones are narrower than most popovers' anchors allow)
  useLayoutEffect(() => {
    const el = panel.current
    if (!open || !el) return
    const clamp = () => {
      el.style.translate = ''
      const r = el.getBoundingClientRect()
      const vw = document.documentElement.clientWidth // layout width (innerWidth can be inflated by overflowing content)
      let dx = 0
      if (r.right > vw - 8) dx = vw - 8 - r.right
      if (r.left + dx < 8) dx = 8 - r.left
      if (dx) el.style.translate = `${Math.round(dx)}px 0`
    }
    clamp()
    const ro = new ResizeObserver(clamp) // the panel's width settles after first paint
    ro.observe(el)
    window.addEventListener('resize', clamp)
    return () => { ro.disconnect(); window.removeEventListener('resize', clamp) }
  }, [open])
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [open])
  return (
    <div ref={ref} className={cn('relative', className)}>
      {button(open, () => setOpen((o) => !o))}
      {open && (
        <div
          ref={panel}
          className={cn(
            'glass-strong anim-pop absolute z-50 rounded-2xl p-1.5 min-w-52 max-w-[calc(100vw-16px)]',
            eff === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
            align === 'left' ? 'left-0' : align === 'right' ? 'right-0' : 'left-1/2 -translate-x-1/2',
            panelClassName,
          )}
        >
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  )
}

export function Toggle({ on, onChange }: { on: boolean; onChange: (b: boolean) => void }) {
  return (
    <button
      role="switch" aria-checked={on} onClick={() => onChange(!on)}
      className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors', on ? 'bg-accent' : 'bg-faint/40')}
    >
      <span className={cn('absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform', on && 'translate-x-4')} />
    </button>
  )
}

export function IconButton({ className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...p}
      className={cn('grid h-9 w-9 place-items-center rounded-full text-muted transition hover:bg-fg/5 hover:text-fg active:scale-95 disabled:opacity-40', className)}
    />
  )
}

export function Segmented<T extends string>({ value, options, onChange, compact }: { value: T; options: { value: T; label: string; icon?: ReactNode }[]; onChange: (v: T) => void; /** hide labels that have an icon on phones */ compact?: boolean }) {
  return (
    <div className="inline-flex rounded-full bg-fg/5 p-1">
      {options.map((o) => (
        <button
          key={o.value} onClick={() => onChange(o.value)}
          className={cn('flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium transition', value === o.value ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg')}
        >
          {o.icon}<span className={cn(compact && o.icon && 'max-sm:hidden')}>{o.label}</span>
        </button>
      ))}
    </div>
  )
}

export function Favicon({ domain, size = 16, className }: { domain: string; size?: number; className?: string }) {
  const [bad, setBad] = useState(false)
  return bad ? (
    <span style={{ width: size, height: size }} className={cn('grid place-items-center rounded-full bg-surface-2 text-[9px] font-semibold uppercase text-muted', className)}>{domain[0]}</span>
  ) : (
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`}
      width={size} height={size} alt="" loading="lazy" onError={() => setBad(true)}
      className={cn('rounded-full bg-white object-cover', className)}
      style={{ width: size, height: size }}
    />
  )
}
