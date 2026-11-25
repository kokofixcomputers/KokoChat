import { useState } from 'react'
import { Check, ChevronDown, ListChecks, X } from 'lucide-react'
import type { Block, Todo } from '../types'
import { useStore } from '../store'
import { cn } from '../lib/utils'

type Tool = Extract<Block, { type: 'tool' }>

function Mark({ s }: { s: Todo['status'] }) {
  if (s === 'completed') return <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-accent text-accent-fg"><Check size={11} strokeWidth={3.2} /></span>
  if (s === 'in_progress') return <span className="relative grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-2 border-accent"><span className="h-2 w-2 animate-pulse rounded-full bg-accent" /></span>
  return <span className="block h-[18px] w-[18px] shrink-0 rounded-full border-2 border-faint/50" />
}

function Ring({ done, total, size = 22 }: { done: number; total: number; size?: number }) {
  const r = (size - 4) / 2, c = 2 * Math.PI * r
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={3} className="stroke-fg/10" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={3} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - (total ? done / total : 0))} className="stroke-accent transition-all duration-500" />
    </svg>
  )
}

const Row = ({ t, onToggle }: { t: Todo; onToggle?: () => void }) => (
  <div className={cn('flex items-start gap-2.5 rounded-lg px-1.5 py-1 text-[13.5px] leading-snug', onToggle && 'cursor-pointer hover:bg-fg/4')} onClick={onToggle}>
    <span className="mt-px block"><Mark s={t.status} /></span>
    <span className={cn('min-w-0 flex-1', t.status === 'completed' && 'text-faint line-through decoration-faint/50', t.status === 'in_progress' && 'font-medium')}>{t.content}</span>
  </div>
)

/** The list as the AI wrote it at that moment, shown in the reply. */
export function TodoCard({ block }: { block: Tool }) {
  const m = (block.meta ?? {}) as { todos?: Todo[]; done?: number; total?: number }
  if (block.status === 'running' && !m.todos) return <span className="shimmer w-fit text-xs font-medium text-muted">Planning the steps…</span>
  if (!m.todos || block.status === 'error') return null
  const done = m.done ?? 0, total = m.total ?? m.todos.length
  return (
    <div className="anim-fade-up w-full max-w-2xl overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 text-[13.5px]">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"><ListChecks size={15} /></span>
        <span className="flex-1 font-medium">{done === total ? 'All tasks done' : 'Task list'}</span>
        <span className="text-xs tabular-nums text-muted">{done} of {total}</span>
      </div>
      <div className="h-0.5 bg-fg/6"><div className="h-full bg-accent transition-all" style={{ width: `${(done / Math.max(1, total)) * 100}%` }} /></div>
      <div className="flex flex-col gap-0.5 px-2 py-2">{m.todos.map((t) => <Row key={t.id} t={t} />)}</div>
    </div>
  )
}

/** The current list, pinned above the message box. Click a step to check or uncheck it yourself. */
export function TodoPanel({ chatId }: { chatId: string }) {
  const todos = useStore((s) => s.chats.find((c) => c.id === chatId)?.todos)
  const { toggleTodo, setTodos } = useStore()
  const [open, setOpen] = useState(true)
  if (!todos?.length) return null
  const done = todos.filter((t) => t.status === 'completed').length, total = todos.length
  const cur = todos.find((t) => t.status === 'in_progress')
  const idx = cur ? todos.indexOf(cur) + 1 : 0
  const next = todos.find((t) => t.status === 'pending')
  const label = done === total ? `All ${total} tasks done` : cur ? `Task ${idx} of ${total}: ${cur.content}` : next ? `Next: ${next.content}` : `${done} of ${total} done`
  return (
    <div className="anim-pop mx-1 mb-2 overflow-hidden rounded-2xl bg-surface-2/60 ring-1 ring-line">
      <div className="flex items-center gap-2.5 px-3 py-2">
        <button onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <Ring done={done} total={total} />
          <span className={cn('min-w-0 flex-1 truncate text-[13px]', done === total ? 'font-medium text-accent' : 'font-medium')}>{label}</span>
          <span className="shrink-0 text-xs tabular-nums text-muted">{done}/{total}</span>
          <ChevronDown size={14} className={cn('shrink-0 text-faint transition-transform', open && 'rotate-180')} />
        </button>
        <button title="Clear the list" onClick={() => setTodos(chatId, [])} className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-faint transition hover:bg-fg/8 hover:text-fg"><X size={13} /></button>
      </div>
      {open && <div className="max-h-48 overflow-y-auto border-t border-line px-2 py-1.5">{todos.map((t) => <Row key={t.id} t={t} onToggle={() => toggleTodo(chatId, t.id)} />)}</div>}
    </div>
  )
}
