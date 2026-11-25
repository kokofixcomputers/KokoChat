import { CircleAlert, Check, Info, X } from 'lucide-react'
import { useToasts } from '../lib/toast'
import { cn } from '../lib/utils'

export function Toasts() {
  const { toasts, dismiss } = useToasts()
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[200] flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div key={t.id} className="glass-strong anim-pop pointer-events-auto flex max-w-md items-start gap-2.5 rounded-2xl px-4 py-2.5 text-sm">
          {t.kind === 'error' ? <CircleAlert size={16} className="mt-0.5 shrink-0 text-danger" /> : t.kind === 'success' ? <Check size={16} className="mt-0.5 shrink-0 text-accent" /> : <Info size={16} className="mt-0.5 shrink-0 text-muted" />}
          <span className={cn('break-words', t.kind === 'error' && 'text-danger')}>{t.text}</span>
          {t.action && <button onClick={() => { t.action!.run(); dismiss(t.id) }} className="ml-1 rounded-full bg-accent-soft px-2.5 py-0.5 text-[13px] font-medium text-accent hover:bg-accent hover:text-accent-fg">{t.action.label}</button>}
          <button onClick={() => dismiss(t.id)} className="ml-1 text-faint hover:text-fg"><X size={14} /></button>
        </div>
      ))}
    </div>
  )
}
