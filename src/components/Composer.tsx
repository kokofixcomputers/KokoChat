import { useEffect, useMemo, useRef, useState } from 'react'
import { Clock, ArrowUp, Brain, Mic, Loader2, CircleAlert, Check, Eraser, Globe, Hammer, Paperclip, Square, X, Shapes, Gauge } from 'lucide-react'
import { useStore } from '../store'
import { filesToAttachments, isImageFile, isTextFile } from '../lib/images'
import { getActions } from './actions'
import { FileText } from 'lucide-react'
import { supportsReasoning } from '../lib/providers'
import type { Attachment, Effort } from '../types'
import { Popover, Toggle } from './ui'
import { Server, ImageIcon, Terminal, Trash2, Telescope, Columns2, Video, MoreHorizontal } from 'lucide-react'
import { cn } from '../lib/utils'
import { toast } from '../lib/toast'
import { startDictation, type Dictation } from '../lib/speech'
import { ContextMeter } from './ContextMeter'
import { setCompare } from '../lib/compare'
import { SandboxStatus } from './SandboxStatus'
import { GithubMark } from './IntegrationCard'
import { Quote, BookText, ShieldAlert } from 'lucide-react'
import { PermissionPill } from './CodeUI'
import { FieldMenu } from './PromptFieldMenu'
import { PluginSlot } from './PluginSlot'
import { TodoPanel } from './TodoUI'
import { fillPrompt, expandSlash, promptFields, previewPrompt, usesInput, mainDefault } from '../lib/prompts'
import { dropKb, indexFile, isPdf } from '../lib/kb'
import { uid } from '../lib/utils'

function RecordingBar({ rec, onCancel }: { rec: Dictation | null; onCancel: () => void }) {
  const [bars, setBars] = useState<number[]>(() => Array(28).fill(0.08))
  const [sec, setSec] = useState(0)
  useEffect(() => {
    let raf = 0, last = 0
    const t0 = Date.now()
    const loop = (t: number) => {
      if (t - last > 60) {
        last = t
        const l = rec?.level() ?? 0
        setBars((b) => [...b.slice(1), Math.max(0.08, l)])
        setSec(Math.floor((Date.now() - t0) / 1000))
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [rec])
  return (
    <div className="anim-pop flex min-w-0 flex-1 items-center gap-3 pl-2 pr-3">
      <span className="relative flex h-2.5 w-2.5 shrink-0"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-60" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-danger" /></span>
      <span className="w-10 shrink-0 text-sm tabular-nums text-muted">{Math.floor(sec / 60)}:{String(sec % 60).padStart(2, '0')}</span>
      <div className="flex h-8 min-w-0 flex-1 items-center justify-center gap-[3px] overflow-hidden">
        {bars.map((v, i) => <span key={i} style={{ height: `${Math.round(v * 100)}%` }} className="w-[3px] shrink-0 rounded-full bg-fg/70 transition-[height] duration-75" />)}
      </div>
      <button onClick={onCancel} className="rounded-full px-3 py-1.5 text-[13px] font-medium text-muted transition hover:bg-fg/5 hover:text-fg">Cancel</button>
    </div>
  )
}

const EFFORTS: { v: Effort; label: string; d: string }[] = [
  { v: 'auto', label: 'Auto', d: 'Model default' },
  { v: 'minimal', label: 'Minimal', d: 'Fastest, barely thinks' },
  { v: 'low', label: 'Low', d: 'Quick reasoning' },
  { v: 'medium', label: 'Medium', d: 'Balanced' },
  { v: 'high', label: 'High', d: 'Deepest reasoning' },
]

export function Composer() {
  const { activeId, streaming, settings, setSettings, send, stop, clearChat, openSettings, providers, selected, mcpServers, updateMcp, quotes, removeQuote, clearQuotes, removeSandbox, chats } = useStore()
  const activeChat = chats.find((c) => c.id === activeId)
  const code = activeChat?.mode === 'code'
  const bypass = useStore((st) => !!activeId && st.codePerm[activeId] === 'bypass')
  const busy = !!(activeId && streaming[activeId])
  const queueAll = useStore((s) => s.queue)
  const queued = (activeId && queueAll[activeId]) || []
  const removeQueued = useStore((s) => s.removeQueued)
  const sendQueuedNow = useStore((s) => s.sendQueuedNow)
  const [text, setText] = useState('')
  const [files, setFiles] = useState<Attachment[]>([])
  const [drag, setDrag] = useState(false)
  const [indexing, setIndexing] = useState<Record<string, string>>({})
  const ta = useRef<HTMLTextAreaElement>(null)
  const [slashIdx, setSlashIdx] = useState(0)
  /** a slash command picked from the menu: shown as a container above the box, the text under it is its input */
  const [cmd, setCmd] = useState<{ promptId: string; fields: Record<string, string> } | null>(null)
  const cmdPrompt = cmd ? settings.prompts.find((p) => p.id === cmd.promptId) : undefined
  const cmdFields = cmdPrompt ? promptFields(cmdPrompt.text, cmdPrompt.fields) : []
  /** what each field will be: what you chose or typed, or its default */
  const cmdValues = Object.fromEntries(cmdFields.map((f) => [f.key, (cmd?.fields[f.key]?.trim() || f.def).trim()] as const))
  const slashQ = /^\/([\w-]*)$/.exec(text)?.[1]
  type SlashItem = { id: string; slash: string; label: string; icon: React.ReactNode; run: () => void; prompt?: boolean }
  const slash: SlashItem[] = slashQ === undefined ? [] : [
    ...settings.prompts.filter((p) => p.slash.startsWith(slashQ.toLowerCase()) || (slashQ.length > 1 && p.name.toLowerCase().includes(slashQ.toLowerCase()))).map((p) => ({
      id: 'p' + p.id, slash: p.slash, label: p.name, icon: <BookText size={16} />, prompt: true,
      run: () => { setCmd({ promptId: p.id, fields: {} }); setTimeout(() => ta.current?.focus(), 0) },
    })),
    ...getActions().filter((a) => a.slash && a.slash.startsWith(slashQ.toLowerCase()) && !settings.prompts.some((p) => p.slash === a.slash)).map((a) => ({ id: a.id, slash: a.slash!, label: a.label, icon: a.icon, run: a.run })),
  ]
  useEffect(() => setSlashIdx(0), [slashQ])
  const runSlash = (i: number) => { const a = slash[i]; if (!a) return; setText(''); a.run() }
  const [phase, setPhase] = useState<'idle' | 'recording' | 'transcribing'>('idle')
  const [rec, setRec] = useState<Dictation | null>(null)
  const [voiceErr, setVoiceErr] = useState('')

  const startRec = async () => {
    setVoiceErr('')
    try { const d = await startDictation(settings, providers); setRec(d); setPhase('recording') }
    catch (e: any) { setVoiceErr(e.message) }
  }
  const cancelRec = () => { rec?.cancel(); setRec(null); setPhase('idle') }
  const finishRec = async () => {
    if (!rec) return
    setPhase('transcribing')
    try {
      const t = await rec.stop()
      if (t) setText((x) => (x.trim() ? x.replace(/\s*$/, ' ') : '') + t)
      else setVoiceErr('Did not catch anything. Try again.')
    } catch (e: any) { setVoiceErr(e.message) }
    setRec(null); setPhase('idle')
    setTimeout(() => ta.current?.focus(), 0)
  }
  useEffect(() => () => rec?.cancel(), [rec])
  const fileInput = useRef<HTMLInputElement>(null)

  const provider = providers.find((p) => p.id === selected?.providerId)
  const reasoning = !!provider && !!selected && supportsReasoning(provider, selected.model)

  useEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = Math.min(el.scrollHeight, 240) + 'px'
  }, [text])
  useEffect(() => { ta.current?.focus() }, [activeId])
  useEffect(() => { const f = (e: Event) => { setText(String((e as CustomEvent).detail ?? '')); setTimeout(() => ta.current?.focus(), 0) }; window.addEventListener('koko:set-input', f); return () => window.removeEventListener('koko:set-input', f) }, [])
  const pluginDraft = useMemo(() => ({ text, chatId: activeId, files: files.length }), [text, activeId, files.length])
  const root = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const el = root.current
    if (!el) return
    const ro = new ResizeObserver(() => setNarrow(el.offsetWidth < 700))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => { const f = () => ta.current?.focus(); window.addEventListener('koko:focus-composer', f); return () => window.removeEventListener('koko:focus-composer', f) }, [])

  const addFiles = async (list: FileList | File[]) => {
    const ok = [...list].filter((f) => isImageFile(f) || isTextFile(f) || isPdf(f))
    if (!ok.length) return toast.error('Only images, PDFs and text/code files are supported')
    for (const f of ok) {
      // PDFs and long documents are indexed so the AI searches them instead of reading everything every time
      if (isPdf(f) || (isTextFile(f) && f.size > 24_000)) {
        const key = uid()
        setIndexing((x) => ({ ...x, [key]: `${f.name}|Reading` }))
        try {
          const meta = await indexFile(f, { chat: activeId ?? undefined }, (st) => setIndexing((x) => ({ ...x, [key]: `${f.name}|${st}` })))
          setFiles((x) => [...x, { id: uid(), name: f.name, mime: meta.mime, dataUrl: '', kind: 'text', text: '', kbId: meta.id }])
        } catch (e: any) { toast.error(`${f.name}: ${e.message}`) }
        setIndexing((x) => { const n = { ...x }; delete n[key]; return n })
      } else {
        const atts = await filesToAttachments([f])
        setFiles((x) => [...x, ...atts])
      }
    }
  }

  const mainDef = cmdPrompt ? mainDefault(cmdPrompt.text) : ''
  const needsInput = !cmdPrompt || (usesInput(cmdPrompt.text) && !mainDef)
  const submit = () => {
    let t = text.trim()
    if (((!t && !files.length) && needsInput) || Object.keys(indexing).length) return
    if (cmd && cmdPrompt) {
      // every field is recorded with the value that was actually used (what you typed, or its default), so the history shows it
      const fields = Object.fromEntries(Object.entries(cmdValues).filter(([, v]) => v))
      send(fillPrompt(cmdPrompt.text, t, cmdValues), files, quotes, { slash: cmdPrompt.slash, name: cmdPrompt.name, input: t || mainDef, ...(Object.keys(fields).length ? { fields } : {}) })
      setText(''); setFiles([]); clearQuotes(); setCmd(null)
      return
    }
    const expanded = expandSlash(t, settings.prompts)
    if (expanded) t = expanded
    if (settings.searchEnabled && !settings.tavilyKey) { /* search silently unavailable until key set */ }
    send(t, files, quotes)
    setText(''); setFiles([]); clearQuotes()
  }

  const pill = (active: boolean) =>
    cn('flex h-9 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium transition active:scale-95', active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-fg/5 hover:text-fg')

  return (
    <div
      ref={root}
      data-tour="composer"
      onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files) }}
      className={cn('glass-strong relative rounded-[28px] p-2.5 transition-all focus-within:ring-2 focus-within:ring-accent/30', drag && 'ring-2 ring-accent')}
    >
      {code && activeId && <TodoPanel chatId={activeId} />}
      {bypass && activeId && (
        <div className="anim-pop mx-1 mb-2 flex items-center gap-2 rounded-2xl bg-danger/10 px-3.5 py-2 text-[13px] text-danger"><ShieldAlert size={15} className="shrink-0" /><span className="flex-1">Permissions are bypassed: the AI can run commands and change files without asking.</span><button onClick={() => useStore.getState().setCodePerm(activeId, 'ask')} className="shrink-0 rounded-full bg-danger/15 px-3 py-1 text-xs font-medium transition hover:bg-danger/25">Turn off</button></div>
      )}
      {queued.length > 0 && (
        <div className="flex flex-col gap-1.5 px-2 pb-2 pt-1">
          {queued.map((q) => (
            <div key={q.id} className="anim-pop group flex items-center gap-2.5 rounded-2xl bg-surface-2/70 py-1.5 pl-3 pr-1.5 ring-1 ring-line">
              <Clock size={13} className="shrink-0 text-accent" />
              <span className="shrink-0 text-xs font-medium text-muted">Queued</span>
              <p className="min-w-0 flex-1 truncate text-[13px]">{q.cmd ? `/${q.cmd.slash} ` : ''}{q.cmd ? q.cmd.input : q.text}{q.attachments.length ? ` · ${q.attachments.length} file${q.attachments.length === 1 ? '' : 's'}` : ''}</p>
              <button onClick={() => activeId && removeQueued(activeId, q.id)} title="Remove from the queue" className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-faint transition hover:bg-fg/8 hover:text-fg"><X size={13} /></button>
            </div>
          ))}
          <div className="flex items-center gap-2 px-1 text-[11px] text-faint"><span>Sent after the next step, or when the AI finishes.</span>{!busy && <button onClick={() => activeId && sendQueuedNow(activeId)} className="font-medium text-accent hover:underline">Send now</button>}</div>
        </div>
      )}
      {quotes.length > 0 && (
        <div className="flex flex-col gap-1.5 px-2 pb-2 pt-1">
          {quotes.map((q, i) => (
            <div key={i} className="anim-pop group flex items-start gap-2.5 rounded-2xl bg-surface-2/70 py-2 pl-3 pr-2 ring-1 ring-line">
              <span className="mt-0.5 w-0.5 shrink-0 self-stretch rounded-full bg-accent" />
              <Quote size={13} className="mt-1 shrink-0 text-accent" />
              <p className="line-clamp-2 min-w-0 flex-1 text-[13px] leading-snug text-muted">{q}</p>
              <button onClick={() => removeQuote(i)} title="Remove quote" className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-faint transition hover:bg-fg/8 hover:text-fg"><X size={13} /></button>
            </div>
          ))}
        </div>
      )}
      {(files.length > 0 || Object.keys(indexing).length > 0) && (
        <div className="flex flex-wrap gap-2 px-2 pb-2 pt-1">
          {Object.entries(indexing).map(([k, v]) => (
            <div key={k} className="anim-pop flex h-16 max-w-48 items-center gap-2.5 rounded-2xl border border-line bg-surface-2/70 px-3.5"><Loader2 size={18} className="spin shrink-0 text-accent" /><div className="min-w-0"><div className="truncate text-[13px] font-medium">{v.split('|')[0]}</div><div className="shimmer text-xs font-medium">{v.split('|')[1]}…</div></div></div>
          ))}
          {files.map((f) => (
            <div key={f.id} className="anim-pop group relative">
              {f.kind === 'text' ? (
                <div className="flex h-16 max-w-48 items-center gap-2.5 rounded-2xl border border-line bg-surface-2/70 px-3.5"><FileText size={18} className="shrink-0 text-accent" /><div className="min-w-0"><div className="truncate text-[13px] font-medium">{f.name}</div><div className="text-xs text-muted">{f.kbId ? 'Indexed for search' : `${Math.max(1, Math.round((f.text?.length ?? 0) / 1000))} KB text`}</div></div></div>
              ) : <img src={f.dataUrl} alt={f.name} className="h-16 w-16 rounded-2xl border border-line object-cover" />}
              <button onClick={() => { if (f.kbId) void dropKb([f.kbId]); setFiles((x) => x.filter((y) => y.id !== f.id)) }} className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-fg text-bg opacity-0 shadow transition group-hover:opacity-100"><X size={11} /></button>
            </div>
          ))}
        </div>
      )}
      {cmd && cmdPrompt && (
        <div className="anim-pop mx-1 mb-1 rounded-2xl bg-accent-soft/60 p-2.5 ring-1 ring-accent/25">
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-accent px-2 py-0.5 font-mono text-[13px] font-semibold text-accent-fg">/{cmdPrompt.slash}</span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{cmdPrompt.name}</span>
            <button onClick={() => { setCmd(null); ta.current?.focus() }} title="Remove command (Backspace on an empty box)" className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted transition hover:bg-fg/8 hover:text-fg"><X size={13} /></button>
          </div>
          {cmdFields.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {cmdFields.map((f) => f.kind === 'select' ? (
                <FieldMenu key={f.key} label={f.key.replace(/[-_]/g, ' ')} value={cmd.fields[f.key] ?? ''} options={f.options} def={f.def} onChange={(v) => setCmd({ ...cmd, fields: { ...cmd.fields, [f.key]: v } })} />
              ) : (
                <label key={f.key} className="flex min-w-0 items-center gap-2 rounded-xl bg-surface/80 px-2.5 py-1.5 ring-1 ring-line focus-within:ring-accent/50">
                  <span className="text-xs font-medium capitalize text-muted">{f.key.replace(/[-_]/g, ' ')}</span>
                  <input value={cmd.fields[f.key] ?? ''} onChange={(e) => setCmd({ ...cmd, fields: { ...cmd.fields, [f.key]: e.target.value } })} placeholder={f.def || 'optional'} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ta.current?.focus() } }} className="w-28 min-w-0 bg-transparent text-[13px] outline-none placeholder:text-faint" />
                </label>
              ))}
            </div>
          )}
          <p className="mt-2 line-clamp-2 text-xs leading-snug text-faint">{previewPrompt(cmdPrompt.text, cmdValues)}</p>
        </div>
      )}
      <textarea
        ref={ta} rows={1} value={text} onChange={(e) => {
          const v = e.target.value
          const m = /^\/([\w-]+)\s$/.exec(v)
          const hit = !cmd && m ? settings.prompts.find((p) => p.slash === m[1].toLowerCase()) : undefined
          if (hit) { setCmd({ promptId: hit.id, fields: {} }); setText(''); return } // "/translate " becomes the container
          setText(v)
        }}
        placeholder={cmd ? (mainDef || (needsInput ? 'Type or paste the text here…' : 'Add details (optional)…')) : code ? 'Ask Koko Code to build, fix or explain something…' : settings.compare.enabled ? `Ask ${settings.compare.models.length} models at once…` : 'Enter a message here, press ⏎ to send'}
        onKeyDown={(e) => {
          if (slash.length) {
            if (e.key === 'ArrowDown') { e.preventDefault(); return setSlashIdx((i) => (i + 1) % slash.length) }
            if (e.key === 'ArrowUp') { e.preventDefault(); return setSlashIdx((i) => (i - 1 + slash.length) % slash.length) }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); return runSlash(slashIdx) }
            if (e.key === 'Escape') { setText(''); return }
          }
          if (cmd && e.key === 'Backspace' && !text && e.currentTarget.selectionStart === 0) { e.preventDefault(); setCmd(null); return }
          if (cmd && e.key === 'Escape') { setCmd(null); return }
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() } }}
        onPaste={(e) => { const f = [...e.clipboardData.files]; if (f.some((x) => isImageFile(x) || isTextFile(x) || isPdf(x))) { e.preventDefault(); addFiles(f) } }}
        className="block max-h-60 w-full resize-none bg-transparent px-3 pb-1 pt-2 text-[length:calc(15.5px*var(--tx,1))] leading-relaxed placeholder:text-faint"
      />
      {slash.length > 0 && (
        <div className="glass-strong anim-pop absolute inset-x-2 bottom-full z-50 mb-2 max-h-72 overflow-y-auto rounded-2xl p-1.5">
          <div className="px-2.5 pb-1 pt-1 text-xs font-medium text-muted">Prompts and commands</div>
          {slash.map((a, i) => (
            <button key={a.id} onMouseEnter={() => setSlashIdx(i)} onClick={() => runSlash(i)} className={cn('flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm', i === slashIdx && 'bg-fg/6')}>
              <span className={a.prompt ? 'text-muted' : 'text-accent'}>{a.icon}</span><span className="font-mono text-[13px] text-muted">/{a.slash}</span><span className="truncate">{a.label}</span>
            </button>
          ))}
        </div>
      )}
      {voiceErr && (
        <div className="anim-pop mx-2 mb-1 flex items-start gap-2 rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger"><CircleAlert size={14} className="mt-px shrink-0" /><span className="flex-1">{voiceErr}</span><button onClick={() => setVoiceErr('')}><X size={13} /></button></div>
      )}
      <div className="flex items-center justify-between pt-1">
        {phase === 'recording' && <RecordingBar rec={rec} onCancel={cancelRec} />}
        {phase === 'transcribing' && <div className="anim-pop flex items-center gap-2 pl-3 text-sm text-muted"><Loader2 size={15} className="spin" /><span className="shimmer font-medium">Transcribing…</span></div>}
        <div className={cn('flex min-w-0 items-center gap-0.5', phase !== 'idle' && 'hidden')}>
          <input ref={fileInput} type="file" accept="image/*,.pdf,application/pdf,text/*,.md,.json,.csv,.tsv,.yaml,.yml,.xml,.log,.sql,.sh,.py,.js,.jsx,.ts,.tsx,.go,.rs,.java,.c,.cpp,.cs,.php,.rb,.toml" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }} />
          <button title="Attach images or files" className={pill(false)} onClick={() => fileInput.current?.click()}><Paperclip size={17} /></button>

          {!narrow && <>
          <button
            title={settings.tavilyKey ? 'Toggle web search' : 'Web search needs a Tavily key'}
            className={pill(settings.searchEnabled && !!settings.tavilyKey)}
            onClick={() => (settings.tavilyKey ? setSettings({ searchEnabled: !settings.searchEnabled }) : openSettings('tools'))}
          >
            <Globe size={17} />{settings.searchEnabled && settings.tavilyKey && <span className="hidden sm:inline">Search</span>}
          </button>

          {!code && (<button
            title={settings.compare.enabled ? `Compare mode: ${settings.compare.models.length} models answer every message (click to turn off)` : 'Compare: ask several models at once'}
            className={pill(settings.compare.enabled)}
            onClick={() => setCompare()}
          >
            <Columns2 size={17} />{settings.compare.enabled && <span className="tabular-nums">{settings.compare.models.length}<span className="hidden sm:inline"> models</span></span>}
          </button>)}
          {!code && (<button
            title={settings.deepResearch ? 'Deep research: on (click to turn off)' : 'Deep research: many searches, then a cited report'}
            className={cn(pill(settings.deepResearch && !!settings.tavilyKey), 'max-sm:hidden')}
            onClick={() => (settings.tavilyKey ? setSettings({ deepResearch: !settings.deepResearch, ...(settings.deepResearch ? {} : { searchEnabled: true }) }) : openSettings('tools'))}
          >
            <Telescope size={17} />{settings.deepResearch && settings.tavilyKey && <span className="hidden sm:inline">Research</span>}
          </button>)}
          <button
            title={settings.image.enabled ? 'Image generation: on (click to turn off)' : 'Image generation: off (click to turn on)'}
            className={cn(pill(settings.image.enabled), 'max-sm:hidden')}
            onClick={() => setSettings({ image: { ...settings.image, enabled: !settings.image.enabled } })}
          >
            <ImageIcon size={17} />{settings.image.enabled && <span className="hidden sm:inline">Image</span>}
          </button>
          {!code && (<button
            title={settings.video.enabled ? 'Video generation: on (click to turn off)' : 'Video generation: off (click to turn on)'}
            className={cn(pill(settings.video.enabled), 'max-sm:hidden')}
            onClick={() => setSettings({ video: { ...settings.video, enabled: !settings.video.enabled } })}
          >
            <Video size={17} />{settings.video.enabled && <span className="hidden sm:inline">Video</span>}
          </button>)}
          </>}

          {code && activeId && <PermissionPill chatId={activeId} />}
          {narrow && (
            <Popover button={(open, toggle) => <button title="More options" onClick={toggle} className={pill(open)}><MoreHorizontal size={17} /></button>}>
              {(close) => (
                <div className="w-72 max-w-full">
                  {([
                    { icon: <Globe size={17} />, label: 'Web search', on: settings.searchEnabled && !!settings.tavilyKey, run: () => (settings.tavilyKey ? setSettings({ searchEnabled: !settings.searchEnabled }) : openSettings('tools')), show: true },
                    { icon: <Columns2 size={17} />, label: 'Compare models', on: settings.compare.enabled, run: () => setCompare(), show: !code },
                    { icon: <Telescope size={17} />, label: 'Deep research', on: settings.deepResearch && !!settings.tavilyKey, run: () => (settings.tavilyKey ? setSettings({ deepResearch: !settings.deepResearch, ...(settings.deepResearch ? {} : { searchEnabled: true }) }) : openSettings('tools')), show: !code },
                    { icon: <ImageIcon size={17} />, label: 'Image generation', on: settings.image.enabled, run: () => setSettings({ image: { ...settings.image, enabled: !settings.image.enabled } }), show: true },
                    { icon: <Video size={17} />, label: 'Video generation', on: settings.video.enabled, run: () => setSettings({ video: { ...settings.video, enabled: !settings.video.enabled } }), show: !code },
                  ]).filter((r) => r.show).map((r) => (
                    <div key={r.label} className="flex items-center gap-3 rounded-xl px-2.5 py-2"><span className="text-accent">{r.icon}</span><span className="flex-1 text-sm font-medium">{r.label}</span><Toggle on={r.on} onChange={r.run} /></div>
                  ))}
                  <div className="mt-1 border-t border-line px-2.5 pb-1 pt-2 text-xs font-medium text-muted"><span className="inline-flex items-center gap-1.5"><Gauge size={13} />Reasoning effort{!reasoning && <span className="ml-1 font-normal text-faint">(not used by this model)</span>}</span></div>
                  <div className="flex flex-wrap gap-1.5 px-2 pb-1.5">
                    {EFFORTS.map((e) => <button key={e.v} onClick={() => setSettings({ effort: e.v })} title={e.d} className={cn('rounded-full px-3 py-1 text-[13px] transition', settings.effort === e.v ? 'bg-fg text-bg' : 'bg-fg/6 text-muted hover:bg-fg/10')}>{e.label}</button>)}
                  </div>
                  <button disabled={!activeId} onClick={() => { close(); activeId && clearChat(activeId) }} className="flex w-full items-center gap-2 rounded-xl border-t border-line px-2.5 py-2.5 text-left text-sm text-muted transition hover:bg-fg/5 disabled:opacity-40"><Eraser size={15} />Clear this chat</button>
                </div>
              )}
            </Popover>
          )}
          {!narrow && <Popover button={(open, toggle) => (
            <button title="Reasoning effort" onClick={toggle} className={pill(open || settings.effort !== 'auto')}>
              <Brain size={17} />{settings.effort !== 'auto' && <span className="hidden capitalize sm:inline">{settings.effort}</span>}
            </button>
          )}>
            {(close) => (
              <div className="w-60">
                <div className="flex items-center gap-2 px-2.5 pb-1.5 pt-1.5 text-xs font-medium text-muted"><Gauge size={13} />Reasoning effort{!reasoning && <span className="ml-auto text-faint">not used by this model</span>}</div>
                {EFFORTS.map((e) => (
                  <button key={e.v} onClick={() => { setSettings({ effort: e.v }); close() }} className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition hover:bg-fg/5">
                    <span className="flex-1"><span className="block text-sm font-medium">{e.label}</span><span className="block text-xs text-muted">{e.d}</span></span>
                    {settings.effort === e.v && <Check size={15} className="text-accent" />}
                  </button>
                ))}
              </div>
            )}
          </Popover>}

          <Popover button={(open, toggle) => <button data-tour="tools" title="Tools" onClick={toggle} className={pill(open)}><Hammer size={17} /></button>}>
            <div className="w-72 max-w-full">
              <div className="px-2.5 pb-1.5 pt-1.5 text-xs font-medium text-muted">Tools the AI can use</div>
              <div className="flex items-center gap-3 rounded-xl px-2.5 py-2">
                <Globe size={18} className="text-accent" />
                <span className="flex-1"><span className="block text-sm font-medium">Web search</span><span className="block text-xs text-muted">{settings.tavilyKey ? 'Powered by Tavily' : <button className="text-accent underline" onClick={() => openSettings('tools')}>Add a Tavily key</button>}</span></span>
                <Toggle on={settings.searchEnabled && !!settings.tavilyKey} onChange={(b) => (settings.tavilyKey ? setSettings({ searchEnabled: b }) : openSettings('tools'))} />
              </div>
              {!code && (<><div className="flex items-center gap-3 rounded-xl px-2.5 py-2">
                <Shapes size={18} className="text-accent" />
                <span className="flex-1"><span className="block text-sm font-medium">Artifacts</span><span className="block text-xs text-muted">Pages, charts, SVG and docs</span></span>
                <Toggle on={settings.artifactsEnabled} onChange={(b) => setSettings({ artifactsEnabled: b })} />
              </div>
              </>)}<div className="flex items-center gap-3 rounded-xl px-2.5 py-2">
                <ImageIcon size={18} className="text-accent" />
                <span className="flex-1"><span className="block text-sm font-medium">Image generation</span><span className="block text-xs text-muted">{settings.image.model}</span></span>
                <Toggle on={settings.image.enabled} onChange={(b) => setSettings({ image: { ...settings.image, enabled: b } })} />
              </div>
              {!code && (<><div className="flex items-center gap-3 rounded-xl px-2.5 py-2">
                <Video size={18} className="text-accent" />
                <span className="flex-1"><span className="block text-sm font-medium">Video generation</span><span className="block text-xs text-muted">{settings.video.model}</span></span>
                <Toggle on={settings.video.enabled} onChange={(b) => setSettings({ video: { ...settings.video, enabled: b } })} />
              </div>
              <div className="flex items-center gap-3 rounded-xl px-2.5 py-2">
                <GithubMark size={18} />
                <span className="flex-1"><span className="block text-sm font-medium">GitHub</span><span className="block text-xs text-muted">{settings.integrations.github.token ? 'Private repos enabled' : 'Public repositories'}</span></span>
                <Toggle on={settings.integrations.github.enabled} onChange={(b) => setSettings({ integrations: { ...settings.integrations, github: { ...settings.integrations.github, enabled: b } } })} />
              </div>
              <div className="flex items-center gap-3 rounded-xl px-2.5 py-2">
                <Telescope size={18} className="text-accent" />
                <span className="flex-1"><span className="block text-sm font-medium">Deep research</span><span className="block text-xs text-muted">Many searches, then a cited report</span></span>
                <Toggle on={settings.deepResearch && !!settings.tavilyKey} onChange={(b) => (settings.tavilyKey ? setSettings({ deepResearch: b, ...(b ? { searchEnabled: true } : {}) }) : openSettings('tools'))} />
              </div>
              <div className="flex items-center gap-3 rounded-xl px-2.5 py-2">
                <Terminal size={18} className="text-accent" />
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium">Sandbox</span><span className="block truncate text-xs text-muted">{settings.sandbox.apiKey ? (activeChat?.sandbox ? `VM ${activeChat.sandbox.slug}` : 'Linux VM for commands & deploys') : <button className="text-accent underline" onClick={() => openSettings('tools')}>Add a Freestyle key</button>}</span></span>
                {activeChat?.sandbox && <button title="Delete this chat's VM" onClick={() => activeId && removeSandbox(activeId)} className="grid h-7 w-7 place-items-center rounded-full text-faint hover:bg-danger/10 hover:text-danger"><Trash2 size={14} /></button>}
                <Toggle on={settings.sandbox.enabled && !!settings.sandbox.apiKey} onChange={(b) => (settings.sandbox.apiKey ? setSettings({ sandbox: { ...settings.sandbox, enabled: b } }) : openSettings('tools'))} />
              </div>
              </>)}{mcpServers.map((s) => (
                <div key={s.id} className="flex items-center gap-3 rounded-xl px-2.5 py-2">
                  <Server size={18} className="text-accent" />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{s.name}</span><span className="block text-xs text-muted">{s.tools.length ? `MCP · ${s.tools.length} tools` : 'MCP · not connected'}</span></span>
                  <Toggle on={s.enabled} onChange={(b) => updateMcp(s.id, { enabled: b })} />
                </div>
              ))}
              <button onClick={() => openSettings('mcp')} className="mt-1 w-full rounded-xl border-t border-line px-2.5 py-2 text-left text-xs text-accent hover:bg-fg/5">Manage MCP servers…</button>
              <button disabled={!activeId} onClick={() => activeId && clearChat(activeId)} className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs text-muted hover:bg-fg/5 sm:hidden"><Eraser size={14} />Clear this chat</button>
            </div>
          </Popover>

          <PluginSlot name="composer.toolbar" data={pluginDraft} className="flex items-center gap-0.5" />
          {!narrow && <button title="Clear this chat" className={cn(pill(false), 'max-sm:hidden')} disabled={!activeId} onClick={() => activeId && clearChat(activeId)}><Eraser size={17} /></button>}
          {!code && !narrow && <SandboxStatus />}
        </div>
        <div className="flex shrink-0 items-center gap-1">
        <PluginSlot name="composer.status" data={pluginDraft} className="flex items-center gap-2 pr-1" />
        <ContextMeter draft={{ text, fileChars: files.reduce((a, f) => a + (f.text?.length ?? 0), 0), images: files.filter((f) => f.kind !== 'text').length }} />
        {(() => {
          const hasInput = !!text.trim() || files.length > 0 || (!!cmd && !needsInput)
          const mode = busy && !hasInput ? 'stop' : phase === 'recording' ? 'done' : phase === 'transcribing' ? 'wait' : hasInput ? 'send' : 'mic'
          return (
            <>
            {busy && hasInput && <button key="stop2" title="Stop" onClick={() => activeId && stop(activeId)} className="anim-pop grid h-10 w-10 shrink-0 place-items-center rounded-full bg-fg/10 text-fg transition hover:bg-fg/15 active:scale-95"><Square size={13} fill="currentColor" /></button>}
            <button
              key={mode}
              data-tour="send"
              onClick={() => (mode === 'stop' && activeId ? stop(activeId) : mode === 'done' ? finishRec() : mode === 'mic' ? startRec() : mode === 'send' ? submit() : undefined)}
              disabled={mode === 'wait'}
              title={{ stop: 'Stop', done: 'Done', wait: 'Transcribing', send: busy ? 'Queue: it is sent after the next step, or when the AI finishes' : 'Send', mic: 'Dictate' }[mode]}
              className={cn('anim-pop grid h-10 w-10 shrink-0 place-items-center rounded-full transition hover:scale-105 active:scale-95', mode === 'done' ? 'bg-accent text-accent-fg' : 'bg-fg text-bg', mode === 'wait' && 'opacity-50')}
            >
              {mode === 'stop' ? <Square size={14} fill="currentColor" /> : mode === 'done' ? <Check size={19} strokeWidth={2.6} /> : mode === 'wait' ? <Loader2 size={17} className="spin" /> : mode === 'send' ? <ArrowUp size={19} strokeWidth={2.4} /> : <Mic size={18} />}
            </button>
            </>
          )
        })()}
        </div>
      </div>
    </div>
  )
}
