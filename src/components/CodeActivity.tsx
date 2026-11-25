import { useEffect, useState, type ReactNode } from 'react'
import { askConfirm } from '../lib/confirm'
import { ListChecks, ShieldCheck, ShieldAlert, Play, Undo2, Camera, Globe, Ban, Check, ChevronRight, CircleAlert, FilePen, FilePlus2, FileSearch, FileText, FolderTree, Loader2, Search, ShieldQuestion, Terminal } from 'lucide-react'
import type { Block } from '../types'
import { useStore } from '../store'
import { cn } from '../lib/utils'
import { describeBlock, type CodeDescribe } from '../lib/codeTools'
import { decide } from '../lib/permissions'
import { looseArgs } from '../lib/integrations'
import { koko } from '../lib/desktop'
import { toast } from '../lib/toast'
import type { DiffLine } from '../lib/desktop'

type Tool = Extract<Block, { type: 'tool' }>
interface Meta { auto?: { decision: 'allow' | 'ask' | 'deny'; risk: string; reason: string; by: string }; thumb?: string; url?: string; title?: string; label?: string; path?: string; command?: string; description?: string; output?: string; exit?: number | string | null; summary?: string; created?: boolean; diff?: { added: number; removed: number; lines: DiffLine[]; truncated: boolean }; approval?: { id: string; kind: 'edit' | 'command' | 'outside' | 'tool'; title: string; detail?: string; risky?: string; rule?: string; state: 'pending' | 'allowed' | 'denied' } }

const ICON: Record<CodeDescribe['icon'], typeof FileText> = { read: FileText, edit: FilePen, create: FilePlus2, list: FolderTree, find: FileSearch, search: Search, run: Terminal, web: Globe, shot: Camera, action: Play, todo: ListChecks }

/* ------------------------------------ diff ------------------------------------ */
export function DiffView({ lines, truncated, className }: { lines: DiffLine[]; truncated?: boolean; className?: string }) {
  return (
    <div className={cn('max-h-72 overflow-auto rounded-xl border border-line bg-surface-2/40 py-1 font-mono text-[12px] leading-[1.6]', className)}>
      {lines.map((l, i) => (
        <div key={i} className={cn('flex min-w-max px-2', l.t === '+' && 'bg-accent-soft', l.t === '-' && 'bg-danger/10', l.n === 0 && 'bg-fg/4 text-faint')}>
          <span className="w-9 shrink-0 select-none pr-2 text-right text-faint">{l.n || ''}</span>
          <span className={cn('w-4 shrink-0 select-none', l.t === '+' ? 'text-accent' : l.t === '-' ? 'text-danger' : 'text-faint')}>{l.t === ' ' ? '' : l.t}</span>
          <span className={cn('whitespace-pre pr-3', l.t === ' ' && 'text-muted')}>{l.s || ' '}</span>
        </div>
      ))}
      {truncated && <div className="px-3 py-1 text-faint">…more changes not shown</div>}
    </div>
  )
}

/** A preview of what is about to change, built from the tool arguments (shown while the user decides). */
function proposedLines(name: string, a: Record<string, any>): DiffLine[] | null {
  if (name === 'edit_file' && typeof a.old_string === 'string') {
    const out: DiffLine[] = []
    String(a.old_string).split('\n').forEach((s) => out.push({ t: '-', n: 0, s }))
    String(a.new_string ?? '').split('\n').forEach((s) => out.push({ t: '+', n: 0, s }))
    return out.slice(0, 120).map((l, i) => ({ ...l, n: i + 1 }))
  }
  if (name === 'write_file' && typeof a.content === 'string') return String(a.content).split('\n').slice(0, 60).map((s, i) => ({ t: '+' as const, n: i + 1, s }))
  return null
}

/* --------------------------------- approvals --------------------------------- */
const btn = 'h-8 rounded-full px-3.5 text-[13px] font-medium transition active:scale-95'

export function ApprovalBar({ b, meta, who }: { b: Tool; meta: Meta; who?: string }) {
  const a = meta.approval!
  const args = looseArgs(b.args)
  const prev = a.kind === 'edit' ? proposedLines(b.name, args) : null
  return (
    <div className="flex flex-col gap-2.5 border-t border-line bg-accent-soft/40 px-3.5 py-3">
      <div className="flex items-start gap-2 text-[13.5px] font-medium"><ShieldQuestion size={16} className="mt-0.5 shrink-0 text-accent" /><span>{who ? `${who} wants to: ` : ''}{a.kind === 'command' ? 'Allow this command?' : a.kind === 'edit' ? `Allow this change?` : 'Allow this?'}</span></div>
      {a.risky && <div className="flex items-start gap-2 rounded-xl bg-danger/10 px-3 py-2 text-[13px] text-danger"><CircleAlert size={15} className="mt-0.5 shrink-0" />{a.risky}</div>}
      {a.kind === 'command' && a.detail && <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-line bg-surface px-3 py-2 font-mono text-[12.5px]">{a.detail}</pre>}
      {a.kind !== 'command' && a.detail && <div className="break-all rounded-xl border border-line bg-surface px-3 py-2 font-mono text-[12.5px]">{a.detail}</div>}
      {prev && <DiffView lines={prev} />}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => decide(a.id, 'once')} className={cn(btn, 'bg-fg text-bg')}>{a.kind === 'command' ? 'Run' : 'Allow'}</button>
        {a.kind === 'command' && a.rule && !a.risky && <button onClick={() => decide(a.id, 'always')} className={cn(btn, 'bg-fg/8 hover:bg-fg/12')}>Always allow <code className="font-mono text-[12px]">{a.rule}</code></button>}
        {a.kind === 'edit' && <button onClick={() => decide(a.id, 'session')} className={cn(btn, 'bg-fg/8 hover:bg-fg/12')}>Allow all edits this session</button>}
        <button onClick={() => decide(a.id, 'deny')} className={cn(btn, 'text-muted hover:bg-danger/10 hover:text-danger')}>Deny</button>
      </div>
    </div>
  )
}

/* ------------------------------------- rows ------------------------------------- */
function Status({ s, waiting, denied }: { s: Tool['status']; waiting: boolean; denied: boolean }) {
  if (waiting) return <ShieldQuestion size={15} className="shrink-0 text-accent" />
  if (denied) return <Ban size={14} className="shrink-0 text-muted" />
  if (s === 'running') return <Loader2 size={14} className="spin shrink-0 text-accent" />
  if (s === 'error') return <CircleAlert size={14} className="shrink-0 text-danger" />
  return <Check size={14} strokeWidth={3} className="shrink-0 text-accent" />
}

const reason = (r?: string) => (r ?? '').replace(/^Error:\s*/, '').split('\n')[0].slice(0, 160)

function Row({ b }: { b: Tool }) {
  const meta = (b.meta ?? {}) as Meta
  const d = describeBlock(b)
  const a = meta.approval
  const live = useStore((s) => !!(a && s.approvals[a.id]))
  const waiting = !!a && a.state === 'pending' && live
  const blocked = meta.auto?.decision === 'deny'
  const reviewing = b.phase === 'reviewing'
  const denied = a?.state === 'denied' || blocked || (a?.state === 'pending' && !live && b.status === 'error')
  const running = b.status === 'running'
  const diff = meta.diff
  const isRun = d.icon === 'run'
  const body: ReactNode =
    isRun ? (
      meta.command || meta.output ? (
        <div className="overflow-hidden rounded-xl border border-line bg-surface-2/40 font-mono text-[12px] leading-[1.6]">
          <div className="whitespace-pre-wrap break-all border-b border-line px-3 py-1.5 text-muted"><span className="select-none text-faint">$ </span>{meta.command}</div>
          {meta.output ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words px-3 py-2">{meta.output.replace(/\u001b\[[0-9;]*m/g, '')}</pre> : <div className="px-3 py-2 text-faint">{running ? 'Waiting for output…' : '(no output)'}</div>}
        </div>
      ) : null
    ) : d.icon === 'shot' && meta.thumb ? <img src={meta.thumb} alt={meta.title ?? 'Screenshot'} className="max-h-72 rounded-xl border border-line object-contain" />
    : diff?.lines.length ? <DiffView lines={diff.lines} truncated={diff.truncated} />
    : (d.icon === 'search' || d.icon === 'list' || d.icon === 'find') && b.result && !running ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-line bg-surface-2/40 px-3 py-2 font-mono text-[12px] leading-[1.6]">{b.result.slice(0, 6000)}</pre>
    : null
  const expandable = !!body || waiting
  const [open, setOpen] = useState<boolean | null>(null)
  const isOpen = open ?? (waiting || (isRun && running) || (d.icon === 'shot' && !!meta.thumb))
  const Icon = ICON[d.icon]
  const failed = b.status === 'error' && !denied

  return (
    <div className={cn('overflow-hidden rounded-xl', waiting && 'ring-1 ring-accent/40')}>
      <button onClick={() => expandable && setOpen(!isOpen)} className={cn('flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13.5px]', expandable ? 'hover:bg-fg/4' : 'cursor-default')}>
        <Status s={b.status} waiting={waiting} denied={denied} />
        <Icon size={15} className="shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate">
          <span className={cn(running && !waiting && 'shimmer', denied && 'text-muted line-through decoration-faint/60')}>{blocked ? `Blocked: ${d.present.toLowerCase()}` : denied ? `Denied: ${d.present.toLowerCase()}` : reviewing ? 'Checking it is safe: ' + d.present.toLowerCase() : waiting ? 'Waiting for approval: ' + d.present.toLowerCase() : failed ? d.failed : running ? d.present : d.past}</span>
          {d.subject && <> <code className={cn('rounded-md bg-fg/6 px-1.5 py-0.5 font-mono text-[12.5px]', d.code && 'max-w-[26rem] align-bottom')}>{d.subject}</code></>}
          {d.extra && <span className="ml-1.5 text-xs text-faint">{d.extra}</span>}
          {failed && b.result && !isRun && <span className="ml-1.5 text-xs text-danger">{reason(b.result)}</span>}
        </span>
        {meta.auto?.decision === 'allow' && meta.auto.by === 'model' && <span title={`Auto mode reviewed this (${meta.auto.risk} risk): ${meta.auto.reason}`} className="shrink-0 text-accent/70"><ShieldCheck size={14} /></span>}
        {diff && b.status === 'done' && <span className="shrink-0 font-mono text-xs tabular-nums"><span className="text-accent">+{diff.added}</span> <span className="text-danger">−{diff.removed}</span></span>}
        {!diff && b.status === 'done' && meta.summary && <span className="hidden shrink-0 text-xs text-faint sm:inline">{meta.summary}</span>}
        {isRun && b.status !== 'running' && meta.exit !== undefined && meta.exit !== 0 && !denied && <span className="shrink-0 rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-medium text-danger">{meta.exit === 'timeout' ? 'timed out' : `exit ${meta.exit}`}</span>}
        {expandable && <ChevronRight size={14} className={cn('shrink-0 text-faint transition-transform', isOpen && 'rotate-90')} />}
      </button>
      {blocked && meta.auto && <div className="mx-2.5 mb-2 flex items-start gap-2 rounded-xl bg-danger/8 px-3 py-2 text-[12.5px] leading-snug text-danger"><ShieldAlert size={14} className="mt-0.5 shrink-0" /><span>{meta.auto.reason}</span></div>}
      {isOpen && body && !waiting && <div className="px-2.5 pb-2.5">{body}</div>}
      {waiting && a && <ApprovalBar b={b} meta={meta} />}
    </div>
  )
}

/* ------------------------------------- group ------------------------------------- */
function summarize(rows: Tool[]) {
  const files = new Set<string>()
  let ran = 0, explored = 0, browsed = 0, blocked = 0
  for (const b of rows) {
    const m = (b.meta ?? {}) as Meta
    const ic = describeBlock(b).icon
    if (m.auto?.decision === 'deny') blocked++
    if (b.status === 'error') continue
    if (ic === 'edit' || ic === 'create') files.add(m.path ?? looseArgs(b.args).path ?? '')
    else if (ic === 'run') ran++
    else if (ic === 'web' || ic === 'shot') browsed++
    else explored++
  }
  const parts: string[] = []
  if (files.size) parts.push(`Changed ${files.size} file${files.size === 1 ? '' : 's'}`)
  if (ran) parts.push(`ran ${ran} command${ran === 1 ? '' : 's'}`)
  if (browsed) parts.push(`${files.size || ran ? 'used' : 'Used'} the browser (${browsed} step${browsed === 1 ? '' : 's'})`)
  if (explored) parts.push(`${files.size || ran ? 'looked at' : 'Looked at'} ${explored} thing${explored === 1 ? '' : 's'}`)
  if (blocked) parts.push(`${blocked} blocked by Auto mode`)
  return parts.join(' · ') || 'Worked in the project'
}

export function CodeActivity({ blocks, live, turn }: { blocks: Block[]; live: boolean; turn?: string }) {
  const rows = blocks.filter((b): b is Tool => b.type === 'tool')
  const cwd = useStore((s) => s.chats.find((c) => c.id === turn?.split(':')[0])?.cwd)
  const [cp, setCp] = useState<{ count: number; reverted: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const refresh = () => { if (turn) void koko()?.checkpoint.info({ key: turn, cwd }).then((r) => { if (r.ok) setCp({ count: r.data.count, reverted: r.data.reverted }) }) }
  useEffect(() => { if (!live) refresh() }, [live, rows.length, turn]) // eslint-disable-line
  const undo = async () => {
    const k = koko()
    if (!k || !turn) return
    setBusy(true)
    try {
      let r = await k.checkpoint.revert({ key: turn })
      if (r.ok && r.data.conflicts.length) {
        const names = r.data.conflicts.map((p) => p.split(/[\\/]/).pop()).join(', ')
        if (!(await askConfirm(`You changed ${names} after the AI did. Undo anyway? Your newer changes in ${r.data.conflicts.length === 1 ? 'that file' : 'those files'} will be lost.`))) { setBusy(false); return }
        r = await k.checkpoint.revert({ key: turn, force: true })
      }
      if (!r.ok) throw new Error(r.error.message)
      toast.success(`Undone: ${r.data.restored} restored${r.data.deleted ? `, ${r.data.deleted} removed` : ''}`)
      refresh()
    } catch (e: any) { toast.error(e.message) }
    setBusy(false)
  }
  const [user, setUser] = useState<boolean | null>(null)
  const pending = useStore((s) => rows.some((b) => { const id = (b.meta as Meta | undefined)?.approval?.id; return !!id && !!s.approvals[id] }))
  const running = rows.find((b) => b.status === 'running')
  const expanded = user ?? (live || pending)
  const changed = rows.filter((b) => b.status === 'done' && ['edit', 'create'].includes(describeBlock(b).icon))
  const names = [...new Set(changed.map((b) => ((b.meta ?? {}) as Meta).path ?? '').filter(Boolean).map((p) => p.split('/').pop() as string))]
  const lead = running ?? rows[rows.length - 1]
  const ld = lead ? describeBlock(lead) : null
  const Icon = ld ? ICON[ld.icon] : Terminal
  if (!rows.length) return null

  return (
    <div className="anim-fade-up w-full max-w-2xl overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex items-center">
      <button onClick={() => setUser(!expanded)} className="flex min-w-0 flex-1 items-center gap-3 px-3.5 py-2.5 text-left text-[13.5px]">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">{live && running ? <Loader2 size={15} className="spin" /> : pending ? <ShieldQuestion size={15} /> : <Icon size={15} />}</span>
        <span className="min-w-0 flex-1">
          {pending ? <span className="font-medium">Waiting for your approval</span>
            : live && running && ld ? <><span className="shimmer font-medium">{ld.present}</span>{ld.subject && <> <code className="rounded-md bg-fg/6 px-1.5 py-0.5 font-mono text-[12.5px]">{ld.subject}</code></>}{rows.length > 1 && <span className="ml-1.5 text-xs text-faint">· step {rows.indexOf(running) + 1} of {rows.length}</span>}</>
            : <span className="font-medium">{summarize(rows)}</span>}
        </span>
        {!expanded && names.length > 0 && (
          <span className="hidden min-w-0 shrink items-center gap-1.5 sm:flex">
            {names.slice(0, 3).map((n) => <code key={n} className="max-w-[9rem] truncate rounded-md bg-fg/6 px-1.5 py-0.5 font-mono text-[11.5px] text-muted">{n}</code>)}
            {names.length > 3 && <span className="text-xs text-faint">+{names.length - 3}</span>}
          </span>
        )}
        <ChevronRight size={14} className={cn('shrink-0 text-faint transition-transform', expanded && 'rotate-90')} />
      </button>
      {cp && cp.count > 0 && !live && (
        <button onClick={undo} disabled={busy || cp.reverted} title={cp.reverted ? 'These changes were undone' : 'Put the files this reply changed back as they were'} className={cn('mr-2.5 flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition', cp.reverted ? 'text-faint' : 'bg-fg/6 text-muted hover:bg-fg/10 hover:text-fg active:scale-95')}>
          {busy ? <Loader2 size={12} className="spin" /> : <Undo2 size={12} />}{cp.reverted ? 'Undone' : 'Undo'}
        </button>
      )}
      </div>
      {live && running && !expanded && <div className="imggen-sweep relative h-0.5 overflow-hidden bg-fg/6" />}
      {expanded && <div className="flex flex-col gap-0.5 border-t border-line px-1.5 py-1.5">{rows.map((b) => <Row key={b.id} b={b} />)}</div>}
    </div>
  )
}
