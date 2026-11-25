import { useEffect, useMemo, useRef } from 'react'
import { usePluginUI, type Mount, type ModalReq, type SlotCtx, type SlotName } from '../lib/pluginHost'
import { cn } from '../lib/utils'

interface Inst { el: HTMLElement; ctx: SlotCtx; listeners: Set<(d: any) => void>; cleanup?: void | (() => void) }

/** A place in the app where plugins can add their own elements. It renders nothing when no plugin uses it. */
export function PluginSlot({ name, data, className }: { name: SlotName; data?: any; className?: string }) {
  const all = usePluginUI((s) => s.mounts)
  const mine = useMemo(() => all.filter((m) => m.slot === name), [all, name])
  const host = useRef<HTMLDivElement>(null)
  const insts = useRef(new Map<string, Inst>())
  const latest = useRef(data)
  latest.current = data

  useEffect(() => {
    const h = host.current
    if (!h) return
    const keep = new Set(mine.map((m) => m.id))
    for (const [id, inst] of insts.current) if (!keep.has(id)) { try { inst.cleanup?.() } catch { /* plugin bug */ } inst.el.remove(); insts.current.delete(id) }
    for (const m of mine) {
      if (insts.current.has(m.id)) continue
      const el = document.createElement('div')
      el.className = 'kp-slot-item'
      h.append(el)
      const listeners = new Set<(d: any) => void>()
      const ctx: SlotCtx = { data: latest.current, onUpdate: (cb) => { listeners.add(cb); return () => listeners.delete(cb) } }
      const inst: Inst = { el, ctx, listeners }
      insts.current.set(m.id, inst)
      inst.cleanup = (m as Mount).fn(el, ctx)
    }
  }, [mine])

  // tell plugins when what the place shows has changed (the draft text, a streaming message…)
  useEffect(() => {
    for (const inst of insts.current.values()) {
      inst.ctx.data = data
      for (const cb of inst.listeners) { try { cb(data) } catch (e) { console.error('[plugin] onUpdate', e) } }
    }
  }, [data])

  useEffect(() => () => { for (const inst of insts.current.values()) { try { inst.cleanup?.() } catch { /* plugin bug */ } inst.el.remove() } insts.current.clear() }, [])

  return <div ref={host} className={cn('kp-slot', className, !mine.length && 'hidden')} />
}

function ModalBodyView({ m }: { m: ModalReq }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.replaceChildren()
    let cleanup: void | (() => void)
    try {
      if (typeof m.body === 'string') el.textContent = m.body
      else if (m.body instanceof HTMLElement) el.append(m.body)
      else cleanup = m.body(el)
    } catch (e) { console.error('[plugin] modal body', e); el.textContent = 'This plugin could not show its window.' }
    return () => { try { cleanup?.() } catch { /* ignore */ } }
  }, [m])
  return <div ref={ref} className="kp-modal-body whitespace-pre-wrap text-sm leading-relaxed text-muted" />
}

/** Windows opened by plugins (api.ui.modal / confirm / prompt). */
export function PluginModalHost() {
  const modals = usePluginUI((s) => s.modals)
  const m = modals[0]
  useEffect(() => {
    if (!m) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); m.resolve(m.dismissValue) } }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [m])
  if (!m) return null
  return (
    <div className="fixed inset-0 z-[140] grid place-items-center bg-black/35 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && m.resolve(m.dismissValue)}>
      <div className="glass-strong anim-pop w-full max-w-md rounded-[28px] p-5">
        {m.title && <div className="mb-2 text-lg font-semibold tracking-tight">{m.title}</div>}
        <ModalBodyView m={m} />
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {m.actions.map((a, i) => (
            <button key={i} onClick={() => m.resolve(a.value ?? a.label)} className={cn('h-10 rounded-full px-5 text-sm font-medium transition active:scale-95', a.primary ? (a.danger ? 'bg-danger text-white' : 'bg-fg text-bg hover:opacity-90') : 'bg-fg/8 hover:bg-fg/12', !a.primary && a.danger && 'text-danger')}>{a.label}</button>
          ))}
        </div>
      </div>
    </div>
  )
}
