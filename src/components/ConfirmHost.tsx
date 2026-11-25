import { useEffect } from 'react'
import { TriangleAlert } from 'lucide-react'
import { askConfirm, useConfirm } from '../lib/confirm'
import { koko } from '../lib/desktop'
import { cn } from '../lib/utils'

/** Renders every confirmation in the app, and the "agents are still running" prompt when the desktop app is asked to close. */
export function ConfirmHost() {
  const req = useConfirm((s) => s.req)
  useEffect(() => {
    const k = koko()
    if (!k?.onCloseRequest) return
    return k.onCloseRequest((n) => {
      askConfirm(`You have ${n} agent${n === 1 ? '' : 's'} still running. Closing will interrupt ${n === 1 ? 'it' : 'them'}.`, { title: 'Close Koko?', confirmLabel: 'Close anyway', cancelLabel: 'Keep working', danger: true })
        .then((ok) => k.closeAnswer(ok))
    })
  }, [])
  useEffect(() => {
    if (!req) return
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); req.resolve(false) } else if (e.key === 'Enter') { e.preventDefault(); req.resolve(true) } }
    window.addEventListener('keydown', on, true)
    return () => window.removeEventListener('keydown', on, true)
  }, [req])
  if (!req) return null
  return (
    <div className="fixed inset-0 z-[400] grid place-items-center bg-black/35 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && req.resolve(false)}>
      <div role="alertdialog" aria-modal="true" className="glass-strong anim-pop w-full max-w-sm rounded-[24px] p-5">
        <div className="flex items-start gap-3">
          <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', req.danger ? 'bg-danger/10 text-danger' : 'bg-accent-soft text-accent')}><TriangleAlert size={18} /></span>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold">{req.title}</div>
            <p className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-muted">{req.message}</p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button autoFocus={!req.danger} onClick={() => req.resolve(false)} className="h-9 rounded-full bg-fg/8 px-4 text-sm font-medium transition hover:bg-fg/12 active:scale-95">{req.cancelLabel}</button>
          <button autoFocus={req.danger} onClick={() => req.resolve(true)} className={cn('h-9 rounded-full px-4 text-sm font-medium transition active:scale-95', req.danger ? 'bg-danger text-white hover:opacity-90' : 'bg-fg text-bg hover:opacity-90')}>{req.confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
