import { useMemo, useState } from 'react'
import { ChevronRight, Cloud, CloudOff, FolderInput, FolderOpen, GitFork, Loader2, MessageSquare, PanelLeftClose, Pencil, Pin, PinOff, Plus, Search, Settings as Cog, SlidersHorizontal, Trash2, MessageCircle, Check, CalendarClock } from 'lucide-react'
import { useStore } from '../store'
import type { Chat } from '../types'
import { IconButton } from './ui'
import { syncNow } from '../lib/sync'
import { cn, fmtBytes } from '../lib/utils'
import { ModeSwitch, startSession } from './CodeUI'
import { PluginSlot } from './PluginSlot'
import { baseName, isDesktop } from '../lib/desktop'

const bucket = (t: number) => {
  const d = (Date.now() - t) / 864e5
  return d < 1 ? 'Today' : d < 2 ? 'Yesterday' : d < 7 ? 'Previous 7 days' : 'Older'
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

function Row({ c, active, nested, onMove }: { c: Chat; active: boolean; nested?: boolean; onMove?: (e: React.MouseEvent) => void }) {
  const { openChat, deleteChat, renameChat, pinChat, setSidebar, streaming } = useStore()
  const [edit, setEdit] = useState(false)
  const [v, setV] = useState(c.title)
  return (
    <div
      onClick={() => { openChat(c.id); if (innerWidth < 900) setSidebar(false) }}
      className={cn('group flex h-10 cursor-pointer items-center gap-2.5 rounded-full px-3 text-sm transition', nested && 'ml-4', active ? 'bg-fg/8 font-medium' : 'text-fg/80 hover:bg-fg/5')}
    >
      {streaming[c.id] ? <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" /> : c.forkedFrom ? <GitFork size={15} className="shrink-0 text-faint" /> : <MessageSquare size={15} className="shrink-0 text-faint" />}
      {edit ? (
        <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onClick={(e) => e.stopPropagation()}
          onBlur={() => { renameChat(c.id, v.trim() || c.title); setEdit(false) }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEdit(false) }}
          className="min-w-0 flex-1 rounded bg-transparent outline-none" />
      ) : <span className="min-w-0 flex-1 truncate">{c.title}</span>}
      {!edit && (
        <span className="hidden items-center group-hover:flex" onClick={(e) => e.stopPropagation()}>
          <button title="Pin" onClick={() => pinChat(c.id)} className="grid h-6 w-6 place-items-center rounded-full text-faint hover:text-fg">{c.pinned ? <PinOff size={13} /> : <Pin size={13} />}</button>
          {onMove && <button title="Move to project" onClick={onMove} className="grid h-6 w-6 place-items-center rounded-full text-faint hover:text-fg"><FolderInput size={13} /></button>}
          <button title="Rename" onClick={() => setEdit(true)} className="grid h-6 w-6 place-items-center rounded-full text-faint hover:text-fg"><Pencil size={13} /></button>
          <button title="Delete" onClick={() => deleteChat(c.id)} className="grid h-6 w-6 place-items-center rounded-full text-faint hover:text-danger"><Trash2 size={13} /></button>
        </span>
      )}
    </div>
  )
}

function MoveMenu({ at, onClose }: { at: { chatId: string; x: number; y: number }; onClose: () => void }) {
  const { projects, moveChat, addProject, openProject } = useStore()
  const cur = useStore((s) => s.chats.find((c) => c.id === at.chatId)?.projectId)
  const left = Math.max(8, Math.min(at.x, innerWidth - 232))
  const top = Math.min(at.y, innerHeight - Math.min(360, 60 + projects.length * 40) - 8)
  return (
    <>
      <div className="fixed inset-0 z-[120]" onMouseDown={onClose} />
      <div style={{ left, top }} className="glass-strong anim-pop fixed z-[121] max-h-80 w-56 overflow-y-auto rounded-2xl p-1.5">
        <div className="px-2.5 pb-1 pt-1.5 text-xs font-medium text-muted">Move to project</div>
        {projects.map((p) => (
          <button key={p.id} onClick={() => { moveChat(at.chatId, p.id); onClose() }} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition hover:bg-fg/5"><FolderOpen size={15} className="shrink-0 text-accent" /><span className="min-w-0 flex-1 truncate">{p.name}</span>{cur === p.id && <Check size={14} className="text-accent" />}</button>
        ))}
        {cur && <button onClick={() => { moveChat(at.chatId, undefined); onClose() }} className="w-full rounded-xl px-2.5 py-2 text-left text-sm text-muted transition hover:bg-fg/5 hover:text-fg">Remove from project</button>}
        <button onClick={() => { const id = addProject(); moveChat(at.chatId, id); onClose(); openProject(id) }} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm text-accent transition hover:bg-fg/5"><Plus size={15} />New project…</button>
      </div>
    </>
  )
}

export function Sidebar() {
  const { chats, projects, activeId, newChat, openSettings, setSidebar, addProject, openProject, appMode, recentFolders, coworkOpen, setCoworkOpen, coworkers } = useStore()
  const code = appMode === 'code' && isDesktop()
  const [folderMenu, setFolderMenu] = useState<{ x: number; y: number } | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem('koko:projopen') ?? '{}') } catch { return {} } })
  const [move, setMove] = useState<{ chatId: string; x: number; y: number } | null>(null)
  const toggle = (id: string) => setOpen((o) => { const n = { ...o, [id]: !o[id] }; try { localStorage.setItem('koko:projopen', JSON.stringify(n)) } catch { /* ignore */ } return n })
  const projectIds = useMemo(() => new Set(projects.map((p) => p.id)), [projects])
  const visible = useMemo(() => chats.filter((c) => !c.sub && (c.mode === 'code') === code).filter((c) => c.messages.length || c.id === activeId).sort((a, b) => b.updatedAt - a.updatedAt), [chats, activeId, code])
  // Code sessions are grouped by the folder they work in
  const folders = useMemo(() => {
    const m = new Map<string, Chat[]>()
    for (const c of visible) { const k = c.cwd ?? ''; m.set(k, [...(m.get(k) ?? []), c]) }
    for (const f of recentFolders) if (!m.has(f)) m.set(f, [])
    return [...m.entries()].sort((a, b) => Math.max(0, ...b[1].map((c) => c.updatedAt)) - Math.max(0, ...a[1].map((c) => c.updatedAt)))
  }, [visible, recentFolders])

  const groups = useMemo(() => {
    const list = visible.filter((c) => !c.projectId || !projectIds.has(c.projectId))
    const out: [string, Chat[]][] = []
    const pinned = list.filter((c) => c.pinned)
    if (pinned.length) out.push(['Pinned', pinned])
    for (const c of list.filter((c) => !c.pinned)) {
      const k = bucket(c.updatedAt)
      const g = out.find((x) => x[0] === k)
      g ? g[1].push(c) : out.push([k, [c]])
    }
    return out
  }, [visible, projectIds])

  const onMove = (c: Chat) => (e: React.MouseEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMove({ chatId: c.id, x: r.left, y: r.bottom + 6 }) }

  return (
    <aside className="glass-strong anim-slide-in-left flex h-full w-72 shrink-0 flex-col overflow-hidden rounded-[28px] p-2.5">
      <div className="flex items-center justify-between pb-2 pl-2">
        <div className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent text-accent-fg"><MessageCircle size={17} fill="currentColor" /></span>Koko
        </div>
        <IconButton title="Close sidebar" onClick={() => setSidebar(false)}><PanelLeftClose size={18} /></IconButton>
      </div>
      <ModeSwitch />
      <button data-tour="newchat" onClick={(e) => { if (code) { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); if (recentFolders.length) setFolderMenu({ x: r.left, y: r.bottom + 6 }); else void startSession(); return } newChat(); if (innerWidth < 900) setSidebar(false) }} className="mb-2 flex h-11 items-center gap-2.5 rounded-full bg-fg px-4 text-sm font-medium text-bg transition hover:opacity-90 active:scale-[0.98]">
        <Plus size={17} />{code ? 'New session' : 'New chat'}
      </button>
      <button onClick={() => window.dispatchEvent(new Event('koko:search'))} className="mb-2 flex h-9 w-full items-center gap-2.5 rounded-full bg-fg/5 px-3.5 text-left text-sm text-faint transition hover:bg-fg/8">
        <Search size={14} /><span className="flex-1">Search</span><kbd className="hidden rounded-md border border-line px-1.5 py-px text-[11px] lg:block">{isMac ? '⌘' : 'Ctrl '}K</kbd>
      </button>
      {!code && isDesktop() && (
        <button onClick={() => { setCoworkOpen(!coworkOpen); if (innerWidth < 900) setSidebar(false) }} className={cn('mb-2 flex h-9 w-full items-center gap-2.5 rounded-full px-3.5 text-left text-sm transition', coworkOpen ? 'bg-fg/8 font-medium' : 'text-fg/80 hover:bg-fg/5')}>
          <CalendarClock size={15} className="text-accent" /><span className="flex-1">Co-worker</span>
          {!!coworkers.length && <span className="text-xs tabular-nums text-faint">{coworkers.length}</span>}
        </button>
      )}
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        {code && (
          <>
            {folders.map(([cwd, list]) => (
              <div key={cwd} className="mb-2">
                <div className="group/fh flex items-center gap-2 px-3 pb-1 pt-2 text-xs font-medium text-faint" title={cwd}>
                  <FolderOpen size={13} className="shrink-0 text-accent" /><span className="min-w-0 flex-1 truncate">{baseName(cwd) || 'No folder'}</span>
                  <button title="New session in this folder" onClick={() => { void startSession(cwd); if (innerWidth < 900) setSidebar(false) }} className="grid h-5 w-5 place-items-center rounded-full text-faint transition hover:bg-fg/8 hover:text-fg"><Plus size={13} /></button>
                </div>
                {list.map((c) => <Row key={c.id} c={c} active={c.id === activeId} />)}
                {!list.length && <p className="px-3 py-1 text-xs text-faint">No sessions yet</p>}
              </div>
            ))}
            {!folders.length && <p className="px-3 py-8 text-center text-sm text-faint">Open a project folder to start</p>}
          </>
        )}
        {!code && <>
        <div className="mb-1">
          <div className="group/ph flex items-center justify-between px-3 pb-1 pt-2 text-xs font-medium text-faint">
            <span>Projects</span>
            <button title="New project" onClick={() => openProject(addProject())} className="grid h-5 w-5 place-items-center rounded-full text-faint transition hover:bg-fg/8 hover:text-fg"><Plus size={13} /></button>
          </div>
          {projects.map((p) => {
            const mine = visible.filter((c) => c.projectId === p.id)
            const isOpen = !!open[p.id]
            return (
              <div key={p.id}>
                <div onClick={() => toggle(p.id)} className="group flex h-10 cursor-pointer items-center gap-2 rounded-full px-3 text-sm text-fg/85 transition hover:bg-fg/5">
                  <ChevronRight size={13} className={cn('shrink-0 text-faint transition-transform', isOpen && 'rotate-90')} />
                  <FolderOpen size={15} className="shrink-0 text-accent" />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="hidden items-center group-hover:flex" onClick={(e) => e.stopPropagation()}>
                    <button title="New chat in this project" onClick={() => { newChat(p.id); if (innerWidth < 900) setSidebar(false) }} className="grid h-6 w-6 place-items-center rounded-full text-faint hover:text-fg"><Plus size={14} /></button>
                    <button title="Project settings and files" onClick={() => openProject(p.id)} className="grid h-6 w-6 place-items-center rounded-full text-faint hover:text-fg"><SlidersHorizontal size={13} /></button>
                  </span>
                  <span className="text-xs tabular-nums text-faint group-hover:hidden">{mine.length || ''}</span>
                </div>
                {isOpen && (mine.length ? mine.map((c) => <Row key={c.id} c={c} nested active={c.id === activeId} onMove={onMove(c)} />) : <p className="ml-9 py-1.5 text-xs text-faint">No chats yet</p>)}
              </div>
            )
          })}
          {!projects.length && <p className="px-3 pb-2 text-xs leading-relaxed text-faint">Group chats with shared instructions and files.</p>}
        </div>
        {groups.map(([label, list]) => (
          <div key={label} className="mb-2">
            <div className="px-3 pb-1 pt-2 text-xs font-medium text-faint">{label}</div>
            {list.map((c) => <Row key={c.id} c={c} active={c.id === activeId} onMove={onMove(c)} />)}
          </div>
        ))}
        {!groups.length && !projects.length && <p className="px-3 py-8 text-center text-sm text-faint">No chats yet</p>}
        </>}
      </div>
      <PluginSlot name="sidebar.footer" className="mt-2 flex flex-col gap-1" />
      <div className="mt-2 flex items-center gap-1">
        <button data-tour="settings" onClick={() => openSettings()} className="flex h-10 flex-1 items-center gap-2.5 rounded-full px-3 text-sm text-muted transition hover:bg-fg/5 hover:text-fg">
          <Cog size={16} />Settings
        </button>
        <SyncBadge />
      </div>
      {move && <MoveMenu at={move} onClose={() => setMove(null)} />}
      {folderMenu && (
        <>
          <div className="fixed inset-0 z-[120]" onMouseDown={() => setFolderMenu(null)} />
          <div style={{ left: Math.max(8, Math.min(folderMenu.x, innerWidth - 280)), top: folderMenu.y }} className="glass-strong anim-pop fixed z-[121] max-h-80 w-64 overflow-y-auto rounded-2xl p-1.5">
            <div className="px-2.5 pb-1 pt-1.5 text-xs font-medium text-muted">Start a session in</div>
            {recentFolders.slice(0, 6).map((f) => (
              <button key={f} title={f} onClick={() => { setFolderMenu(null); void startSession(f); if (innerWidth < 900) setSidebar(false) }} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition hover:bg-fg/5"><FolderOpen size={15} className="shrink-0 text-accent" /><span className="min-w-0 flex-1 truncate">{baseName(f)}</span></button>
            ))}
            <button onClick={() => { setFolderMenu(null); void startSession() }} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm text-accent transition hover:bg-fg/5"><Plus size={15} />Choose another folder…</button>
          </div>
        </>
      )}
    </aside>
  )
}

function SyncBadge() {
  const { sync, syncStatus, openSettings } = useStore()
  if (!sync.token) return null
  const err = syncStatus.phase === 'error'
  return (
    <button
      onClick={() => (err ? openSettings('sync') : void syncNow())}
      title={err ? `Sync problem: ${syncStatus.message}` : syncStatus.phase === 'syncing' ? 'Syncing…' : `Synced${sync.usage ? ` · ${fmtBytes(sync.usage.used)} of ${fmtBytes(sync.usage.quota).replace('.00', '')} used` : ''}. Click to sync now`}
      className={cn('grid h-10 w-10 place-items-center rounded-full transition hover:bg-fg/5', err ? 'text-danger' : 'text-muted hover:text-fg')}
    >
      {syncStatus.phase === 'syncing' ? <Loader2 size={16} className="spin text-accent" /> : err ? <CloudOff size={16} /> : <Cloud size={16} />}
    </button>
  )
}
