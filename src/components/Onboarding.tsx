import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowRight, Check, CircleAlert, Cloud, Globe, ImageIcon, Loader2, MessageCircle, Mic, Shapes, X, Workflow } from 'lucide-react'
import { useStore } from '../store'
import { OneMinSignIn } from './OneMinSignIn'
import { PRESETS, fetchModels, makeProvider, presetOf } from '../lib/providers'
import type { ModelInfo, Provider } from '../types'
import { ProviderDot } from './TopBar'
import { cn } from '../lib/utils'

const FLAG = 'koko:onboarded'
const getFlag = () => { try { return localStorage.getItem(FLAG) === 'true' } catch { return false } }
const setFlag = () => { try { localStorage.setItem(FLAG, 'true') } catch { /* ignore */ } }

type Step = 'welcome' | 'provider' | 'tour'

const field = 'h-11 w-full rounded-2xl border border-line bg-surface-2/60 px-4 text-sm transition placeholder:text-faint focus:border-accent/60 focus:bg-surface'

/* ------------------------------ tour ------------------------------ */
const TOUR: { target?: string; title: string; text: string }[] = [
  { target: 'model', title: 'Pick your model', text: 'Switch models any time. The list is fetched live from your provider, so new models show up automatically.' },
  { target: 'composer', title: 'Ask anything', text: 'Type here, paste or drop images and text files, or start with / for quick commands.' },
  { target: 'tools', title: 'Give the AI tools', text: 'Turn on web search (add a Tavily key in Settings), artifacts, image generation and your MCP servers. The AI will also ask you questions instead of guessing.' },
  { target: 'send', title: 'Talk instead of typing', text: 'With an empty box this becomes a mic. Dictate, tweak the text, then send.' },
  { target: 'newchat', title: 'Your chats live here', text: 'Search every message, pin or rename chats, and fork a conversation from any reply.' },
  { target: 'settings', title: 'Make it yours', text: 'Providers, voice, themes, and syncing across devices live in Settings. Press ⌘K anywhere for the command palette.' },
]

interface Rect { x: number; y: number; w: number; h: number }

function useTarget(name?: string, active = true) {
  const [rect, setRect] = useState<Rect | null>(null)
  useLayoutEffect(() => {
    if (!name || !active) { setRect(null); return }
    let raf = 0
    const tick = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${name}"]`)
      const r = el?.getBoundingClientRect()
      if (r && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight) setRect((p) => (p && Math.abs(p.x - r.x) < 0.5 && Math.abs(p.y - r.y) < 0.5 && Math.abs(p.w - r.width) < 0.5 && Math.abs(p.h - r.height) < 0.5 ? p : { x: r.x, y: r.y, w: r.width, h: r.height }))
      else setRect(null)
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [name, active])
  return rect
}

function Tour({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  // skip steps whose element is not on screen (e.g. sidebar hidden on small screens)
  const [i, setI] = useState(0)
  const step = TOUR[i]
  const rect = useTarget(step?.target, i < TOUR.length)
  const last = i >= TOUR.length
  const pad = 8
  const W = 340

  useEffect(() => {
    if (!step?.target) return
    const t = setTimeout(() => {
      if (!document.querySelector(`[data-tour="${step.target}"]`)) setI((x) => x + 1)
    }, 120)
    return () => clearTimeout(t)
  }, [i]) // eslint-disable-line

  if (last)
    return (
      <div className="fixed inset-0 z-[300] grid place-items-center bg-black/55 p-4 backdrop-blur-sm">
        <div className="glass-strong anim-pop w-full max-w-sm rounded-[28px] p-7 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-accent text-accent-fg"><Check size={26} strokeWidth={3} /></div>
          <h2 className="text-xl font-semibold tracking-tight">You're all set</h2>
          <p className="mt-2 text-sm text-muted">Say hi, or try: "make a flowchart of how login works" or "draw a cute penguin".</p>
          <button onClick={onDone} className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-fg text-sm font-medium text-bg transition active:scale-[0.98]">Start chatting</button>
        </div>
      </div>
    )

  // tooltip placement
  let style: React.CSSProperties
  if (rect) {
    const below = rect.y + rect.h + pad + 200 < innerHeight
    const left = Math.min(Math.max(12, rect.x + rect.w / 2 - W / 2), innerWidth - W - 12)
    style = below ? { left, top: rect.y + rect.h + pad + 14 } : { left, bottom: innerHeight - rect.y + pad + 14 }
  } else style = { left: Math.max(12, innerWidth / 2 - W / 2), top: innerHeight / 2 - 100 }

  return (
    <div className="fixed inset-0 z-[300]">
      {/* click-catcher so the app underneath isn't touched */}
      <div className="absolute inset-0" />
      {rect ? (
        <div
          className="pointer-events-none absolute rounded-2xl ring-2 ring-accent/80 transition-all duration-300 ease-out"
          style={{ left: rect.x - pad, top: rect.y - pad, width: rect.w + pad * 2, height: rect.h + pad * 2, boxShadow: '0 0 0 9999px rgba(0,0,0,0.58)' }}
        />
      ) : <div className="absolute inset-0 bg-black/55" />}
      <div key={i} className="glass-strong anim-pop absolute rounded-3xl p-5 transition-all duration-300" style={{ width: Math.min(W, innerWidth - 24), ...style }}>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-accent">{i + 1} of {TOUR.length}</span>
          <button onClick={onDone} className="text-xs text-faint transition hover:text-fg">Skip tour</button>
        </div>
        <h3 className="text-[15px] font-semibold tracking-tight">{step.title}</h3>
        <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{step.text}</p>
        <div className="mt-4 flex items-center justify-between">
          <div className="flex gap-1.5">{TOUR.map((_, k) => <span key={k} className={cn('h-1.5 rounded-full transition-all', k === i ? 'w-4 bg-accent' : 'w-1.5 bg-fg/20')} />)}</div>
          <div className="flex gap-2">
            <button onClick={() => (i === 0 ? onBack() : setI(i - 1))} className="h-9 rounded-full px-3.5 text-[13px] font-medium text-muted transition hover:bg-fg/5 hover:text-fg">Back</button>
            <button onClick={() => setI(i + 1)} className="flex h-9 items-center gap-1.5 rounded-full bg-fg px-4 text-[13px] font-medium text-bg transition active:scale-95">Next<ArrowRight size={14} /></button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* --------------------------- provider step ------------------------- */
function ProviderStep({ onNext, onBack, onSkip }: { onNext: () => void; onBack: () => void; onSkip: () => void }) {
  const { addProvider, select } = useStore()
  const [preset, setPreset] = useState<string | null>(null)
  const [key, setKey] = useState('')
  const [base, setBase] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [draft, setDraft] = useState<Provider | null>(null)
  const [model, setModel] = useState('')
  const pr = preset ? presetOf(preset) : null
  const needsBase = !!pr && (pr.id === 'custom' || !pr.baseUrl)

  const choose = (id: string) => { setPreset(id); setBase(presetOf(id).baseUrl); setKey(''); setErr(''); setDraft(null) }

  const connect = async (withKey?: string) => {
    if (!pr) return
    setBusy(true); setErr('')
    const p: Provider = { ...makeProvider(pr.id), apiKey: (withKey ?? key).trim(), baseUrl: (base || pr.baseUrl).trim() }
    try {
      const models: ModelInfo[] = await fetchModels(p)
      if (!models.length) throw new Error('Connected, but this provider returned no models.')
      p.models = models; p.modelsFetchedAt = Date.now()
      setDraft(p); setModel((models.find((m) => !/embed|whisper|tts|moderation|dall-e|image|rerank|transcribe|audio|realtime/i.test(m.id)) ?? models[0]).id)
    } catch (e: any) {
      setErr(/Failed to fetch/i.test(e.message) ? 'Could not reach the server. Check the key/URL, and that the provider allows browser requests (CORS).' : /401|403|incorrect|invalid/i.test(e.message) ? 'That key was rejected. Double-check it and try again.' : e.message)
    }
    setBusy(false)
  }
  const finish = () => { if (!draft) return; addProvider(draft); select(draft.id, model); onNext() }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Connect a provider</h2>
        <p className="mt-1 text-sm text-muted">Choose where your AI models come from. Your key stays in this browser (and is only synced if you turn sync on).</p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {PRESETS.map((p) => (
          <button key={p.id} onClick={() => choose(p.id)} className={cn('flex items-center gap-2.5 rounded-2xl border p-2.5 text-left transition active:scale-95', preset === p.id ? 'border-accent/60 bg-accent-soft' : 'border-line bg-surface/60 hover:border-faint/60')}>
            <ProviderDot preset={p.id} name={p.name} size={28} />
            <span className="min-w-0 truncate text-[13px] font-medium">{p.name.replace(' (OpenAI-compatible)', '')}</span>
          </button>
        ))}
      </div>

      {pr && !draft && (
        <div className="anim-fade-up flex flex-col gap-3">
          {pr.id === '1minrelay' && <OneMinSignIn onKey={(k) => { setKey(k); return connect(k) }} />}
          {needsBase && <input value={base} onChange={(e) => setBase(e.target.value)} placeholder="Base URL, e.g. https://example.com/v1" className={cn(field, 'font-mono')} />}
          <input
            type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)}
            placeholder={pr.keyOptional ? 'API key (optional)' : `${pr.name} API key`} onKeyDown={(e) => e.key === 'Enter' && !busy && connect()}
            className={cn(field, 'font-mono')} autoFocus
          />
          {pr.hint && <div className="-mt-1 text-xs text-faint">{pr.hint}</div>}
          {err && <div className="flex items-start gap-2 rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger"><CircleAlert size={14} className="mt-px shrink-0" />{err}</div>}
          <button disabled={busy || (!pr.keyOptional && !key.trim()) || (needsBase && !base.trim())} onClick={() => connect()} className="flex h-11 items-center justify-center gap-2 rounded-full bg-fg text-sm font-medium text-bg transition active:scale-[0.98] disabled:opacity-40">
            {busy ? <><Loader2 size={15} className="spin" />Checking…</> : 'Connect'}
          </button>
        </div>
      )}

      {draft && (
        <div className="anim-fade-up flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-accent"><span className="grid h-5 w-5 place-items-center rounded-full bg-accent text-accent-fg"><Check size={12} strokeWidth={3.5} /></span>Connected · {draft.models.length} models found</div>
          <label className="text-xs font-medium text-muted">Default model
            <select value={model} onChange={(e) => setModel(e.target.value)} className={cn(field, 'mt-1.5 appearance-none font-mono')}>
              {draft.models.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
            </select>
          </label>
          <button onClick={finish} className="flex h-11 items-center justify-center gap-2 rounded-full bg-fg text-sm font-medium text-bg transition active:scale-[0.98]">Continue<ArrowRight size={15} /></button>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-line pt-4 text-sm">
        <button onClick={onBack} className="text-muted transition hover:text-fg">Back</button>
        <button onClick={onSkip} className="text-muted transition hover:text-fg">Skip for now</button>
      </div>
    </div>
  )
}

/* ------------------------------ welcome ---------------------------- */
const FEATURES = [
  { icon: <Globe size={14} />, label: 'Web search' }, { icon: <Shapes size={14} />, label: 'Artifacts' }, { icon: <Workflow size={14} />, label: 'Diagrams' },
  { icon: <ImageIcon size={14} />, label: 'Images' }, { icon: <Mic size={14} />, label: 'Voice' }, { icon: <Cloud size={14} />, label: 'Sync' },
]

function Welcome({ onStart, onSync, onSkip }: { onStart: () => void; onSync: () => void; onSkip: () => void }) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="anim-fade-up mb-5 grid h-16 w-16 place-items-center rounded-3xl bg-accent text-accent-fg"><MessageCircle size={30} fill="currentColor" /></div>
      <h1 className="anim-fade-up text-2xl font-semibold tracking-tight" style={{ animationDelay: '50ms' }}>Welcome to Koko Chat</h1>
      <p className="anim-fade-up mt-2 max-w-sm text-sm leading-relaxed text-muted" style={{ animationDelay: '100ms' }}>Bring your own models and keys. Chat, search the web, build artifacts and diagrams, generate images, and sync everything across devices.</p>
      <div className="anim-fade-up mt-5 flex flex-wrap justify-center gap-2" style={{ animationDelay: '150ms' }}>
        {FEATURES.map((f) => <span key={f.label} className="flex items-center gap-1.5 rounded-full bg-fg/6 px-3 py-1.5 text-[13px] text-muted"><span className="text-accent">{f.icon}</span>{f.label}</span>)}
      </div>
      <button onClick={onStart} className="anim-fade-up mt-7 flex h-12 w-full max-w-xs items-center justify-center gap-2 rounded-full bg-fg text-sm font-medium text-bg transition hover:scale-[1.02] active:scale-[0.98]" style={{ animationDelay: '200ms' }}>Get started<ArrowRight size={16} /></button>
      <div className="anim-fade-up mt-4 flex flex-col items-center gap-1.5 text-sm" style={{ animationDelay: '250ms' }}>
        <button onClick={onSync} className="flex items-center gap-1.5 text-muted transition hover:text-fg"><Cloud size={14} />Already use Koko Chat? Sign in to sync</button>
        <button onClick={onSkip} className="text-faint transition hover:text-fg">Skip setup</button>
      </div>
    </div>
  )
}

/* ------------------------------- root ------------------------------ */
export function Onboarding() {
  const [step, setStep] = useState<Step | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    if (!getFlag()) {
      const s = useStore.getState()
      // someone who already has providers (or is signed in to sync) doesn't need setup
      if (s.providers.length > 0 || s.sync.token) setFlag()
      else setStep('welcome')
    }
    const open = () => setStep('welcome')
    window.addEventListener('koko:onboarding', open)
    return () => window.removeEventListener('koko:onboarding', open)
  }, [])

  const done = () => { setFlag(); setStep(null) }
  if (!step) return null

  if (step === 'tour') return <Tour onDone={done} onBack={() => setStep('provider')} />

  return (
    <div className="fixed inset-0 z-[300] grid place-items-center overflow-y-auto bg-black/45 p-4 backdrop-blur-md">
      <div className="glass-strong anim-pop relative my-auto w-full max-w-lg rounded-[32px] p-6 sm:p-8">
        <button onClick={done} title="Skip setup" className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full text-faint transition hover:bg-fg/5 hover:text-fg"><X size={16} /></button>
        <div className="mb-5 flex justify-center gap-1.5">
          {(['welcome', 'provider', 'tour'] as Step[]).map((s) => <span key={s} className={cn('h-1.5 rounded-full transition-all', s === step ? 'w-6 bg-accent' : 'w-1.5 bg-fg/20')} />)}
        </div>
        {step === 'welcome' && (
          <Welcome
            onStart={() => setStep('provider')}
            onSync={() => { done(); useStore.getState().openSettings('sync') }}
            onSkip={done}
          />
        )}
        {step === 'provider' && <ProviderStep onNext={() => setStep('tour')} onBack={() => setStep('welcome')} onSkip={() => setStep('tour')} />}
      </div>
    </div>
  )
}

export const replayOnboarding = () => window.dispatchEvent(new Event('koko:onboarding'))
