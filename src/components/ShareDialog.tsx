import { useEffect, useMemo, useState } from 'react'
import { Check, CircleAlert, Cloud, Copy, ExternalLink, Link2, Loader2, Trash2, X } from 'lucide-react'
import { useStore } from '../store'
import { DEFAULT_SHARE_OPTIONS, createShare, inventory, revokeShare, shareLink, estimateShareSize, type ShareOptions } from '../lib/share'
import { cn, fmtBytes } from '../lib/utils'
import { toast } from '../lib/toast'
import { Segmented } from './ui'

function Box({ on }: { on: boolean }) {
  return (
    <span className={cn('grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[6px] border-[1.5px] transition-all duration-150', on ? 'border-accent bg-accent text-accent-fg' : 'border-faint/60 bg-surface')}>
      {on && <Check size={12} strokeWidth={3.2} className="anim-pop" />}
    </span>
  )
}

function Row({ on, onChange, label, hint, count, disabled }: { on: boolean; onChange: (b: boolean) => void; label: string; hint?: string; count?: number; disabled?: boolean }) {
  return (
    <button
      role="checkbox" aria-checked={on && !disabled} disabled={disabled} onClick={() => onChange(!on)}
      className={cn('flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition', disabled ? 'opacity-40' : 'hover:bg-fg/5 active:scale-[0.995]')}
    >
      <Box on={on && !disabled} />
      <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{label}</span>{hint && <span className="block text-xs text-muted">{hint}</span>}</span>
      {count !== undefined && <span className="rounded-full bg-fg/8 px-2 py-0.5 text-xs tabular-nums text-muted">{count || 'none'}</span>}
    </button>
  )
}

export function ShareDialog() {
  const [open, setOpen] = useState(false)
  const { chats, activeId, sync, openSettings } = useStore()
  const chat = chats.find((c) => c.id === activeId)
  const [o, setO] = useState<ShareOptions>(DEFAULT_SHARE_OPTIONS)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [fresh, setFresh] = useState<string | null>(null)

  useEffect(() => {
    const f = () => { setOpen(true); setErr(''); setFresh(null); setO((x) => ({ ...x, upToMessageId: undefined })) }
    window.addEventListener('koko:share', f)
    return () => window.removeEventListener('koko:share', f)
  }, [])
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open])

  const inv = useMemo(() => (chat ? inventory(chat, o.upToMessageId) : null), [chat?.messages, o.upToMessageId]) // eslint-disable-line
  const size = useMemo(() => (chat ? estimateShareSize(chat, o) : 0), [chat?.messages, o]) // eslint-disable-line
  if (!open || !chat || !inv) return null

  const set = (p: Partial<ShareOptions>) => setO((x) => ({ ...x, ...p }))
  const free = sync.usage ? sync.usage.quota - sync.usage.used : Infinity
  const tooBig = size > free
  const userMsgs = chat.messages.filter((m) => m.role === 'user' && m.text).slice(-30)
  const create = async () => {
    setBusy(true); setErr('')
    try { const e = await createShare(chat, o, chat.model ?? useStore.getState().selected?.model); setFresh(e.id); toast.success('Share link created') }
    catch (e: any) { setErr(e.message) }
    setBusy(false)
  }
  const copy = (id: string) => { navigator.clipboard.writeText(shareLink(id)); toast.success('Link copied') }

  return (
    <div className="fixed inset-0 z-[110] grid place-items-center overflow-y-auto bg-black/35 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="glass-strong anim-pop relative my-auto w-full max-w-lg rounded-[28px] p-5 sm:p-6">
        <button onClick={() => setOpen(false)} className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full text-faint transition hover:bg-fg/5 hover:text-fg"><X size={16} /></button>
        <div className="mb-1 flex items-center gap-2.5"><span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-soft text-accent"><Link2 size={17} /></span>
          <div className="min-w-0"><h2 className="text-lg font-semibold tracking-tight">Share chat</h2><p className="truncate text-xs text-muted">{chat.title}</p></div></div>

        {!sync.token ? (
          <div className="mt-5 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line p-6 text-center">
            <Cloud size={22} className="text-muted" />
            <p className="text-sm text-muted">Shared links are hosted by your sync server. Sign in to sync first.</p>
            <button onClick={() => { setOpen(false); openSettings('sync') }} className="h-10 rounded-full bg-fg px-5 text-sm font-medium text-bg active:scale-95">Set up sync</button>
          </div>
        ) : (
          <>
            <p className="mb-3 mt-3 text-sm text-muted">Anyone with the link can read a snapshot of this chat. You can turn it off any time. Choose what to include:</p>

            <label className="mb-2 block text-xs font-medium text-muted">Share
              <select value={o.upToMessageId ?? ''} onChange={(e) => set({ upToMessageId: e.target.value || undefined })} className="mt-1 h-10 w-full appearance-none rounded-xl border border-line bg-surface-2/60 px-3.5 text-sm text-fg focus:border-accent/60">
                <option value="">Entire conversation ({chat.messages.length} messages)</option>
                {userMsgs.map((m) => <option key={m.id} value={m.id}>Up to: {(m.text ?? '').replace(/\s+/g, ' ').slice(0, 52)}</option>)}
              </select>
            </label>

            <div className="-mx-1 flex flex-col">
              <Row on={o.artifacts} onChange={(b) => set({ artifacts: b })} label="Generated artifacts" hint="Pages, charts, diagrams, documents and code" count={inv.artifacts} disabled={!inv.artifacts} />
              <Row on={o.generatedImages} onChange={(b) => set({ generatedImages: b })} label="Generated images" count={inv.generatedImages} disabled={!inv.generatedImages} />
              <Row on={o.attachedImages} onChange={(b) => set({ attachedImages: b })} label="Images you attached" count={inv.attachedImages} disabled={!inv.attachedImages} />
              <Row on={o.attachedFiles} onChange={(b) => set({ attachedFiles: b })} label="Files you attached" hint="Text and code files" count={inv.attachedFiles} disabled={!inv.attachedFiles} />
              <Row on={o.sources} onChange={(b) => set({ sources: b })} label="Web sources" hint="Citations and the source list" count={inv.sources} disabled={!inv.sources} />
              <Row on={o.reasoning} onChange={(b) => set({ reasoning: b })} label="AI reasoning" hint="The collapsible “thought” sections" count={inv.reasoning} disabled={!inv.reasoning} />
              <Row on={o.modelNames} onChange={(b) => set({ modelNames: b })} label="Model names" />
              <Row on={o.instructions} onChange={(b) => set({ instructions: b })} label="Chat instructions" hint="Your custom instructions for this chat" disabled={!chat.system?.trim()} />
            </div>
            <p className="mt-1 px-1 text-xs text-faint">Tool calls, tool results and your API keys are never shared.</p>

            <div className="mt-4 flex items-center justify-between gap-3">
              <span className="text-sm font-medium">Link expires</span>
              <Segmented value={String(o.expiresInDays)} onChange={(v) => set({ expiresInDays: +v })} options={[{ value: '0', label: 'Never' }, { value: '1', label: '1 day' }, { value: '7', label: '7 days' }, { value: '30', label: '30 days' }]} />
            </div>

            <div className={cn('mt-4 flex items-center justify-between rounded-xl px-3 py-2 text-xs', tooBig ? 'bg-danger/10 text-danger' : 'bg-fg/5 text-muted')}>
              <span>About {fmtBytes(size)} · counts toward your cloud storage</span>
              {sync.usage && <span className="tabular-nums">{fmtBytes(Math.max(0, free))} free</span>}
            </div>
            {err && <div className="mt-3 flex items-start gap-2 rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger"><CircleAlert size={14} className="mt-px shrink-0" />{err}</div>}

            {fresh && (
              <div className="anim-fade-up mt-4 flex items-center gap-2 rounded-2xl border border-accent/40 bg-accent-soft p-2 pl-3.5">
                <input readOnly value={shareLink(fresh)} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 bg-transparent font-mono text-xs" />
                <button onClick={() => copy(fresh)} className="flex h-8 items-center gap-1.5 rounded-full bg-fg px-3 text-[13px] font-medium text-bg active:scale-95"><Copy size={13} />Copy</button>
              </div>
            )}

            <button disabled={busy || tooBig} onClick={create} className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-fg text-sm font-medium text-bg transition active:scale-[0.98] disabled:opacity-40">
              {busy ? <><Loader2 size={15} className="spin" />Creating link…</> : <><Link2 size={15} />{fresh ? 'Create another link' : 'Create link'}</>}
            </button>

            {!!chat.shares?.length && (
              <div className="mt-5 border-t border-line pt-4">
                <div className="mb-2 text-xs font-medium text-muted">Links for this chat</div>
                <div className="flex flex-col gap-1.5">
                  {chat.shares.map((s) => (
                    <div key={s.id} className="flex items-center gap-2 rounded-xl bg-fg/5 py-1.5 pl-3 pr-1.5 text-[13px]">
                      <span className="min-w-0 flex-1 truncate text-muted">{new Date(s.created).toLocaleDateString()}{s.expires ? ` · expires ${new Date(s.expires).toLocaleDateString()}` : ''}{s.size ? ` · ${fmtBytes(s.size)}` : ''}</span>
                      <button title="Copy link" onClick={() => copy(s.id)} className="grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-fg/8 hover:text-fg"><Copy size={13} /></button>
                      <a title="Open" href={shareLink(s.id)} target="_blank" rel="noreferrer" className="grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-fg/8 hover:text-fg"><ExternalLink size={13} /></a>
                      <button title="Turn off this link" onClick={() => revokeShare(chat.id, s.id).then(() => toast.success('Link turned off')).catch((e) => toast.error(e.message))} className="grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-danger/10 hover:text-danger"><Trash2 size={13} /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
