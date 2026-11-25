import { useEffect, useRef, useState } from 'react'
import { ArrowDown, BarChart3, Code2, GitFork, Globe, Plug, Presentation, Sparkles } from 'lucide-react'
import { useStore } from '../store'
import { MessageView } from './Message'
import { CompareRow } from './CompareRow'
import { toUnits } from '../lib/lanes'
import { Markdown } from './Markdown'
import { Minimize2, Undo2, ChevronDown } from 'lucide-react'
import { Composer } from './Composer'
import { takeGoto } from '../lib/search'
import { FolderOpen } from 'lucide-react'
import { CodeWelcome } from './CodeUI'
import { baseName } from '../lib/desktop'

const SUGGESTIONS = [
  { icon: <Globe size={15} />, text: 'What are the biggest tech news stories today?' },
  { icon: <BarChart3 size={15} />, text: 'Make a chart of the planets by diameter' },
  { icon: <Code2 size={15} />, text: 'Build a playable snake game as an HTML artifact' },
  { icon: <Presentation size={15} />, text: 'Make a 10-slide presentation on how the internet works' },
]

const CODE_SUGGESTIONS = [
  'Explain how this codebase is structured',
  'Find and fix bugs in this project',
  'Add tests for the most important code',
  'Generate a logo for this project and add it to the codebase',
]

export function ChatView() {
  const chat = useStore((s) => s.chats.find((c) => c.id === s.activeId))
  const appMode = useStore((s) => s.appMode)
  const providers = useStore((s) => s.providers)
  const send = useStore((s) => s.send)
  const openSettings = useStore((s) => s.openSettings)
  const openChat = useStore((s) => s.openChat)
  const project = useStore((s) => s.projects.find((p) => p.id === s.chats.find((c) => c.id === s.activeId)?.projectId))
  const openProject = useStore((s) => s.openProject)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [away, setAway] = useState(false)
  const msgs = chat?.messages ?? []
  const latestUserId = [...msgs].reverse().find((m) => m.role === 'user')?.id
  const lastLen = JSON.stringify(msgs[msgs.length - 1]?.blocks?.length) + (msgs[msgs.length - 1]?.blocks?.at(-1) as any)?.text?.length

  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [msgs.length, lastLen])
  useEffect(() => { stick.current = true; const el = scroller.current; if (el) el.scrollTop = el.scrollHeight }, [chat?.id])

  useEffect(() => {
    const run = () => {
      const id = takeGoto()
      if (!id) return
      setTimeout(() => {
        const el = scroller.current?.querySelector<HTMLElement>(`[data-mids~="${id}"]`)
        if (!el) return
        stick.current = false
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        el.classList.add('goto-flash')
        setTimeout(() => el.classList.remove('goto-flash'), 1900)
      }, 90)
    }
    run()
    window.addEventListener('koko:goto', run)
    return () => window.removeEventListener('koko:goto', run)
  }, [chat?.id])

  const onScroll = () => {
    const el = scroller.current!
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    stick.current = near
    setAway(!near)
  }

  if (appMode === 'code' && chat?.mode !== 'code') return <CodeWelcome />
  const isCode = chat?.mode === 'code'

  return (
    <div className="relative flex h-full min-w-0 flex-1 flex-col">
      <div ref={scroller} onScroll={onScroll} className="chat-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 pb-44 pt-24">
          {project && !isCode && (
            <button onClick={() => openProject(project.id)} className="glass anim-fade-up mx-auto mb-6 flex max-w-full items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] text-muted transition hover:text-fg">
              <FolderOpen size={13} className="shrink-0 text-accent" /><span className="truncate">Project <span className="font-medium text-fg">{project.name}</span></span>
            </button>
          )}
          {msgs.length === 0 ? (
            isCode ? (
              <div className="my-auto flex flex-col items-center py-10 text-center">
                <div className="anim-fade-up mb-6 grid h-16 w-16 place-items-center rounded-3xl bg-accent text-accent-fg"><Code2 size={28} /></div>
                <h1 className="anim-fade-up text-3xl font-semibold tracking-tight" style={{ animationDelay: '60ms' }}>What should we build?</h1>
                <button onClick={() => chat?.cwd && window.koko?.openFolder(chat.cwd)} title={chat?.cwd} style={{ animationDelay: '100ms' }} className="glass anim-fade-up mt-3 flex max-w-full items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] text-muted transition hover:text-fg"><FolderOpen size={13} className="shrink-0 text-accent" /><span className="truncate">Working in <span className="font-medium text-fg">{baseName(chat?.cwd ?? '')}</span></span></button>
                {providers.length === 0 ? (
                  <button onClick={() => openSettings('providers')} style={{ animationDelay: '120ms' }} className="anim-fade-up mt-6 flex items-center gap-2 rounded-full bg-fg px-5 py-3 text-sm font-medium text-bg transition hover:scale-[1.03] active:scale-95"><Plug size={16} />Add a provider to get started</button>
                ) : (
                  <div className="mt-8 flex max-w-xl flex-wrap justify-center gap-2.5">
                    {CODE_SUGGESTIONS.map((t, i) => (
                      <button key={t} onClick={() => send(t, [])} style={{ animationDelay: `${140 + i * 60}ms` }} className="glass anim-fade-up rounded-full px-4 py-2.5 text-sm transition hover:-translate-y-0.5 active:scale-95">{t}</button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
            <div className="my-auto flex flex-col items-center py-10 text-center">
              <div className="anim-fade-up mb-6 grid h-16 w-16 place-items-center rounded-3xl bg-accent text-accent-fg"><Sparkles size={28} /></div>
              <h1 className="anim-fade-up text-3xl font-semibold tracking-tight" style={{ animationDelay: '60ms' }}>How can I help today?</h1>
              {providers.length === 0 ? (
                <button onClick={() => openSettings('providers')} style={{ animationDelay: '120ms' }} className="anim-fade-up mt-6 flex items-center gap-2 rounded-full bg-fg px-5 py-3 text-sm font-medium text-bg transition hover:scale-[1.03] active:scale-95">
                  <Plug size={16} />Add a provider to get started
                </button>
              ) : (
                <div className="mt-8 flex max-w-xl flex-wrap justify-center gap-2.5">
                  {SUGGESTIONS.map((s, i) => (
                    <button key={s.text} onClick={() => send(s.text, [])} style={{ animationDelay: `${120 + i * 60}ms` }} className="glass anim-fade-up flex items-center gap-2 rounded-full px-4 py-2.5 text-sm transition hover:-translate-y-0.5 active:scale-95">
                      <span className="text-accent">{s.icon}</span>{s.text}
                    </button>
                  ))}
                </div>
              )}
            </div>
            )
          ) : (
            <div className="flex flex-col gap-8">
              {chat?.forkedFrom && (
                <button
                  onClick={() => { const id = chat.forkedFrom!.chatId; if (useStore.getState().chats.some((c) => c.id === id)) openChat(id) }}
                  className="glass anim-fade-up mx-auto flex max-w-full items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] text-muted transition hover:text-fg"
                >
                  <GitFork size={13} className="shrink-0 text-accent" /><span className="truncate">Forked from <span className="font-medium text-fg">{chat.forkedFrom.title}</span></span>
                </button>
              )}
              {toUnits(msgs).map((u) =>
                u.cmp ? (
                  <div key={'g' + u.group} data-mids={u.msgs.map((x) => x.m.id).join(' ')} className="flex flex-col gap-8">
                    <CompareRow chatId={chat!.id} items={u.msgs} last={u.msgs[u.msgs.length - 1].i === msgs.length - 1} />
                    {u.msgs.some((x) => chat?.summary?.upToMessageId === x.m.id) && chat?.summary && <CompactDivider chatId={chat.id} summary={chat.summary} />}
                  </div>
                ) : (
                  <div key={u.m.id} data-mids={u.m.id} className="flex flex-col gap-8">
                    <MessageView chatId={chat!.id} m={u.m} last={u.i === msgs.length - 1} latestUser={u.m.id === latestUserId} />
                    {chat?.summary?.upToMessageId === u.m.id && <CompactDivider chatId={chat.id} summary={chat.summary} />}
                  </div>
                ),
              )}
            </div>
          )}
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="pointer-events-auto relative w-full max-w-3xl">
          {away && (
            <button onClick={() => { const el = scroller.current!; el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }) }} className="glass-strong anim-pop absolute -top-12 left-1/2 grid h-9 w-9 -translate-x-1/2 place-items-center rounded-full">
              <ArrowDown size={16} />
            </button>
          )}
          <Composer />
        </div>
      </div>
    </div>
  )
}

function CompactDivider({ chatId, summary }: { chatId: string; summary: NonNullable<import('../types').Chat['summary']> }) {
  const [open, setOpen] = useState(false)
  const clear = useStore((s) => s.clearSummary)
  const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
  return (
    <div className="anim-fade-up">
      <div className="flex items-center gap-3 text-xs text-faint">
        <span className="h-px flex-1 bg-line" />
        <button onClick={() => setOpen((o) => !o)} className="glass flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[12.5px] text-muted transition hover:text-fg">
          <Minimize2 size={13} className="text-accent" />Earlier messages compacted for the AI · ~{k(summary.tokensBefore)} → ~{k(summary.tokensAfter)} tokens
          <ChevronDown size={13} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
        </button>
        <span className="h-px flex-1 bg-line" />
      </div>
      {open && (
        <div className="anim-pop mx-auto mt-3 max-w-2xl rounded-2xl border border-line bg-surface-2/50 p-4">
          <div className="mb-1 text-xs font-medium text-muted">Summary the AI sees instead of the messages above</div>
          <Markdown text={summary.text} small />
          <button onClick={() => clear(chatId)} className="mt-3 flex items-center gap-1.5 rounded-full bg-fg/8 px-3 py-1.5 text-xs font-medium hover:bg-fg/12"><Undo2 size={12} />Undo compaction</button>
        </div>
      )}
    </div>
  )
}
