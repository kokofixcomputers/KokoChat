import { useCallback, useEffect, useRef, useState } from 'react'
import { get as idbGet } from 'idb-keyval'
import { ArrowUp, Camera, Check, ChevronDown, ImagePlus, Loader2, X } from 'lucide-react'
import { koko } from '../lib/desktop'
import { cn } from '../lib/utils'
import { ModelIcon } from './ModelIcon'

interface Prov { id: string; name: string; preset: string; models: string[] }
interface Picked { providerId: string; model: string }

const LS = 'koko:quick-model'

/** Reads the app's saved data without loading the app (this window must never write to it). */
async function loadState(): Promise<{ providers: Prov[]; selected: Picked | null; theme: string; appearance: any }> {
  try {
    const raw = await idbGet('kokochat-v1')
    const st = raw ? JSON.parse(raw).state : null
    const providers: Prov[] = (st?.providers ?? []).map((p: any) => ({ id: p.id, name: p.name, preset: p.preset, models: (p.models ?? []).map((m: any) => m.id) })).filter((p: Prov) => p.models.length)
    return { providers, selected: st?.selected ?? null, theme: st?.settings?.theme ?? 'system', appearance: st?.settings?.appearance ?? {} }
  } catch { return { providers: [], selected: null, theme: 'system', appearance: {} } }
}

function applyLook(theme: string, a: any) {
  const el = document.documentElement
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  el.classList.toggle('dark', dark)
  if (a?.accent) el.dataset.accent = a.accent
  if (a?.palette) el.dataset.palette = a.palette
}

function Dot({ p }: { p: Prov }) {
  const [bad, setBad] = useState(false)
  return <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-white ring-1 ring-black/10">{bad ? <span className="text-[10px] font-bold text-neutral-600">{p.name[0]}</span> : <img src={`/providers/${p.preset}.svg`} alt="" onError={() => setBad(true)} className="h-3 w-3" />}</span>
}

export function QuickAsk() {
  const [provs, setProvs] = useState<Prov[]>([])
  const [pick, setPick] = useState<Picked | null>(null)
  const [text, setText] = useState('')
  const [image, setImage] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const [q, setQ] = useState('')
  const [note, setNote] = useState<{ kind: 'error' | 'permission'; text: string } | null>(null)
  const [capturing, setCapturing] = useState(false)
  const ta = useRef<HTMLTextAreaElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const k = koko()

  const refresh = useCallback(async () => {
    const s = await loadState()
    applyLook(s.theme, s.appearance)
    setProvs(s.providers)
    let last: Picked | null = null
    try { last = JSON.parse(localStorage.getItem(LS) ?? 'null') } catch { /* ignore */ }
    const ok = (p: Picked | null) => !!p && s.providers.some((x) => x.id === p.providerId && x.models.includes(p.model))
    setPick(ok(last) ? last : ok(s.selected) ? s.selected : s.providers[0] ? { providerId: s.providers[0].id, model: s.providers[0].models[0] } : null)
  }, [])

  useEffect(() => { void refresh(); return k?.quick.onShow(() => { void refresh(); setNote(null); setMenu(false); setTimeout(() => ta.current?.focus(), 30) }) }, [refresh, k])
  useEffect(() => { document.body.style.background = 'transparent'; setTimeout(() => ta.current?.focus(), 60) }, [])

  // keep the window as tall as its content
  useEffect(() => {
    const el = card.current
    if (!el) return
    const ro = new ResizeObserver(() => k?.quick.resize(el.offsetHeight + 40))
    ro.observe(el)
    return () => ro.disconnect()
  }, [k])
  useEffect(() => { const el = ta.current; if (el) { el.style.height = '0px'; el.style.height = Math.min(el.scrollHeight, 180) + 'px' } }, [text])

  const send = () => {
    const t = text.trim()
    if ((!t && !image) || !pick) return
    try { localStorage.setItem(LS, JSON.stringify(pick)) } catch { /* ignore */ }
    k?.quick.submit({ text: t, image: image ?? undefined, providerId: pick.providerId, model: pick.model })
    setText(''); setImage(null); setNote(null)
  }

  const capture = async () => {
    if (!k || capturing) return
    setCapturing(true); setNote(null)
    const r = await k.quick.capture()
    setCapturing(false)
    if (r.dataUrl) setImage(r.dataUrl)
    else if (r.error === 'permission') setNote({ kind: 'permission', text: 'Koko needs permission to record your screen. Turn it on for Koko in System Settings → Privacy & Security → Screen Recording, then restart Koko and try again.' })
    else if (r.error) setNote({ kind: 'error', text: `Could not take the screenshot: ${r.error}` })
    setTimeout(() => ta.current?.focus(), 30)
  }

  const addImage = (f: File) => { const rd = new FileReader(); rd.onload = () => setImage(String(rd.result)); rd.readAsDataURL(f) }

  const cur = provs.find((p) => p.id === pick?.providerId)
  const ql = q.trim().toLowerCase()

  return (
    <div className="p-5" onKeyDown={(e) => { if (e.key === 'Escape') { if (menu) setMenu(false); else k?.quick.hide() } }}>
      <div ref={card} className="glass-strong anim-pop relative overflow-visible rounded-[26px] p-3 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.45)] ring-1 ring-black/5 dark:ring-white/10">
        {image && (
          <div className="mb-2 flex px-1 pt-1">
            <div className="group relative">
              <img src={image} alt="Screenshot" className="max-h-28 max-w-[22rem] rounded-xl border border-line object-contain" />
              <button onClick={() => setImage(null)} title="Remove" className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-fg text-bg shadow"><X size={11} /></button>
            </div>
          </div>
        )}
        <textarea
          ref={ta} rows={1} autoFocus value={text} onChange={(e) => setText(e.target.value)}
          placeholder={provs.length ? (image ? 'Ask about this screenshot…' : 'Ask anything…') : 'Add a provider in Koko first'}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }}
          onPaste={(e) => { const f = [...e.clipboardData.files].find((x) => x.type.startsWith('image/')); if (f) { e.preventDefault(); addImage(f) } }}
          onDrop={(e) => { const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/')); if (f) { e.preventDefault(); addImage(f) } }}
          className="block max-h-44 w-full resize-none bg-transparent px-3 pb-1 pt-2 text-[17px] leading-relaxed placeholder:text-faint"
        />
        {note && <div className={cn('mx-2 mb-1 rounded-xl px-3 py-2 text-xs', note.kind === 'permission' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-danger/10 text-danger')}>{note.text}{note.kind === 'permission' && <button onClick={() => k?.quick.openScreenSettings()} className="ml-2 font-medium underline">Open settings</button>}</div>}
        <div className="flex items-center gap-1 pt-1">
          <button title="Capture part of the screen" onClick={capture} disabled={capturing} className="flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-muted transition hover:bg-fg/6 hover:text-fg active:scale-95 disabled:opacity-50">
            {capturing ? <Loader2 size={15} className="spin" /> : <Camera size={16} />}Capture area
          </button>
          <button title="Attach an image" onClick={() => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.onchange = () => i.files?.[0] && addImage(i.files[0]); i.click() }} className="grid h-9 w-9 place-items-center rounded-full text-muted transition hover:bg-fg/6 hover:text-fg active:scale-95"><ImagePlus size={16} /></button>
          <div className="relative min-w-0">
            <button onClick={() => setMenu((m) => !m)} disabled={!provs.length} className={cn('flex h-9 max-w-[15rem] items-center gap-2 rounded-full px-3 text-[13px] font-medium transition hover:bg-fg/6 disabled:opacity-40', menu && 'bg-fg/6')}>
              {cur && <Dot p={cur} />}<span className="truncate">{pick?.model ?? 'No model'}</span><ChevronDown size={14} className={cn('shrink-0 text-muted transition-transform', menu && 'rotate-180')} />
            </button>
          </div>
          <span className="min-w-0 flex-1" />
          <span className="hidden text-[11px] text-faint sm:block">↵ to send · Esc to close</span>
          <button onClick={send} disabled={(!text.trim() && !image) || !pick} title="Send and open in Koko" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-fg text-bg transition hover:scale-105 active:scale-95 disabled:opacity-30"><ArrowUp size={18} strokeWidth={2.4} /></button>
        </div>
        {menu && (
          <div className="anim-fade-up mt-2 border-t border-line px-1 pt-2">
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search models" className="mb-1 h-9 w-full rounded-full bg-fg/5 px-3.5 text-sm placeholder:text-faint" />
            <div className="max-h-52 overflow-y-auto">
              {provs.map((p) => {
                const ms = p.models.filter((m) => !ql || m.toLowerCase().includes(ql))
                if (!ms.length) return null
                return (
                  <div key={p.id}>
                    <div className="flex items-center gap-2 px-2.5 pb-1 pt-2 text-xs font-medium text-muted"><Dot p={p} />{p.name}</div>
                    {ms.map((m) => (
                      <button key={m} onClick={() => { setPick({ providerId: p.id, model: m }); setMenu(false); setQ(''); setTimeout(() => ta.current?.focus(), 20) }} className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-sm transition hover:bg-fg/5">
                        <ModelIcon model={m} preset={p.preset} name={p.name} size={20} /><span className="min-w-0 flex-1 truncate">{m}</span>{pick?.providerId === p.id && pick.model === m && <Check size={14} className="text-accent" />}
                      </button>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
