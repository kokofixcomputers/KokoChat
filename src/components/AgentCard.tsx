import { useContext } from 'react'
import { ReadOnlyView } from '../lib/readOnly'
import { useState } from 'react'
import { Bot, Check, CircleAlert, Loader2, PanelRight, ShieldQuestion, Square, Users } from 'lucide-react'
import type { Block, Message } from '../types'
import { useStore } from '../store'
import { Markdown } from './Markdown'
import { ApprovalBar } from './CodeActivity'
import { describeBlock } from '../lib/codeTools'
import { reportOf } from '../lib/agents'
import { openAgentTab } from '../lib/dock'
import { cn } from '../lib/utils'

type Tool = Extract<Block, { type: 'tool' }>

/** The latest thing a sub-agent is doing, in plain words ("Running `npm test`"). */
export function agentActivity(blocks: Block[] | undefined): string {
  const tools = (blocks ?? []).filter((b): b is Tool => b.type === 'tool')
  const t = [...tools].reverse().find((b) => b.status === 'running') ?? tools[tools.length - 1]
  if (!t) return (blocks ?? []).some((b) => b.type === 'text') ? 'Writing its report' : 'Thinking'
  if (t.name === 'web_search') return 'Searching the web'
  if (t.name === 'read_url') return 'Reading a web page'
  if (t.name === 'generate_image') return 'Generating an image'
  const d = describeBlock(t)
  return `${t.status === 'running' ? d.present : d.past}${d.subject ? ' ' + d.subject : ''}`
}

/** An approval a sub-agent is waiting on (so it can be answered from the main chat). */
export function useAgentApproval(chatId?: string) {
  return useStore((s) => {
    const child = s.chats.find((c) => c.id === chatId)
    const last = child?.messages[child.messages.length - 1]
    return (last?.blocks ?? []).find((b): b is Tool => b.type === 'tool' && !!(b.meta as any)?.approval && !!s.approvals[(b.meta as any).approval.id])
  })
}

const STATUS = {
  working: { label: 'Working', cls: 'bg-accent-soft text-accent' },
  done: { label: 'Done', cls: 'bg-fg/6 text-muted' },
  failed: { label: 'Failed', cls: 'bg-danger/10 text-danger' },
  stopped: { label: 'Stopped', cls: 'bg-fg/6 text-muted' },
} as const

export function AgentCard({ block }: { block: Tool }) {
  const readOnly = useContext(ReadOnlyView)
  const meta = (block.meta ?? {}) as { agentId?: string; agentName?: string }
  const id = meta.agentId
  const child = useStore((s) => s.chats.find((c) => c.id === id))
  const running = useStore((s) => !!id && !!s.streaming[id])
  const stop = useStore((s) => s.stop)
  const pending = useAgentApproval(id)
  const [open, setOpen] = useState(false)
  const name = meta.agentName ?? child?.sub?.name ?? 'Sub-agent'
  const rep = child ? reportOf(child) : null
  const status = !child ? null : running ? 'working' : rep!.status === 'working' ? 'working' : rep!.status
  const last = child?.messages[child.messages.length - 1]
  const starting = block.status === 'running' && !id

  return (
    <div className={cn('anim-fade-up w-full max-w-2xl overflow-hidden rounded-2xl border bg-surface', pending ? 'border-accent/50' : 'border-line')}>
      <div className="flex items-center gap-3 px-3.5 py-2.5 text-[13.5px]">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">{pending ? <ShieldQuestion size={15} /> : running || starting ? <Loader2 size={15} className="spin" /> : <Bot size={15} />}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2"><span className="truncate font-medium">{name}</span><span className="shrink-0 text-xs text-faint">Sub-agent</span></span>
          <span className="block truncate text-xs text-muted">{!child ? (starting ? 'Starting…' : readOnly ? 'Ran in the background' : 'No longer available') : pending ? 'Waiting for your approval' : running ? agentActivity(last?.blocks) : rep!.status === 'done' ? 'Finished' : rep!.status === 'failed' ? 'Ran into a problem' : 'Stopped'}</span>
        </span>
        {status && <span className={cn('hidden shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium sm:inline', STATUS[status].cls)}>{STATUS[status].label}</span>}
        {id && child && <button title="Stop this sub-agent" onClick={() => stop(id)} className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted transition hover:bg-danger/10 hover:text-danger', !running && 'hidden')}><Square size={12} fill="currentColor" /></button>}
        {id && child && <button title="Open its transcript in the side panel" onClick={() => openAgentTab(id, name)} className="flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-fg/6 px-2.5 text-xs font-medium transition hover:bg-fg/10"><PanelRight size={13} />Open</button>}
      </div>
      {running && !pending && <div className="imggen-sweep relative h-0.5 overflow-hidden bg-fg/6" />}
      {pending && <ApprovalBar b={pending} meta={(pending.meta ?? {}) as any} who={name} />}
      {!running && rep && rep.status !== 'working' && rep.text && (
        <div className="border-t border-line px-3.5 py-2.5">
          <div className={cn('relative overflow-hidden text-sm', !open && 'max-h-28')}>
            <Markdown text={rep.text} small />
          </div>
          <button onClick={() => setOpen(!open)} className="mt-1 text-xs font-medium text-accent hover:underline">{open ? 'Show less' : 'Show full report'}</button>
        </div>
      )}
    </div>
  )
}

export function AgentWaitRow({ block }: { block: Tool }) {
  const run = block.status === 'running'
  return (
    <div className="anim-fade-up flex w-fit items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-1.5 text-[13px] text-muted">
      {run ? <Loader2 size={13} className="spin text-accent" /> : block.status === 'error' ? <CircleAlert size={13} /> : <Check size={13} className="text-accent" />}
      {run ? <span className="shimmer">Waiting for sub-agents to finish</span> : block.status === 'error' ? 'Stopped waiting' : 'Sub-agents reported back'}
    </div>
  )
}

/** The "user" message that carries finished sub-agents' reports back to the main agent. */
export function ReportsCard({ m }: { m: Message }) {
  const [open, setOpen] = useState(false)
  const body = (m.text ?? '').replace(/^Your sub-agents have finished\. Their reports:\n\n/, '').replace(/\n\nReview what they did[\s\S]*$/, '')
  return (
    <div className="anim-fade-up w-full max-w-2xl overflow-hidden rounded-2xl border border-line bg-surface">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-[13.5px]">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"><Users size={15} /></span>
        <span className="min-w-0 flex-1"><span className="font-medium">{m.reports!.length === 1 ? 'Sub-agent reported back' : `${m.reports!.length} sub-agents reported back`}</span><span className="ml-2 truncate text-xs text-muted">{m.reports!.map((r) => r.name).join(', ')}</span></span>
        <span className="text-xs font-medium text-accent">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && <div className="border-t border-line px-3.5 py-3 text-sm"><Markdown text={body} small /></div>}
    </div>
  )
}
