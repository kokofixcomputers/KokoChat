import { useEffect, useState } from 'react'
import { ChevronRight, FileText, Loader2, MessageCircle, Sparkles } from 'lucide-react'
import { fetchShared, sharedToChat, type SharedChat, type SMessage } from '../lib/share'
import { useStore } from '../store'
import { Markdown } from './Markdown'
import { ArtifactPreview } from './ArtifactPanel'
import { kindIcon } from './Blocks'
import { cn } from '../lib/utils'

function Artifact({ a }: { a: NonNullable<SMessage['artifacts']>[number] }) {
  const [open, setOpen] = useState(true)
  const tall = a.kind === 'html' || a.kind === 'diagram' || a.kind === 'slides' || a.kind === 'chart' || a.kind === 'svg'
  return (
    <div className="overflow-hidden rounded-3xl border border-line bg-surface shadow-sm">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent-soft text-accent">{kindIcon(a.kind, 16)}</span>
        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{a.title}</span><span className="block text-xs capitalize text-muted">{a.kind === 'html' ? 'web page' : a.kind}</span></span>
        <ChevronRight size={15} className={cn('text-faint transition-transform', open && 'rotate-90')} />
      </button>
      {open && <div className={cn('border-t border-line', tall ? 'h-[480px]' : 'max-h-[560px] overflow-auto')}><ArtifactPreview artifact={a} /></div>}
    </div>
  )
}

function Message({ m }: { m: SMessage }) {
  if (m.role === 'user') {
    const imgs = (m.attachments ?? []).filter((a) => a.kind === 'image')
    const files = (m.attachments ?? []).filter((a) => a.kind === 'text')
    return (
      <div className="flex flex-col items-end gap-2">
        {(imgs.length > 0 || files.length > 0) && (
          <div className="flex flex-wrap justify-end gap-2">
            {imgs.map((a, i) => <img key={i} src={a.dataUrl} alt={a.name} className="max-h-56 max-w-xs rounded-2xl border border-line object-cover" />)}
            {files.map((a, i) => <div key={i} className="flex items-center gap-2 rounded-2xl border border-line bg-surface-2 px-3.5 py-2 text-[13px]"><FileText size={16} className="text-accent" />{a.name}</div>)}
          </div>
        )}
        {m.quotes?.map((q, i) => <div key={i} className="flex max-w-[85%] gap-2.5 rounded-2xl bg-surface-2/60 py-2 pl-3 pr-4 ring-1 ring-line"><span className="w-0.5 shrink-0 rounded-full bg-accent" /><p className="line-clamp-4 whitespace-pre-wrap text-[13px] leading-snug text-muted">{q}</p></div>)}
        {m.text && <div className="max-w-[85%] whitespace-pre-wrap rounded-[22px] rounded-br-lg bg-surface-2 px-4 py-2.5 text-[15.5px] leading-relaxed ring-1 ring-line">{m.text}</div>}
      </div>
    )
  }
  const arts = new Map((m.artifacts ?? []).map((a) => [a.id, a]))
  return (
    <div className="flex flex-col gap-3">
      {(m.blocks ?? []).map((b, i) =>
        b.type === 'text' ? <Markdown key={i} text={b.text} sources={m.sources} />
        : b.type === 'reasoning' ? <details key={i} className="group text-sm text-muted"><summary className="cursor-pointer select-none font-medium hover:text-fg">Thoughts</summary><div className="ml-1 mt-1 border-l-2 border-line pl-4"><Markdown text={b.text} small /></div></details>
        : arts.get(b.id) ? <Artifact key={i} a={arts.get(b.id)!} /> : null,
      )}
      {m.sources && m.sources.length > 0 && (
        <details className="text-sm"><summary className="cursor-pointer select-none text-xs font-medium text-muted hover:text-fg">{m.sources.length} sources</summary>
          <div className="mt-2 flex flex-col gap-1">{m.sources.map((s) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="flex gap-2 rounded-xl px-2 py-1.5 text-[13px] hover:bg-fg/5"><span className="mt-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-accent-soft px-1 text-[11px] font-semibold text-accent">{s.n}</span><span className="min-w-0"><span className="block truncate font-medium">{s.title}</span><span className="block truncate text-xs text-muted">{s.domain}</span></span></a>)}</div></details>
      )}
      {m.model && <span className="text-xs text-faint">{m.model}</span>}
    </div>
  )
}

export function SharedPage() {
  const id = location.pathname.split('/')[2]
  const worker = new URLSearchParams(location.search).get('w') ?? undefined
  const [data, setData] = useState<{ title: string; created: number; expires: number | null; chat: SharedChat } | null>(null)
  const [err, setErr] = useState('')
  const [opening, setOpening] = useState(false)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', matchMedia('(prefers-color-scheme: dark)').matches)
    document.title = 'Shared chat · Koko Chat'
    fetchShared(id, worker).then((d) => { setData(d); document.title = `${d.title} · Koko Chat` }).catch((e) => setErr(e.message))
  }, [id, worker])

  const cont = async () => {
    if (!data) return
    setOpening(true)
    await new Promise<void>((res) => (useStore.persist.hasHydrated() ? res() : void useStore.persist.onFinishHydration(() => res())))
    const chat = sharedToChat(data.chat)
    useStore.getState().importChats([chat])
    useStore.setState({ activeId: chat.id })
    setTimeout(() => { location.href = '/' }, 900) // let the debounced save reach IndexedDB
  }

  return (
    <div className="h-full overflow-y-auto bg-bg text-fg">
      <header className="sticky top-0 z-10 flex justify-center px-3 pt-3">
        <div className="glass-strong flex w-full max-w-3xl items-center gap-3 rounded-full py-1.5 pl-3 pr-1.5">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent text-accent-fg"><MessageCircle size={16} fill="currentColor" /></span>
          <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{data?.title ?? 'Shared chat'}</div>{data && <div className="truncate text-xs text-muted">Shared {new Date(data.created).toLocaleDateString()}{data.chat.model ? ` · ${data.chat.model}` : ''}</div>}</div>
          {data && <button disabled={opening} onClick={cont} className="flex h-9 items-center gap-2 rounded-full bg-fg px-4 text-[13px] font-medium text-bg transition active:scale-95 disabled:opacity-60">{opening ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}Continue in Koko Chat</button>}
        </div>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 pb-24 pt-10">
        {!data && !err && <div className="grid place-items-center py-24 text-sm text-muted"><Loader2 className="spin" /></div>}
        {err && <div className="mx-auto mt-16 max-w-sm rounded-3xl border border-line p-8 text-center"><div className="text-lg font-semibold">Can't show this chat</div><p className="mt-2 text-sm text-muted">{err}</p></div>}
        {data?.chat.instructions && <div className="rounded-2xl border border-line bg-surface-2/50 p-4 text-sm"><div className="mb-1 text-xs font-medium text-muted">Chat instructions</div><div className="whitespace-pre-wrap">{data.chat.instructions}</div></div>}
        {data?.chat.messages.map((m, i) => <Message key={i} m={m} />)}
        {data && <p className="pt-6 text-center text-xs text-faint">This is a read-only snapshot shared from Koko Chat.</p>}
      </main>
    </div>
  )
}
