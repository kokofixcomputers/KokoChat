import { useEffect, useRef, useState } from 'react'
import { askConfirm } from '../lib/confirm'
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, Copy, GitBranch, GitCommitHorizontal, Loader2, Minus, Plus, Sparkles, Undo2, X } from 'lucide-react'
import { koko, type GitStatus, type GitFile } from '../lib/desktop'
import { aiCommitMessage, aiPrText } from '../lib/gitAi'
import { Popover } from './ui'
import { toast } from '../lib/toast'
import { cn } from '../lib/utils'

const STATUS: Record<string, { label: string; cls: string }> = {
  M: { label: 'M', cls: 'text-amber-500' }, A: { label: 'A', cls: 'text-accent' }, U: { label: 'U', cls: 'text-accent' },
  D: { label: 'D', cls: 'text-danger' }, R: { label: 'R', cls: 'text-sky-500' }, C: { label: 'C', cls: 'text-sky-500' },
}
const baseName = (p: string) => p.split('/').pop() || p

function FileRow({ f, onOpen, action }: { f: GitFile; onOpen: () => void; action: React.ReactNode }) {
  return (
    <div className="group flex items-center rounded-lg transition hover:bg-fg/5">
      <button onClick={onOpen} title={f.path} className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left text-[13px]">
        <span className={cn('w-4 shrink-0 text-center font-mono text-xs font-semibold', STATUS[f.status]?.cls ?? 'text-muted')}>{STATUS[f.status]?.label ?? f.status}</span>
        <span className="min-w-0 flex-1 truncate"><span>{baseName(f.path)}</span>{f.path.includes('/') && <span className="ml-1.5 text-xs text-faint">{f.path.slice(0, f.path.lastIndexOf('/'))}</span>}</span>
        {(f.added != null || f.removed != null) && <span className="shrink-0 font-mono text-xs tabular-nums"><span className="text-accent">+{f.added ?? 0}</span> <span className="text-danger">−{f.removed ?? 0}</span></span>}
      </button>
      <span className="flex shrink-0 items-center pr-1 opacity-0 transition group-hover:opacity-100 max-sm:opacity-100">{action}</span>
    </div>
  )
}
const iconBtn = 'grid h-7 w-7 place-items-center rounded-full text-muted transition hover:bg-fg/8 hover:text-fg active:scale-90'

/** Stage files, write a commit message (or have the AI write one), commit, switch branches, push and pull. */
export function ChangesPanel({ cwd, status, reload, openDiff }: { cwd: string; status: GitStatus; reload: () => void; openDiff: (f: GitFile) => void }) {
  const k = koko()!
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [gen, setGen] = useState(false)
  const [log, setLog] = useState<{ hash: string; subject: string; author: string; when: string }[] | null>(null)
  const [showLog, setShowLog] = useState(false)
  const [branches, setBranches] = useState<{ name: string; current: boolean }[]>([])
  const [newBranch, setNewBranch] = useState('')
  const [pr, setPr] = useState<{ text?: string; busy?: boolean; err?: string } | null>(null)
  const ta = useRef<HTMLTextAreaElement>(null)

  const staged = status.files.filter((f) => f.staged)
  const unstaged = status.files.filter((f) => f.unstaged)
  const commitCount = staged.length || status.files.length

  useEffect(() => { if (showLog) void k.git.log({ cwd, n: 12 }).then((r) => r.ok && setLog(r.data.commits)) }, [showLog, status.branch, status.files.length]) // eslint-disable-line

  const run = async <T,>(label: string, fn: () => Promise<{ ok: true; data: T } | { ok: false; error: { message: string } }>, done?: (d: T) => void) => {
    setBusy(label); setErr('')
    const r = await fn()
    setBusy(null)
    if (!r.ok) { setErr(r.error.message); return }
    done?.(r.data); reload()
  }

  const commit = () => run('commit', () => k.git.commit({ cwd, message: msg, stageAll: !staged.length }), (d) => { toast.success(`Committed ${d.hash}`); setMsg('') })
  const generate = async () => {
    setGen(true); setErr('')
    try { setMsg(await aiCommitMessage(cwd)); setTimeout(() => ta.current?.focus(), 30) } catch (e: any) { setErr(e.message) }
    setGen(false)
  }
  const writePr = async () => {
    setPr({ busy: true })
    try { setPr({ text: await aiPrText(cwd) }) } catch (e: any) { setPr({ err: e.message }) }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* branch, sync */}
      <div className="flex shrink-0 items-center gap-1.5 px-3 pb-2">
        <Popover side="bottom" panelClassName="w-64" button={(open, toggle) => (
          <button onClick={() => { toggle(); void k.git.branches({ cwd }).then((r) => r.ok && setBranches(r.data.branches)) }} className={cn('flex h-8 min-w-0 max-w-[12rem] items-center gap-1.5 rounded-full bg-fg/5 pl-2.5 pr-2 text-[13px] font-medium transition hover:bg-fg/8', open && 'bg-fg/8')}>
            <GitBranch size={13} className="shrink-0 text-accent" /><span className="truncate">{status.branch || 'no branch'}</span><ChevronDown size={12} className="shrink-0 text-faint" />
          </button>
        )}>
          {(close) => (
            <div>
              <div className="max-h-52 overflow-y-auto">
                {branches.map((b) => (
                  <button key={b.name} onClick={() => { close(); if (!b.current) void run('switch', () => k.git.checkout({ cwd, branch: b.name })) }} className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-sm transition hover:bg-fg/5"><span className="min-w-0 flex-1 truncate">{b.name}</span>{b.current && <Check size={14} className="text-accent" />}</button>
                ))}
              </div>
              <form className="mt-1 flex gap-1.5 border-t border-line pt-1.5" onSubmit={(e) => { e.preventDefault(); const n = newBranch.trim(); if (!n) return; close(); setNewBranch(''); void run('branch', () => k.git.checkout({ cwd, branch: n, create: true })) }}>
                <input value={newBranch} onChange={(e) => setNewBranch(e.target.value)} placeholder="New branch name" spellCheck={false} className="h-8 min-w-0 flex-1 rounded-full bg-fg/5 px-3 text-[13px] placeholder:text-faint" />
                <button type="submit" disabled={!newBranch.trim()} className="grid h-8 w-8 place-items-center rounded-full bg-fg text-bg disabled:opacity-30"><Plus size={14} /></button>
              </form>
            </div>
          )}
        </Popover>
        <span className="min-w-0 flex-1" />
        <button disabled={!!busy} onClick={() => run('pull', () => k.git.pull({ cwd }), (d) => toast.info(d.output.split('\n')[0] || 'Pulled'))} title={status.upstream ? `Pull from ${status.upstream}` : 'No upstream branch to pull from'} className="flex h-8 items-center gap-1 rounded-full px-2.5 text-[13px] text-muted transition hover:bg-fg/5 hover:text-fg disabled:opacity-40">{busy === 'pull' ? <Loader2 size={13} className="spin" /> : <ArrowDown size={13} />}Pull{!!status.behind && <span className="tabular-nums text-accent">{status.behind}</span>}</button>
        <button disabled={!!busy} onClick={() => run('push', () => k.git.push({ cwd }), () => toast.success('Pushed'))} title={status.upstream ? `Push to ${status.upstream}` : 'Publish this branch to origin'} className="flex h-8 items-center gap-1 rounded-full px-2.5 text-[13px] text-muted transition hover:bg-fg/5 hover:text-fg disabled:opacity-40">{busy === 'push' ? <Loader2 size={13} className="spin" /> : <ArrowUp size={13} />}{status.upstream ? 'Push' : 'Publish'}{!!status.ahead && <span className="tabular-nums text-accent">{status.ahead}</span>}</button>
      </div>

      {/* files */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        {!status.files.length && <p className="px-3 py-6 text-center text-sm text-muted">No uncommitted changes.</p>}
        {staged.length > 0 && (
          <div className="mb-2">
            <div className="flex items-center px-2.5 pb-0.5 pt-1 text-xs font-medium text-muted"><span className="flex-1">Staged ({staged.length})</span><button title="Unstage all" onClick={() => run('unstage', () => k.git.unstage({ cwd, all: true }))} className="text-faint hover:text-fg"><Minus size={14} /></button></div>
            {staged.map((f) => <FileRow key={'s' + f.path} f={f} onOpen={() => openDiff(f)} action={<button title="Unstage" onClick={() => run('unstage', () => k.git.unstage({ cwd, paths: [f.path] }))} className={iconBtn}><Minus size={14} /></button>} />)}
          </div>
        )}
        {unstaged.length > 0 && (
          <div className="mb-2">
            <div className="flex items-center px-2.5 pb-0.5 pt-1 text-xs font-medium text-muted"><span className="flex-1">Changes ({unstaged.length})</span><button title="Stage all" onClick={() => run('stage', () => k.git.stage({ cwd, all: true }))} className="text-faint hover:text-fg"><Plus size={14} /></button></div>
            {unstaged.map((f) => (
              <FileRow key={'u' + f.path} f={f} onOpen={() => openDiff(f)} action={<>
                <button title={f.status === 'U' ? 'Delete this new file' : 'Discard changes'} onClick={async () => { if (await askConfirm(f.status === 'U' ? `Delete ${f.path}? It is not in git, so this cannot be undone.` : `Discard your changes to ${f.path}? This cannot be undone.`)) void run('discard', () => k.git.discard({ cwd, paths: [f.path] })) }} className={cn(iconBtn, 'hover:text-danger')}><Undo2 size={13} /></button>
                <button title="Stage" onClick={() => run('stage', () => k.git.stage({ cwd, paths: [f.path] }))} className={iconBtn}><Plus size={14} /></button>
              </>} />
            ))}
          </div>
        )}
        <button onClick={() => setShowLog(!showLog)} className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-xs font-medium text-muted transition hover:text-fg"><ChevronRight size={12} className={cn('transition-transform', showLog && 'rotate-90')} />Recent commits</button>
        {showLog && (log ? log.map((c) => <div key={c.hash} className="flex items-baseline gap-2 px-2.5 py-1 text-[13px]"><code className="shrink-0 font-mono text-[11px] text-faint">{c.hash}</code><span className="min-w-0 flex-1 truncate" title={c.subject}>{c.subject}</span><span className="hidden shrink-0 text-[11px] text-faint sm:block">{c.when}</span></div>) : <Loader2 size={14} className="spin mx-3 my-2 text-muted" />)}
        {showLog && <button onClick={writePr} disabled={pr?.busy} className="m-2 flex items-center gap-1.5 rounded-full bg-fg/6 px-3 py-1.5 text-xs font-medium transition hover:bg-fg/10 disabled:opacity-50">{pr?.busy ? <Loader2 size={12} className="spin" /> : <Sparkles size={12} className="text-accent" />}Write a pull request description</button>}
      </div>

      {/* commit */}
      <div className="shrink-0 border-t border-line p-3">
        {err && <div className="mb-2 flex items-start gap-2 rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger"><span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{err}</span><button onClick={() => setErr('')}><X size={12} /></button></div>}
        <div className="relative">
          <textarea ref={ta} value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && msg.trim() && !busy) { e.preventDefault(); void commit() } }} rows={msg.includes('\n') ? 4 : 2} placeholder="Commit message" className="w-full resize-none rounded-2xl border border-line bg-surface-2/60 px-3.5 py-2.5 pr-11 text-[13px] leading-snug placeholder:text-faint focus:border-accent/60" />
          <button onClick={generate} disabled={gen || !status.files.length} title="Write the message with AI" className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-accent-soft text-accent transition hover:bg-accent/20 active:scale-90 disabled:opacity-40">{gen ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}</button>
        </div>
        <button onClick={commit} disabled={!msg.trim() || !!busy || !status.files.length} className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-full bg-fg text-sm font-medium text-bg transition active:scale-[0.98] disabled:opacity-40">
          {busy === 'commit' ? <Loader2 size={15} className="spin" /> : <GitCommitHorizontal size={16} />}{staged.length ? `Commit ${staged.length} staged file${staged.length === 1 ? '' : 's'}` : `Commit all ${commitCount} change${commitCount === 1 ? '' : 's'}`}
        </button>
      </div>

      {pr && (
        <div className="fixed inset-0 z-[120] grid place-items-center bg-black/30 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && setPr(null)}>
          <div className="glass-strong anim-pop flex max-h-[85vh] w-full max-w-lg flex-col rounded-[28px] p-5">
            <div className="mb-2 flex items-center"><div className="flex-1 text-lg font-semibold tracking-tight">Pull request description</div><button onClick={() => setPr(null)} className={iconBtn}><X size={16} /></button></div>
            {pr.busy ? <div className="grid h-32 place-items-center"><Loader2 size={20} className="spin text-muted" /></div>
              : pr.err ? <p className="text-sm text-danger">{pr.err}</p>
              : <><textarea value={pr.text} onChange={(e) => setPr({ text: e.target.value })} rows={14} className="min-h-0 w-full flex-1 resize-none rounded-2xl border border-line bg-surface-2/60 p-3.5 font-mono text-[12.5px] leading-relaxed" /><button onClick={() => { void navigator.clipboard.writeText(pr.text ?? ''); toast.success('Copied') }} className="mt-3 flex h-10 items-center justify-center gap-2 rounded-full bg-fg text-sm font-medium text-bg active:scale-[0.98]"><Copy size={14} />Copy</button></>}
          </div>
        </div>
      )}
    </div>
  )
}
