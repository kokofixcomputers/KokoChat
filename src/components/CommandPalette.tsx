import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Cpu, FolderOpen, MessageSquare, Search, TextSearch } from 'lucide-react'
import { useStore } from '../store'
import { getActions } from './actions'
import { ModelIcon } from './ModelIcon'
import { modelBadges } from '../lib/modelBadges'
import { cn } from '../lib/utils'
import { requestGoto, searchMessages, queryTokens } from '../lib/search'

interface Item { id: string; group: string; label: string; hint?: string; sub?: ReactNode; icon: ReactNode; run: () => void }

const ago = (t: number) => {
  const d = (Date.now() - t) / 864e5
  return d < 1 ? 'Today' : d < 2 ? 'Yesterday' : d < 30 ? `${Math.floor(d)}d ago` : new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d > 330 ? 'numeric' : undefined })
}

function Marked({ text, toks }: { text: string; toks: string[] }) {
  if (!toks.length) return <>{text}</>
  const re = new RegExp(`(${toks.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  return <>{text.split(re).map((p, i) => (i % 2 ? <mark key={i} className="hit">{p}</mark> : p))}</>
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('')
  const dq = useDeferredValue(q)
  const [idx, setIdx] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const { chats, providers, projects, openChat, select, openProject } = useStore()

  useEffect(() => { if (open) { setQ(''); setIdx(0) } }, [open])
  useEffect(() => setIdx(0), [dq])

  const items = useMemo<Item[]>(() => {
    if (!open) return []
    const ql = dq.trim().toLowerCase()
    const toks = queryTokens(ql)
    const match = (s: string) => !ql || toks.every((t) => s.toLowerCase().includes(t))
    const out: Item[] = []
    // full-text hits first when searching: that is what people open this for
    if (ql.length >= 2) {
      const hits = searchMessages(chats.filter((c) => !c.sub && c.messages.length), ql, 40)
      out.push(...hits.map((h) => ({
        id: 'm' + h.message.id, group: 'Messages', label: h.chat.title, hint: ago(h.message.createdAt),
        sub: <><span className="text-faint">{h.message.role === 'user' ? 'You: ' : ''}</span>{h.snippet.before}<mark className="hit">{h.snippet.hit}</mark><Marked text={h.snippet.after} toks={toks} /></>,
        icon: <TextSearch size={16} />, run: () => { openChat(h.chat.id); requestGoto(h.message.id) },
      })))
    }
    const ps = projects.filter((p) => match(p.name)).slice(0, 5)
    out.push(...ps.map((p) => ({ id: 'p' + p.id, group: 'Projects', label: p.name, hint: 'Open project', icon: <FolderOpen size={16} />, run: () => openProject(p.id) })))
    const cs = chats
      .filter((c) => c.messages.length && match(c.title))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, ql ? 8 : 6)
    out.push(...cs.map((c) => ({ id: 'c' + c.id, group: 'Chats', label: c.title, hint: ago(c.updatedAt), icon: <MessageSquare size={16} />, run: () => openChat(c.id) })))
    out.push(...getActions().filter((a) => match(a.label) || match(a.slash ?? '')).map((a) => ({ id: 'a' + a.id, group: 'Actions', label: a.label, hint: a.hint, icon: a.icon, run: a.run })))
    if (ql) {
      const ms = providers.flatMap((p) => p.models.filter((m) => m.id.toLowerCase().includes(ql)).map((m) => ({ p, m }))).slice(0, 8)
      out.push(...ms.map(({ p, m }) => ({ id: 'mo' + p.id + m.id, group: 'Switch model', label: m.id, hint: [p.name, ...modelBadges(p.preset, m.id, m, p.baseUrl).filter((b) => b.tone === 'free').map((b) => b.label)].join(' · '), icon: <ModelIcon model={m.id} preset={p.preset} name={p.name} size={18} />, run: () => select(p.id, m.id) })))
    }
    // keep each group together, in a fixed order
    const order = ['Messages', 'Projects', 'Chats', 'Actions', 'Switch model']
    return out.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group))
  }, [open, dq, chats, providers, projects])

  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-i="${idx}"]`)?.scrollIntoView({ block: 'nearest' }) }, [idx])
  if (!open) return null
  const run = (i: Item | undefined) => { if (!i) return; onClose(); setTimeout(i.run, 0) }
  const toks = queryTokens(dq.trim().toLowerCase())
  let last = ''
  return (
    <div className="fixed inset-0 z-[150] flex items-start justify-center bg-black/30 px-3 pt-[10vh] backdrop-blur-sm sm:px-4 sm:pt-[14vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="glass-strong anim-pop w-full max-w-2xl overflow-hidden rounded-3xl">
        <div className="flex items-center gap-3 border-b border-line px-5">
          <Search size={17} className="shrink-0 text-faint" />
          <input
            autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search every message, or run a command…"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(items.length - 1, i + 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)) }
              else if (e.key === 'Enter') { e.preventDefault(); run(items[idx]) }
              else if (e.key === 'Escape') onClose()
            }}
            className="h-14 min-w-0 flex-1 bg-transparent text-[15px] placeholder:text-faint"
          />
          <kbd className="hidden rounded-md border border-line px-1.5 py-0.5 text-[11px] text-faint sm:block">esc</kbd>
        </div>
        <div ref={list} className="max-h-[60vh] overflow-y-auto p-2">
          {items.map((it, i) => {
            const head = it.group !== last ? it.group : null
            last = it.group
            return (
              <div key={it.id}>
                {head && <div className="px-3 pb-1 pt-2.5 text-xs font-medium text-faint">{head}{head === 'Messages' && <span className="ml-1.5 font-normal">· {items.filter((x) => x.group === 'Messages').length}{items.filter((x) => x.group === 'Messages').length >= 40 ? '+' : ''}</span>}</div>}
                <button data-i={i} onMouseMove={() => setIdx(i)} onClick={() => run(it)} className={cn('flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors', i === idx && 'bg-fg/6')}>
                  <span className="mt-0.5 grid w-5 shrink-0 place-items-center text-muted">{it.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{it.group === 'Chats' || it.group === 'Messages' ? <Marked text={it.label} toks={toks} /> : it.label}</span>
                    {it.sub && <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug text-muted">{it.sub}</span>}
                  </span>
                  {it.hint && <span className="mt-0.5 shrink-0 text-xs text-faint">{it.hint}</span>}
                </button>
              </div>
            )
          })}
          {!items.length && <div className="flex flex-col items-center gap-2 py-10 text-sm text-faint"><Cpu size={20} />No results for “{dq}”</div>}
        </div>
      </div>
    </div>
  )
}
