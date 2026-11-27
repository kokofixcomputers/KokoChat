import { useEffect, useMemo, useState } from 'react'
import { Loader2, MessageCircle, Sparkles } from 'lucide-react'
import { createJSONStorage } from 'zustand/middleware'
import { fetchShared, sharedToChat, type SharedChat } from '../lib/share'
import { DEFAULT_SETTINGS, useStore } from '../store'
import type { Chat } from '../types'
import { toUnits } from '../lib/lanes'
import { ReadOnlyView } from '../lib/readOnly'
import { clampWidth, dragResize } from '../lib/resize'
import { MessageView } from './Message'
import { CompareRow } from './CompareRow'
import { ArtifactPanel, SourcesPanel } from './ArtifactPanel'
import { Toasts } from './Toasts'

type Shared = { title: string; created: number; expires: number | null; chat: SharedChat }

const hydrated = () => new Promise<void>((res) => (useStore.persist.hasHydrated() ? res() : void useStore.persist.onFinishHydration(() => res())))

/**
 * The app's own message components read from the store, so the shared chat has to be in it. The store is also where the
 * visitor's real chats and keys are saved, so saving is switched off first: nothing here is ever written to disk.
 */
let saved: ReturnType<typeof useStore.persist.getOptions>['storage']
async function showInStore(chat: Chat) {
  await hydrated()
  if (!saved) saved = useStore.persist.getOptions().storage
  useStore.persist.setOptions({ storage: createJSONStorage(() => ({ getItem: () => null, setItem: () => {}, removeItem: () => {} })) })
  // the app's default look, and none of the visitor's own data beside someone else's content
  useStore.setState({ chats: [chat], activeId: chat.id, panel: null, providers: [], actions: [], plugins: [], streaming: {}, settings: DEFAULT_SETTINGS })
}

export function SharedPage() {
  const id = location.pathname.split('/')[2]
  const worker = new URLSearchParams(location.search).get('w') ?? undefined
  const [data, setData] = useState<Shared | null>(null)
  const [chat, setChat] = useState<Chat | null>(null)
  const [err, setErr] = useState('')
  const [opening, setOpening] = useState(false)
  const panel = useStore((s) => s.panel)
  const setPanel = useStore((s) => s.setPanel)
  const [pw, setPw] = useState(640)

  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const theme = () => document.documentElement.classList.toggle('dark', mq.matches)
    theme()
    mq.addEventListener('change', theme)
    return () => mq.removeEventListener('change', theme)
  }, [])

  useEffect(() => {
    document.title = 'Shared chat · Koko Chat'
    fetchShared(id, worker).then(async (d) => {
      const c = sharedToChat(d.chat)
      await showInStore(c)
      setData(d); setChat(c)
      document.title = `${d.title} · Koko Chat`
    }).catch((e) => setErr(e.message))
  }, [id, worker])

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setPanel(null) }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [setPanel])

  const cont = async () => {
    if (!data) return
    setOpening(true)
    // bring the visitor's own data back before saving anything again
    useStore.setState({ chats: [], activeId: null, panel: null })
    useStore.persist.setOptions({ storage: saved })
    await useStore.persist.rehydrate()
    const copy = sharedToChat(data.chat)
    useStore.getState().importChats([copy])
    useStore.setState({ activeId: copy.id })
    setTimeout(() => { location.href = '/' }, 900) // let the debounced save reach IndexedDB
  }

  // which kind of provider each reply came from, for its model icon
  const presets = useMemo(() => Object.fromEntries((chat?.messages ?? []).map((m, i) => [m.id, data?.chat.messages[i]?.preset])), [chat, data])
  const artifact = panel?.kind === 'artifact' ? chat?.messages.find((m) => m.id === panel.messageId)?.artifacts?.find((a) => a.id === panel.artifactId) : undefined
  const latestUserId = [...(chat?.messages ?? [])].reverse().find((m) => m.role === 'user')?.id
  const startResize = (e: React.PointerEvent) => dragResize(e, (x) => clampWidth(innerWidth - x - 12, 360, Math.min(1100, innerWidth - 380)), setPw, 'koko:sharew')

  return (
    <ReadOnlyView.Provider value>
      <div className="relative z-10 flex h-full gap-3 p-3">
        <main className="relative flex min-w-0 flex-1 flex-col">
          <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center">
            <div className="glass-strong pointer-events-auto flex w-full max-w-3xl items-center gap-3 rounded-full py-1.5 pl-3 pr-1.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-accent text-accent-fg"><MessageCircle size={16} fill="currentColor" /></span>
              <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{data?.title ?? 'Shared chat'}</div>{data && <div className="truncate text-xs text-muted">Shared {new Date(data.created).toLocaleDateString()}{data.chat.model ? ` · ${data.chat.model}` : ''}</div>}</div>
              {chat && <button disabled={opening} onClick={cont} className="flex h-9 shrink-0 items-center gap-2 rounded-full bg-fg px-4 text-[13px] font-medium text-bg transition active:scale-95 disabled:opacity-60">{opening ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}<span className="hidden sm:inline">Continue in Koko Chat</span><span className="sm:hidden">Continue</span></button>}
            </div>
          </header>
          <div className="chat-scroll min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pb-20 pt-24">
              {!chat && !err && <div className="grid place-items-center py-24 text-sm text-muted"><Loader2 className="spin" /></div>}
              {err && <div className="mx-auto mt-16 max-w-sm rounded-3xl border border-line p-8 text-center"><div className="text-lg font-semibold">Can't show this chat</div><p className="mt-2 text-sm text-muted">{err}</p></div>}
              {chat?.system && <div className="rounded-2xl border border-line bg-surface-2/50 p-4 text-sm"><div className="mb-1 text-xs font-medium text-muted">Chat instructions</div><div className="whitespace-pre-wrap">{chat.system}</div></div>}
              {chat && !opening && toUnits(chat.messages).map((u) =>
                u.cmp
                  ? <CompareRow key={'g' + u.group} chatId={chat.id} items={u.msgs} last={false} readOnly presets={presets} />
                  : <MessageView key={u.m.id} chatId={chat.id} m={u.m} last={false} latestUser={u.m.id === latestUserId} readOnly sharedPreset={presets[u.m.id]} />,
              )}
              {chat && <p className="pt-6 text-center text-xs text-faint">This is a read-only snapshot shared from Koko Chat.</p>}
            </div>
          </div>
        </main>
        {panel && (artifact || panel.kind === 'sources') && (
          <div style={{ ['--pw' as any]: pw + 'px' }} className="fixed inset-3 z-40 lg:relative lg:inset-auto lg:z-20 lg:w-[var(--pw)] lg:shrink-0">
            <div onPointerDown={startResize} onDoubleClick={() => setPw(640)} className="resize-grip absolute -left-2.5 inset-y-6 z-10 hidden w-2 cursor-col-resize text-fg transition hover:text-accent lg:block" />
            {artifact ? <ArtifactPanel artifact={artifact} /> : <SourcesPanel messageId={panel.messageId} />}
          </div>
        )}
      </div>
      <Toasts />
    </ReadOnlyView.Provider>
  )
}
