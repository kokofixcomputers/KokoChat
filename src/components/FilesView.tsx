import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ChevronRight, File as FileIcon, FileImage, Folder, FolderOpen, GitBranch, Loader2, RefreshCw } from 'lucide-react'
import { koko, type DiffLine, type GitStatus, type GitFile } from '../lib/desktop'
import { ChangesPanel } from './ChangesPanel'
import { ActionsPanel } from './ActionsPanel'
import { useStore } from '../store'
import { DiffView } from './CodeActivity'
import { cn, fmtBytes } from '../lib/utils'

type Entry = { name: string; type: 'dir' | 'file'; size?: number; hidden?: boolean }

const STATUS: Record<string, { label: string; cls: string }> = {
  M: { label: 'M', cls: 'text-amber-500' }, A: { label: 'A', cls: 'text-accent' }, U: { label: 'U', cls: 'text-accent' },
  D: { label: 'D', cls: 'text-danger' }, R: { label: 'R', cls: 'text-sky-500' }, C: { label: 'C', cls: 'text-sky-500' },
}

/** `git diff` text -> lines the diff view can show (hunk headers become grey rows). */
function parseDiff(text: string): DiffLine[] {
  const out: DiffLine[] = []
  let o = 0, n = 0
  for (const line of text.split('\n')) {
    if (/^(diff --git|index |--- |\+\+\+ |new file|deleted file|similarity|rename )/.test(line)) continue
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line)
    if (h) { o = +h[1]; n = +h[2]; out.push({ t: ' ', n: 0, s: `@@ ${h[3].trim() || `line ${n}`}` }); continue }
    if (line.startsWith('\\')) continue
    if (line.startsWith('+')) out.push({ t: '+', n: n++, s: line.slice(1) })
    else if (line.startsWith('-')) out.push({ t: '-', n: o++, s: line.slice(1) })
    else if (line.startsWith(' ')) { out.push({ t: ' ', n: n, s: line.slice(1) }); n++; o++ }
  }
  return out
}

const baseName = (p: string) => p.split('/').pop() || p

/** A read-only look at the project: its folders and files, and what changed since the last commit. */
export function FilesView({ cwd, visible }: { cwd?: string; visible: boolean }) {
  const k = koko()
  const [tab, setTab] = useState<'files' | 'changes' | 'actions'>('files')
  const [tree, setTree] = useState<Record<string, Entry[] | 'loading' | 'error'>>({})
  const [open, setOpen] = useState<Record<string, boolean>>({ '.': true })
  const [changes, setChanges] = useState<GitStatus | null>(null)
  const [sel, setSel] = useState<{ kind: 'file' | 'diff'; path: string; status?: string } | null>(null)
  const [content, setContent] = useState<{ loading?: boolean; err?: string; text?: string; image?: string; binary?: boolean; truncated?: boolean; size?: number; diff?: DiffLine[] } | null>(null)
  const chatId = useStore((s) => s.activeId)
  const streaming = useStore((s) => !!(chatId && s.streaming[chatId]))
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const loadDir = useCallback(async (dir: string) => {
    if (!k || !cwd) return
    setTree((t) => (t[dir] ? t : { ...t, [dir]: 'loading' }))
    const r = await k.fs.tree({ cwd, path: dir })
    if (!alive.current) return
    setTree((t) => ({ ...t, [dir]: r.ok ? r.data.entries : 'error' }))
  }, [k, cwd])

  const loadChanges = useCallback(async () => {
    if (!k || !cwd) return
    const r = await k.git.status({ cwd })
    if (alive.current) setChanges(r.ok ? r.data : { isRepo: false, files: [] })
  }, [k, cwd])

  const refresh = useCallback(() => {
    if (!cwd) return
    setTree({}); void loadChanges()
    for (const d of Object.keys(open)) if (open[d]) void loadDir(d)
    if (sel) void openItem(sel.kind, sel.path, sel.status)
  }, [cwd, open, sel]) // eslint-disable-line

  useEffect(() => { if (visible && cwd) { void loadDir('.'); void loadChanges() } }, [visible, cwd]) // eslint-disable-line
  // when the AI finishes a reply the files have probably changed
  const wasStreaming = useRef(false)
  useEffect(() => { if (wasStreaming.current && !streaming && visible) refresh(); wasStreaming.current = streaming }, [streaming]) // eslint-disable-line

  const toggle = (dir: string) => { const on = !open[dir]; setOpen((o) => ({ ...o, [dir]: on })); if (on) void loadDir(dir) }

  async function openItem(kind: 'file' | 'diff', path: string, status?: string) {
    if (!k || !cwd) return
    setSel({ kind, path, status }); setContent({ loading: true })
    if (kind === 'file') {
      const r = await k.fs.readRaw({ cwd, path })
      if (!alive.current) return
      setContent(r.ok ? { ...r.data } : { err: r.error.message })
    } else {
      const r = await k.git.diff({ cwd, path, status })
      if (!alive.current) return
      setContent(r.ok ? { binary: r.data.binary, truncated: r.data.truncated, diff: parseDiff(r.data.text) } : { err: r.error.message })
    }
  }

  const Node = ({ dir, depth }: { dir: string; depth: number }) => {
    const list = tree[dir]
    if (list === 'loading' || !list) return <div className="py-1 pl-8 text-xs text-faint" style={{ paddingLeft: 12 + depth * 14 }}>Loading…</div>
    if (list === 'error') return <div className="py-1 text-xs text-danger" style={{ paddingLeft: 12 + depth * 14 }}>Could not open this folder</div>
    if (!list.length) return <div className="py-1 text-xs text-faint" style={{ paddingLeft: 12 + depth * 14 }}>Empty</div>
    return (
      <>
        {list.map((e) => {
          const p = dir === '.' ? e.name : `${dir}/${e.name}`
          if (e.type === 'dir') {
            const isOpen = !!open[p] && !e.hidden
            return (
              <div key={p}>
                <button onClick={() => !e.hidden && toggle(p)} className={cn('flex w-full items-center gap-1.5 rounded-lg py-1 pr-2 text-left text-[13px] transition hover:bg-fg/5', e.hidden && 'cursor-default text-faint')} style={{ paddingLeft: 8 + depth * 14 }} title={e.hidden ? 'Generated or dependency folder (hidden)' : p}>
                  <ChevronRight size={12} className={cn('shrink-0 text-faint transition-transform', isOpen && 'rotate-90')} />
                  {isOpen ? <FolderOpen size={14} className="shrink-0 text-accent" /> : <Folder size={14} className="shrink-0 text-accent/80" />}
                  <span className="min-w-0 truncate">{e.name}</span>
                </button>
                {isOpen && Node({ dir: p, depth: depth + 1 })}
              </div>
            )
          }
          const img = /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(e.name)
          return (
            <button key={p} onClick={() => openItem('file', p)} className="flex w-full items-center gap-1.5 rounded-lg py-1 pr-2 text-left text-[13px] transition hover:bg-fg/5" style={{ paddingLeft: 8 + depth * 14 + 16 }} title={p}>
              {img ? <FileImage size={14} className="shrink-0 text-muted" /> : <FileIcon size={14} className="shrink-0 text-muted" />}
              <span className="min-w-0 flex-1 truncate">{e.name}</span>
              {e.size != null && e.size > 100_000 && <span className="shrink-0 text-[11px] text-faint">{fmtBytes(e.size)}</span>}
            </button>
          )
        })}
      </>
    )
  }

  const fileLines = useMemo(() => (content?.text !== undefined ? content.text.split('\n').slice(0, 5000) : []), [content?.text])
  const nChanges = changes?.files.length ?? 0

  if (!cwd) return <div className={cn('absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted', !visible && 'hidden')}>Open a Code session to browse its files.</div>

  return (
    <div className={cn('absolute inset-0 flex flex-col', !visible && 'hidden')}>
      <div className="flex shrink-0 items-center gap-1.5 px-3 pb-2">
        {sel ? (
          <button onClick={() => { setSel(null); setContent(null) }} className="flex h-8 min-w-0 items-center gap-1.5 rounded-full pl-2 pr-3 text-[13px] text-muted transition hover:bg-fg/5 hover:text-fg"><ArrowLeft size={14} className="shrink-0" /><span className="truncate font-mono text-xs">{sel.path}</span></button>
        ) : (
          <div className="inline-flex rounded-full bg-fg/5 p-0.5">
            <button onClick={() => setTab('files')} className={cn('rounded-full px-3 py-1 text-[13px] font-medium transition', tab === 'files' ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg')}>Files</button>
            <button onClick={() => setTab('changes')} className={cn('flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium transition', tab === 'changes' ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg')}>Changes{nChanges > 0 && <span className="rounded-full bg-accent px-1.5 text-[11px] leading-4 text-accent-fg">{nChanges}</span>}</button>
            <button onClick={() => setTab('actions')} className={cn('rounded-full px-3 py-1 text-[13px] font-medium transition', tab === 'actions' ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg')}>Actions</button>
          </div>
        )}
        <span className="min-w-0 flex-1" />
        {!sel && changes?.isRepo && changes.branch && <span className="hidden items-center gap-1 truncate text-xs text-faint sm:flex"><GitBranch size={12} />{changes.branch}</span>}
        <button title="Refresh" onClick={refresh} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted transition hover:bg-fg/5 hover:text-fg"><RefreshCw size={14} /></button>
      </div>

      {!sel && tab === 'changes' && changes?.isRepo ? (
        <ChangesPanel cwd={cwd} status={changes} reload={() => void loadChanges()} openDiff={(f: GitFile) => void openItem('diff', f.path, f.status)} />
      ) : (
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
        {sel ? (
          content?.loading ? <div className="grid h-32 place-items-center"><Loader2 size={18} className="spin text-muted" /></div>
          : content?.err ? <p className="px-3 py-6 text-sm text-danger">{content.err}</p>
          : content?.image ? <div className="grid place-items-center p-4"><img src={content.image} alt={sel.path} className="max-h-full max-w-full rounded-lg border border-line bg-[repeating-conic-gradient(#8881_0_25%,transparent_0_50%)] bg-[length:16px_16px]" /></div>
          : content?.binary ? <p className="px-3 py-6 text-sm text-muted">{sel.kind === 'diff' ? 'This file is binary, so there is no text diff.' : `Binary file${content.size ? ` (${fmtBytes(content.size)})` : ''}. It cannot be shown here.`}</p>
          : sel.kind === 'diff' ? (content?.diff?.length ? <DiffView lines={content.diff} truncated={content.truncated} className="max-h-none border-0 bg-transparent" /> : <p className="px-3 py-6 text-sm text-muted">No changes to show.</p>)
          : (
            <div className="font-mono text-[12px] leading-[1.6]">
              {fileLines.map((l, i) => <div key={i} className="flex min-w-max px-2"><span className="w-10 shrink-0 select-none pr-3 text-right text-faint">{i + 1}</span><span className="whitespace-pre">{l || ' '}</span></div>)}
              {(content?.truncated || (content?.text?.split('\n').length ?? 0) > 5000) && <div className="px-3 py-2 text-faint">…the rest of this file is not shown</div>}
            </div>
          )
        ) : tab === 'actions' ? (
          <ActionsPanel cwd={cwd} />
        ) : tab === 'files' ? (
          Node({ dir: '.', depth: 0 })
        ) : !changes ? (
          <div className="grid h-32 place-items-center"><Loader2 size={18} className="spin text-muted" /></div>
        ) : (
          <p className="px-3 py-6 text-center text-sm text-muted">This folder is not a git repository, so there is no list of changes. Use the Undo button on a reply to take back what the AI changed.</p>
        )}
      </div>)}
    </div>
  )
}
