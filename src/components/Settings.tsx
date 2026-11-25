import { useEffect, useState } from 'react'
import { MigrationSection } from './Migration'
import { askConfirm } from '../lib/confirm'
import { del as idbDel } from 'idb-keyval'
import { Check, ChevronDown, Eye, EyeOff, KeyRound, Loader2, Monitor, Moon, Plug, Plus, RefreshCw, Sun, Trash2, X, Wrench, SlidersHorizontal, CircleAlert, Globe, Server, ShieldCheck, Mic, Volume2, Square, ImageIcon, Cloud, Terminal, Puzzle, BarChart3, BookText, Video, Code2 } from 'lucide-react'
import { useStore } from '../store'
import { PRESETS, cfBase, fetchProviderModels, makeProvider, presetOf } from '../lib/providers'
import type { McpServer, Provider } from '../types'
import { listMcpTools } from '../lib/mcp'
import { authorize } from '../lib/mcpAuth'
import { OPENAI_VOICES, STT_SUGGESTIONS, TTS_SUGGESTIONS, pickProvider, speak, stopSpeaking } from '../lib/speech'
import { uid } from '../lib/utils'
import { toast } from '../lib/toast'
import { fmtBytes } from '../lib/utils'
import { PublishedSettings } from './PublishMenu'
import { AdminPanel } from './AdminPanel'
import { exportChatsJson } from '../lib/exporter'
import { IMAGE_MODEL_SUGGESTIONS, imageProviderPref } from '../lib/imagegen'
import { VIDEO_MODEL_SUGGESTIONS } from '../lib/videogen'
import { testGithub } from '../lib/integrations/github'
import { BrandTile } from './IntegrationCard'
import { connectGoogle, disconnectGoogle, useGoogle } from '../lib/integrations/google'
import { deleteCloudData, markAllDirty, normalizeUrl, requestCode, signOut, syncNow, verifyCode } from '../lib/sync'
import { IconButton, Segmented, Toggle } from './ui'
import { UsageDashboard } from './UsageDashboard'
import { isDesktop } from '../lib/desktop'
import { ModelSelect } from './ModelSelect'
import { DEFAULT_PROMPTS, slugify } from '../lib/prompts'
import { PromptEditor } from './PromptBuilder'
import { PluginsSettings } from './PluginsSettings'
import { MemorySettings } from './MemoryUI'
import { QuickAskSettings } from './QuickAskSettings'
import { OneMinSignIn } from './OneMinSignIn'
import { NotificationSettings } from './NotificationSettings'
import { Blocks, Brain } from 'lucide-react'
import type { AppearanceSettings, Prompt } from '../types'
import { ProviderDot } from './TopBar'
import { cn } from '../lib/utils'

const field = 'h-10 w-full rounded-xl border border-line bg-surface-2/60 px-3.5 text-sm transition placeholder:text-faint focus:border-accent/60 focus:bg-surface'

function SecretInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <KeyRound size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
      <input type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete="off" spellCheck={false} className={cn(field, 'pl-10 pr-10 font-mono')} />
      <button onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-faint hover:text-fg">{show ? <EyeOff size={15} /> : <Eye size={15} />}</button>
    </div>
  )
}

function ProviderCard({ p, open, toggle }: { p: Provider; open: boolean; toggle: () => void }) {
  const { updateProvider, removeProvider, select, selected } = useStore()
  const preset = presetOf(p.preset)
  const [state, setState] = useState<{ busy?: boolean; err?: string; ok?: number }>({})
  const needsKey = !preset.keyOptional && !p.apiKey
  const refresh = async (pp: Provider = p) => {
    setState({ busy: true })
    try {
      const { models, embedModels } = await fetchProviderModels(pp)
      updateProvider(p.id, { models, ...(embedModels ? { embedModels } : {}), modelsFetchedAt: Date.now() })
      setState({ ok: models.length })
      if (!selected && models[0]) select(p.id, models[0].id)
    } catch (e: any) {
      setState({ err: /Failed to fetch/i.test(e.message) ? 'Network/CORS error — check the base URL and that the server allows browser requests.' : e.message })
    }
  }
  return (
    <div className={cn('overflow-hidden rounded-2xl border border-line bg-surface/50 transition', open && 'bg-surface/80')}>
      <button onClick={toggle} className="flex w-full items-center gap-3 p-3 text-left">
        <ProviderDot preset={p.preset} name={p.name} size={32} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{p.name}</span>
          <span className="block truncate text-xs text-muted">{needsKey ? 'API key required' : p.models.length ? `${p.models.length} models${p.embedModels?.length ? ` · ${p.embedModels.length} embedding` : ''}` : 'No models fetched yet'} · {p.apiMode === 'responses' ? 'Responses API' : p.apiMode === 'anthropic' ? 'Messages API' : 'Chat Completions'}</span>
        </span>
        {needsKey && <CircleAlert size={16} className="text-amber-500" />}
        <ChevronDown size={16} className={cn('text-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="anim-fade-up flex flex-col gap-3 border-t border-line p-3.5">
          <label className="text-xs font-medium text-muted">Name<input value={p.name} onChange={(e) => updateProvider(p.id, { name: e.target.value })} className={cn(field, 'mt-1')} /></label>
          {p.preset === '1minrelay' && <OneMinSignIn compact onKey={async (key) => { updateProvider(p.id, { apiKey: key }); await refresh({ ...p, apiKey: key }) }} />}
          <div className="text-xs font-medium text-muted">API key{preset.keyOptional && ' (optional)'}
            <div className="mt-1"><SecretInput value={p.apiKey} onChange={(v) => updateProvider(p.id, { apiKey: v })} placeholder={p.preset === 'openai' ? 'sk-...' : 'API key'} /></div>
          </div>
          {preset.account && (
            <label className="text-xs font-medium text-muted">Account ID
              <input value={p.accountId ?? ''} onChange={(e) => { const id = e.target.value.trim(); updateProvider(p.id, { accountId: id, baseUrl: cfBase(id) }) }} placeholder="32-character account ID" spellCheck={false} className={cn(field, 'mt-1 font-mono')} />
              <span className="mt-1.5 block font-normal text-faint">Find it in the Cloudflare dashboard (Workers AI → Use REST API). Create an API token with the “Workers AI” permission and paste it above.</span>
            </label>
          )}
          {preset.account ? null : (p.preset === 'custom' || !preset.baseUrl) ? (
            <label className="text-xs font-medium text-muted">Base URL<input value={p.baseUrl} onChange={(e) => updateProvider(p.id, { baseUrl: e.target.value })} placeholder="https://example.com/v1" className={cn(field, 'mt-1 font-mono')} /></label>
          ) : (
            <details className="text-xs text-muted">
              <summary className="cursor-pointer select-none font-medium">Advanced</summary>
              <label className="mt-2 block font-medium">Base URL<input value={p.baseUrl} onChange={(e) => updateProvider(p.id, { baseUrl: e.target.value })} className={cn(field, 'mt-1 font-mono')} /></label>
            </details>
          )}
          {p.preset === 'custom' ? (
            <div className="flex flex-col gap-1.5">
              <div className="text-xs font-medium text-muted">API shape</div>
              <Segmented value={p.apiMode} onChange={(v) => updateProvider(p.id, { apiMode: v })} options={[{ value: 'responses', label: 'OpenAI Responses' }, { value: 'chat', label: 'OpenAI Chat' }, { value: 'anthropic', label: 'Anthropic' }]} />
              <p className="text-xs text-faint">{p.apiMode === 'anthropic' ? 'Messages API: POST {base}/messages, key sent as x-api-key.' : p.apiMode === 'chat' ? 'Chat Completions: POST {base}/chat/completions with a Bearer key. The most widely supported shape.' : 'Responses API: POST {base}/responses with a Bearer key.'}</p>
            </div>
          ) : p.apiMode !== 'anthropic' && <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-medium text-muted">API format</div>
            <Segmented value={p.apiMode} onChange={(v) => updateProvider(p.id, { apiMode: v })} options={[{ value: 'responses', label: 'Responses' }, { value: 'chat', label: 'Chat Completions' }]} />
          </div>}
          {p.preset !== 'openai' && (
            <div className="flex items-center justify-between gap-3">
              <div><div className="text-sm font-medium">Always send reasoning effort</div><div className="text-xs text-muted">Enable if this endpoint's models support it</div></div>
              <Toggle on={!!p.forceReasoning} onChange={(b) => updateProvider(p.id, { forceReasoning: b })} />
            </div>
          )}
          <div className="flex items-center gap-2">
            <button disabled={state.busy || (needsKey) || !p.baseUrl} onClick={() => refresh()} className="flex h-9 items-center gap-2 rounded-full bg-fg px-4 text-sm font-medium text-bg transition active:scale-95 disabled:opacity-40">
              {state.busy ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}Fetch models
            </button>
            <span className="min-w-0 flex-1 text-xs">
              {state.ok != null && <span className="flex items-center gap-1 text-accent"><Check size={13} />Found {state.ok} models</span>}
              {state.err && <span className="line-clamp-2 text-danger">{state.err}</span>}
            </span>
            <IconButton title="Remove provider" className="text-danger/70 hover:text-danger" onClick={() => removeProvider(p.id)}><Trash2 size={16} /></IconButton>
          </div>
        </div>
      )}
    </div>
  )
}

function Providers() {
  const providers = useStore((s) => s.providers)
  const addProvider = useStore((s) => s.addProvider)
  const [openId, setOpenId] = useState<string | null>(providers[0]?.id ?? null)
  const [adding, setAdding] = useState(providers.length === 0)
  return (
    <div className="flex flex-col gap-3">
      {providers.map((p) => <ProviderCard key={p.id} p={p} open={openId === p.id} toggle={() => setOpenId(openId === p.id ? null : p.id)} />)}
      {adding ? (
        <div className="anim-fade-up rounded-2xl border border-dashed border-line p-3">
          <div className="mb-2.5 flex items-center justify-between px-1"><span className="text-sm font-medium">Choose a provider</span>{providers.length > 0 && <IconButton className="h-7 w-7" onClick={() => setAdding(false)}><X size={15} /></IconButton>}</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {PRESETS.map((pr) => (
              <button key={pr.id} onClick={() => { const p = makeProvider(pr.id); addProvider(p); setOpenId(p.id); setAdding(false) }} className="glass flex items-center gap-2.5 rounded-2xl p-2.5 text-left transition hover:-translate-y-0.5 active:scale-95">
                <ProviderDot preset={pr.id} name={pr.name} size={28} />
                <span className="min-w-0"><span className="block truncate text-[13px] font-medium">{pr.name.replace(' (OpenAI-compatible)', '')}</span>{pr.hint && <span className="block truncate text-[11px] text-muted">{pr.hint}</span>}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-dashed border-line text-sm font-medium text-muted transition hover:border-accent/50 hover:text-accent"><Plus size={16} />Add provider</button>
      )}
    </div>
  )
}

function VideoGen() {
  const { settings, setSettings, providers } = useStore()
  const v = settings.video
  const set = (p: Partial<typeof v>) => setSettings({ video: { ...v, ...p } })
  const gem = /^gemini-/.test(v.model)
  const prov = pickProvider(providers, v.providerId, [gem ? 'gemini' : 'openai'])
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface/50 p-4">
      <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-soft text-accent"><Video size={18} /></span>
        <div className="flex-1"><div className="text-sm font-medium">Video generation</div><div className="text-xs text-muted">Lets the AI make short video clips. It decides when a video is what you want and writes an enhanced prompt first.</div></div>
        <Toggle on={v.enabled} onChange={(b) => set({ enabled: b })} /></div>
      {v.enabled && (<>
        <Row label="Video model" hint="gemini-omni-* uses Google's video API. Anything else uses the OpenAI /videos API, which OpenAI shut down for Sora on 2026-09-24 but some relays still offer.">
          <ModelSelect value={v.model} onChange={(x) => set({ model: x })} options={[...VIDEO_MODEL_SUGGESTIONS, ...(prov?.models ?? []).map((m) => m.id).filter((m) => /sora|veo|video|omni/i.test(m))]} preset={gem ? 'gemini' : prov?.preset ?? 'openai'} provider={prov?.name} />
        </Row>
        <Row label="Provider" hint={prov ? (gem ? 'Needs a Google Gemini provider with an API key' : undefined) : gem ? 'Add a Google Gemini provider first' : 'Add an OpenAI-compatible provider first'}><ProviderSelect value={v.providerId} prefer={[gem ? 'gemini' : 'openai']} onChange={(x) => set({ providerId: x })} /></Row>
        <Row label="Shape" hint="Auto lets the AI choose per video"><Segmented value={v.aspect} onChange={(x) => set({ aspect: x })} options={[{ value: 'auto', label: 'Auto' }, { value: 'landscape', label: 'Wide' }, { value: 'portrait', label: 'Tall' }]} /></Row>
        <Row label="Default length" hint="The AI can ask for a different length (3 to 15 seconds). Longer clips cost more."><div className="flex items-center gap-3"><input type="range" min={3} max={15} value={v.seconds} onChange={(e) => set({ seconds: +e.target.value })} className="flex-1 accent-[var(--accent)]" /><span className="w-8 text-right text-sm tabular-nums">{v.seconds}s</span></div></Row>
        {gem && <Row label="Resolution"><Segmented value={v.resolution} onChange={(x) => set({ resolution: x })} options={[{ value: '720p', label: '720p' }, { value: '1080p', label: '1080p' }]} /></Row>}
      </>)}
    </section>
  )
}

function ImageGen() {
  const { settings, setSettings, providers } = useStore()
  const im = settings.image
  const set = (p: Partial<typeof im>) => setSettings({ image: { ...im, ...p } })
  const prov = pickProvider(providers, im.providerId, [imageProviderPref(im.model)])
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface/50 p-4">
      <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-soft text-accent"><ImageIcon size={18} /></span>
        <div className="flex-1"><div className="text-sm font-medium">Image generation</div><div className="text-xs text-muted">Lets the AI create images. It writes an enhanced prompt itself before generating.</div></div>
        <Toggle on={im.enabled} onChange={(b) => set({ enabled: b })} /></div>
      {im.enabled && (<>
        <Row label="Provider" hint={prov ? undefined : 'Add an OpenAI-compatible provider first'}><ProviderSelect value={im.providerId} prefer={[imageProviderPref(im.model)]} onChange={(v) => set({ providerId: v })} /></Row>
        <Row label="Image model" hint="OpenAI, Google (gemini-*), xAI (grok-imagine-*) and Alibaba (qwen-image-*) models">
          <ModelSelect value={im.model} onChange={(x) => set({ model: x })} options={[...IMAGE_MODEL_SUGGESTIONS, ...(prov?.models ?? []).map((m) => m.id).filter((m) => /image|dall|imagine|wan\d/i.test(m))]} preset={prov?.preset ?? 'openai'} provider={prov?.name} />
        </Row>
        <Row label="Shape" hint="Auto lets the AI choose per image"><Segmented value={im.aspect} onChange={(v) => set({ aspect: v })} options={[{ value: 'auto', label: 'Auto' }, { value: 'square', label: 'Square' }, { value: 'landscape', label: 'Wide' }, { value: 'portrait', label: 'Tall' }]} /></Row>
        <Row label="Quality"><Segmented value={['low', 'medium', 'high'].includes(im.quality) ? im.quality : 'medium'} onChange={(v) => set({ quality: v })} options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]} /></Row>
      </>)}
    </section>
  )
}

function SandboxSettings() {
  const { settings, setSettings, sync } = useStore()
  const sb = settings.sandbox
  const set = (p: Partial<typeof sb>) => setSettings({ sandbox: { ...sb, ...p } })
  const [test, setTest] = useState<{ busy?: boolean; ok?: string; err?: string }>({})
  const check = async () => {
    setTest({ busy: true })
    try {
      const r = await fetch(`${sync.url}/v1/sandbox/v5/vms?limit=1`, { headers: { Authorization: `Bearer ${sync.token}`, 'X-Freestyle-Key': sb.apiKey.trim() } })
      const j: any = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.message ?? j.error ?? `${r.status} ${r.statusText}`)
      setTest({ ok: 'Connected to Freestyle' })
    } catch (e: any) { setTest({ err: e.message }) }
  }
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface/50 p-4">
      <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-soft text-accent"><Terminal size={18} /></span>
        <div className="flex-1"><div className="text-sm font-medium">Sandbox (Freestyle)</div><div className="text-xs text-muted">Gives the AI a real Linux VM per chat to run commands, build, deploy and make artifacts.</div></div>
        <Toggle on={sb.enabled} onChange={(b) => set({ enabled: b })} /></div>
      {sb.enabled && (<>
        {!sync.token && <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400"><CircleAlert size={14} className="mt-px shrink-0" />The sandbox runs through your sync server (Freestyle's API can't be called directly from a browser). Sign in under Sync first.</div>}
        <div>
          <div className="mb-1 text-xs font-medium text-muted">Freestyle API key</div>
          <SecretInput value={sb.apiKey} onChange={(v) => set({ apiKey: v.trim() })} placeholder="Your Freestyle API key" />
          <p className="mt-1.5 text-xs text-faint">Create one with <code className="font-mono">npx freestyle@latest login</code> then <code className="font-mono">npx freestyle@latest tokens create "kokochat"</code>. It's sent to your sync server per request and never stored there.</p>
        </div>
        <div className="flex items-center gap-2">
          <button disabled={!sb.apiKey.trim() || !sync.token || test.busy} onClick={check} className="flex h-9 items-center gap-2 rounded-full bg-fg px-4 text-sm font-medium text-bg active:scale-95 disabled:opacity-40">{test.busy ? <Loader2 size={14} className="spin" /> : <Check size={14} />}Test connection</button>
          <span className="min-w-0 flex-1 text-xs">{test.ok && <span className="text-accent">{test.ok}</span>}{test.err && <span className="line-clamp-2 text-danger">{test.err}</span>}</span>
        </div>
        <div className="flex items-center justify-between gap-3"><div><div className="text-sm font-medium">Sleep after each reply</div><div className="text-xs text-muted">Pauses the VM when the AI finishes, wakes it on the next command. Skipped while an app is deployed.</div></div><Toggle on={sb.sleepAfterTurn} onChange={(b) => set({ sleepAfterTurn: b })} /></div>
        <Row label="Pause when idle" hint="Minutes without activity (0 = never)"><input type="number" min={0} value={sb.idleMinutes} onChange={(e) => set({ idleMinutes: Math.max(0, +e.target.value || 0) })} className={cn(field, 'w-28 text-right tabular-nums')} /></Row>
        <Row label="Delete after" hint="Hours since creation (0 = keep). Limits runaway cost."><input type="number" min={0} value={sb.ttlHours} onChange={(e) => set({ ttlHours: Math.max(0, +e.target.value || 0) })} className={cn(field, 'w-28 text-right tabular-nums')} /></Row>
        <Row label="Base image" hint="Optional Freestyle snapshot id or slug"><input value={sb.snapshotId} onChange={(e) => set({ snapshotId: e.target.value })} placeholder="default" className={cn(field, 'font-mono')} /></Row>
        <p className="text-xs text-faint">VMs are billed to your Freestyle account. Deleting a chat deletes its VM.</p>
      </>)}
    </section>
  )
}

function IntRow({ icon, title, desc, on, onChange, children }: { icon: React.ReactNode; title: string; desc: string; on: boolean; onChange: (b: boolean) => void; children?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface/50 p-4">
      <div className="flex items-center gap-3">
        {icon}
        <div className="min-w-0 flex-1"><div className="text-sm font-medium">{title}</div><div className="text-xs text-muted">{desc}</div></div>
        <Toggle on={on} onChange={onChange} />
      </div>
      {on && children}
    </section>
  )
}

function IntegrationsSettings() {
  const { settings, setSettings } = useStore()
  const I = settings.integrations
  const set = <K extends keyof typeof I>(k: K, p: Partial<(typeof I)[K]>) => setSettings({ integrations: { ...I, [k]: { ...I[k], ...p } } })
  const [ghTest, setGhTest] = useState<{ busy?: boolean; ok?: string; err?: string }>({})
  const [ntTest, setNtTest] = useState<{ busy?: boolean; ok?: string; err?: string }>({})
  const g = useGoogle()
  const Result = ({ t }: { t: { ok?: string; err?: string } }) => <span className="min-w-0 flex-1 text-xs">{t.ok && <span className="text-accent">{t.ok}</span>}{t.err && <span className="line-clamp-2 text-danger">{t.err}</span>}</span>
  const Btn = ({ busy, onClick, children, disabled }: { busy?: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) => <button disabled={busy || disabled} onClick={onClick} className="flex h-9 items-center gap-2 rounded-full bg-fg px-4 text-sm font-medium text-bg active:scale-95 disabled:opacity-40">{busy ? <Loader2 size={14} className="spin" /> : <Check size={14} />}{children}</button>
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">Integrations let the AI work with your accounts and services directly. You'll see what it's doing in plain language ("Reading src/app.ts in owner/repo"), not tool names.</p>

      <IntRow icon={<BrandTile id="github" size={40} />} title="GitHub" desc="Repositories, files, READMEs, commit history, issues and pull requests." on={I.github.enabled} onChange={(b) => set('github', { enabled: b })}>
        <div className="rounded-xl bg-accent-soft px-3.5 py-2.5 text-xs leading-relaxed text-accent">Public repositories work right away (60 requests per hour). Add a token for private repositories, code search and 5,000 requests per hour.</div>
        <div>
          <div className="mb-1 text-xs font-medium text-muted">Personal access token (optional)</div>
          <SecretInput value={I.github.token} onChange={(v) => set('github', { token: v.trim() })} placeholder="github_pat_… or ghp_…" />
          <p className="mt-1.5 text-xs text-faint">Use a <span className="font-medium">fine-grained, read-only</span> token (Contents, Metadata, Issues, Pull requests: Read) from github.com/settings/personal-access-tokens.</p>
        </div>
        <div className="flex items-center gap-2">
          <Btn busy={ghTest.busy} onClick={async () => { setGhTest({ busy: true }); try { const r = await testGithub(I.github.token.trim()); setGhTest({ ok: `${r.login ? `Signed in as ${r.login} · ` : 'No token · '}${r.remaining.toLocaleString()} of ${r.limit.toLocaleString()} requests left this hour` }) } catch (e: any) { setGhTest({ err: e.message }) } }}>Test connection</Btn>
          <Result t={ghTest} />
        </div>
      </IntRow>

      <section className="rounded-2xl border border-line bg-surface/50 p-4">
        <div className="mb-1 text-sm font-medium">Developer knowledge</div>
        <p className="mb-3 text-xs text-muted">Free public sources the AI can look things up in. No keys needed.</p>
        <div className="flex flex-col divide-y divide-line">
          {([
            ['wikipedia', 'Wikipedia', 'Encyclopedia articles', 'wikipedia'],
            ['huggingface', 'Hugging Face', 'Models, datasets, Spaces and papers', 'huggingface'],
            ['pypi', 'PyPI', 'Python packages and versions', 'pypi'],
            ['npm', 'npm', 'JavaScript packages and versions', 'npm'],
          ] as const).map(([k, name, d, icon]) => (
            <div key={k} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <BrandTile id={icon} size={32} />
              <div className="min-w-0 flex-1"><div className="text-sm font-medium">{name}</div><div className="text-xs text-muted">{d}</div></div>
              <Toggle on={(I[k] as any).enabled} onChange={(b) => set(k, { enabled: b } as any)} />
            </div>
          ))}
        </div>
        {I.huggingface.enabled && (
          <div className="mt-3 border-t border-line pt-3">
            <div className="mb-1 text-xs font-medium text-muted">Hugging Face token (optional, for private or gated models)</div>
            <SecretInput value={I.huggingface.token} onChange={(v) => set('huggingface', { token: v.trim() })} placeholder="hf_…" />
          </div>
        )}
      </section>

      <IntRow icon={<BrandTile id="notion" size={40} />} title="Notion" desc="Search and read your pages and databases. Read-only." on={I.notion.enabled} onChange={(b) => set('notion', { enabled: b })}>
        <div>
          <div className="mb-1 text-xs font-medium text-muted">Internal integration token</div>
          <SecretInput value={I.notion.token} onChange={(v) => set('notion', { token: v.trim() })} placeholder="ntn_… or secret_…" />
          <ol className="mt-2 list-decimal space-y-0.5 pl-4 text-xs text-faint">
            <li>Go to notion.so/profile/integrations and create an <span className="font-medium">internal</span> integration (Read content only).</li>
            <li>Copy its token here.</li>
            <li>In Notion, open the pages or databases you want to use, choose ••• → Connections and add the integration.</li>
          </ol>
        </div>
        <div className="flex items-center gap-2">
          <Btn busy={ntTest.busy} disabled={!I.notion.token.trim()} onClick={async () => { setNtTest({ busy: true }); try { const r = await fetch('https://api.notion.com/v1/users/me', { headers: { Authorization: `Bearer ${I.notion.token.trim()}`, 'Notion-Version': '2022-06-28' } }); const j: any = await r.json(); if (!r.ok) throw new Error(j.message ?? `Notion returned ${r.status}`); setNtTest({ ok: `Connected${j.bot?.workspace_name ? ` to ${j.bot.workspace_name}` : ''} as ${j.name ?? 'integration'}` }) } catch (e: any) { setNtTest({ err: e.message }) } }}>Test connection</Btn>
          <Result t={ntTest} />
        </div>
      </IntRow>

      <IntRow icon={<BrandTile id="google" size={40} />} title="Google Workspace" desc="Calendar, Gmail and Drive (with Docs, Sheets and Slides text). Read-only." on={I.google.enabled} onChange={(b) => set('google', { enabled: b })}>
        <div>
          <div className="mb-1 text-xs font-medium text-muted">OAuth client ID</div>
          <input value={I.google.clientId} onChange={(e) => set('google', { clientId: e.target.value.trim() })} placeholder="1234567890-abc….apps.googleusercontent.com" className={cn(field, 'font-mono')} />
          <ol className="mt-2 list-decimal space-y-0.5 pl-4 text-xs text-faint">
            <li>In the Google Cloud console create a project and enable the Calendar, Gmail and Drive APIs.</li>
            <li>Configure the OAuth consent screen (External, "Testing", add yourself as a test user).</li>
            <li>Create an OAuth client ID of type <span className="font-medium">Web application</span> and add <code className="font-mono">{location.origin}</code> under Authorized JavaScript origins.</li>
            <li>Paste the client ID above and press Connect. There is no client secret, and nothing is stored on a server.</li>
          </ol>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {([['calendar', 'Calendar'], ['gmail', 'Gmail'], ['drive', 'Drive']] as const).map(([k, n]) => (
            <label key={k} className="flex cursor-pointer items-center gap-2 text-sm">
              <Toggle on={I.google[k]} onChange={(b) => set('google', { [k]: b })} />{n}
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {g.connected
            ? <button onClick={() => disconnectGoogle()} className="h-9 rounded-full bg-fg/8 px-4 text-sm font-medium hover:bg-fg/12 active:scale-95">Disconnect</button>
            : <Btn busy={g.busy} disabled={!I.google.clientId.trim()} onClick={() => connectGoogle(true).catch((e) => toast.error(e.message))}>Connect Google</Btn>}
          {g.connected && <button onClick={() => connectGoogle(true).catch((e) => toast.error(e.message))} className="h-9 rounded-full px-3 text-sm text-muted hover:bg-fg/5 hover:text-fg">Reconnect</button>}
          <span className="min-w-0 flex-1 text-xs">{g.connected ? <span className="text-accent">Connected{g.email ? ` as ${g.email}` : ''} · session lasts about an hour</span> : g.error ? <span className="text-danger">{g.error}</span> : <span className="text-muted">Not connected</span>}</span>
        </div>
        <p className="text-xs text-faint">Google shows an "unverified app" warning for personal projects in Testing mode. That is expected: it is your own app.</p>
      </IntRow>
    </div>
  )
}

function Tools() {
  const { settings, setSettings } = useStore()
  return (
    <div className="flex flex-col gap-5">
      <SandboxSettings />
      <ImageGen />
      <VideoGen />
      <section className="rounded-2xl border border-line bg-surface/50 p-4">
        <div className="mb-3 flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-soft text-accent"><Globe size={18} /></span>
          <div className="flex-1"><div className="text-sm font-medium">Web search</div><div className="text-xs text-muted">Uses Tavily. Works with any model that supports function calling.</div></div>
          <Toggle on={settings.searchEnabled} onChange={(b) => setSettings({ searchEnabled: b })} />
        </div>
        <div className="mb-1 text-xs font-medium text-muted">Tavily API key</div>
        <SecretInput value={settings.tavilyKey} onChange={(v) => setSettings({ tavilyKey: v.trim() })} placeholder="tvly-..." />
        <div className="mt-4 flex items-center justify-between"><span className="text-sm">When search is on</span>
          <Segmented value={settings.searchMode} onChange={(v) => setSettings({ searchMode: v })} options={[{ value: 'first', label: 'First message' }, { value: 'always', label: 'Every message' }, { value: 'auto', label: 'Let AI decide' }]} /></div>
        <div className="mt-3 flex items-center justify-between"><span className="text-sm">Search depth</span>
          <Segmented value={settings.searchDepth} onChange={(v) => setSettings({ searchDepth: v })} options={[{ value: 'basic', label: 'Basic' }, { value: 'advanced', label: 'Advanced' }]} /></div>
        <div className="mt-3 flex items-center justify-between"><span className="text-sm">Results per search</span>
          <div className="flex items-center gap-3"><input type="range" min={3} max={10} value={settings.maxResults} onChange={(e) => setSettings({ maxResults: +e.target.value })} className="accent-[var(--accent)]" /><span className="w-5 text-right text-sm tabular-nums">{settings.maxResults}</span></div></div>
      </section>
      <section className="flex items-center gap-3 rounded-2xl border border-line bg-surface/50 p-4">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-soft text-accent"><Wrench size={18} /></span>
        <div className="flex-1"><div className="text-sm font-medium">Artifacts</div><div className="text-xs text-muted">Let the AI create pages, charts, SVGs and documents in a side panel.</div></div>
        <Toggle on={settings.artifactsEnabled} onChange={(b) => setSettings({ artifactsEnabled: b })} />
      </section>
    </div>
  )
}

function McpCard({ s, open, toggle }: { s: McpServer; open: boolean; toggle: () => void }) {
  const { updateMcp, removeMcp } = useStore()
  const [st, setSt] = useState<{ busy?: boolean; err?: string; auth?: string | null; needAuth?: boolean }>({})
  const connect = async () => {
    setSt({ busy: true })
    try { const tools = await listMcpTools(s); updateMcp(s.id, { tools }); setSt({}) }
    catch (e: any) {
      if (e.status === 401) { setSt({ needAuth: true, auth: e.wwwAuthenticate, err: 'This server requires authorization.' }); return } setSt({ err: /Failed to fetch/i.test(e.message) ? 'Could not reach the server. It must be a Streamable HTTP endpoint that allows browser (CORS) requests.' : e.message }) }
  }
  return (
    <div className={cn('overflow-hidden rounded-2xl border border-line bg-surface/50', open && 'bg-surface/80')}>
      <div className="flex items-center gap-3 p-3">
        <button onClick={toggle} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"><Server size={16} /></span>
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{s.name}</span>
            <span className="block truncate text-xs text-muted">{s.tools.length ? `${s.tools.length} tools` : 'Not connected'} · {s.url}</span></span>
          <ChevronDown size={16} className={cn('text-muted transition-transform', open && 'rotate-180')} />
        </button>
        <Toggle on={s.enabled} onChange={(b) => updateMcp(s.id, { enabled: b })} />
      </div>
      {open && (
        <div className="anim-fade-up flex flex-col gap-3 border-t border-line p-3.5">
          <label className="text-xs font-medium text-muted">Name<input value={s.name} onChange={(e) => updateMcp(s.id, { name: e.target.value })} className={cn(field, 'mt-1')} /></label>
          <label className="text-xs font-medium text-muted">Server URL<input value={s.url} onChange={(e) => updateMcp(s.id, { url: e.target.value.trim() })} placeholder="https://mcp.example.com/mcp" className={cn(field, 'mt-1 font-mono')} /></label>
          <div className="text-xs font-medium text-muted">Authorization token (optional)<div className="mt-1"><SecretInput value={s.token ?? ''} onChange={(v) => updateMcp(s.id, { token: v.trim() })} placeholder="Bearer token or API key" /></div></div>
          <div className="text-xs font-medium text-muted">OAuth Client ID (optional)<input value={s.oauth?.clientId ?? ''} onChange={(e) => updateMcp(s.id, { oauth: { ...s.oauth, clientId: e.target.value.trim() || undefined } })} placeholder="Only if the server has no dynamic registration" className={cn(field, 'mt-1 font-mono')} /></div>
          {(st.needAuth || s.oauth?.accessToken) && (
            <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/60 px-3.5 py-2.5">
              <ShieldCheck size={18} className={s.oauth?.accessToken ? 'text-accent' : 'text-muted'} />
              <div className="min-w-0 flex-1 text-sm">{s.oauth?.accessToken ? 'Authorized with OAuth' : 'Sign-in required'}<div className="text-xs text-muted">{s.oauth?.accessToken ? (s.oauth.refreshToken ? 'Token refreshes automatically' : 'Token will expire; re-authorize when needed') : 'You will sign in through the server\'s own page'}</div></div>
              <button
                disabled={st.busy}
                onClick={async () => {
                  const w = window.open('about:blank', 'mcp-oauth', 'width=520,height=720')
                  setSt({ busy: true })
                  try { await authorize(s, w, st.auth); const tools = await listMcpTools(useStore.getState().mcpServers.find((x) => x.id === s.id) ?? s); updateMcp(s.id, { tools }); setSt({}) }
                  catch (e: any) { setSt({ err: e.message, needAuth: true, auth: st.auth }) }
                }}
                className="h-8 rounded-full bg-fg px-3.5 text-[13px] font-medium text-bg active:scale-95 disabled:opacity-40"
              >{s.oauth?.accessToken ? 'Re-authorize' : 'Authorize'}</button>
              {s.oauth?.accessToken && <button onClick={() => updateMcp(s.id, { oauth: { ...s.oauth, accessToken: undefined, refreshToken: undefined, expiresAt: undefined } })} className="h-8 rounded-full px-3 text-[13px] text-muted hover:bg-fg/5">Sign out</button>}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button disabled={st.busy || !s.url} onClick={connect} className="flex h-9 items-center gap-2 rounded-full bg-fg px-4 text-sm font-medium text-bg transition active:scale-95 disabled:opacity-40">
              {st.busy ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}{s.tools.length ? 'Refresh tools' : 'Connect'}
            </button>
            <span className="min-w-0 flex-1 text-xs">{st.err ? <span className="line-clamp-3 text-danger">{st.err}</span> : s.tools.length > 0 && <span className="flex items-center gap-1 text-accent"><Check size={13} />{s.tools.length} tools available</span>}</span>
            <IconButton title="Remove server" className="text-danger/70 hover:text-danger" onClick={() => removeMcp(s.id)}><Trash2 size={16} /></IconButton>
          </div>
          {s.tools.length > 0 && (
            <div className="max-h-56 overflow-y-auto rounded-xl border border-line">
              {s.tools.map((t) => {
                const off = s.disabledTools?.includes(t.name)
                return (
                  <div key={t.name} className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-0">
                    <div className="min-w-0 flex-1"><div className="truncate font-mono text-[13px]">{t.name}</div>{t.description && <div className="line-clamp-1 text-xs text-muted">{t.description}</div>}</div>
                    <Toggle on={!off} onChange={(b) => updateMcp(s.id, { disabledTools: b ? (s.disabledTools ?? []).filter((x) => x !== t.name) : [...(s.disabledTools ?? []), t.name] })} />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Mcp() {
  const { mcpServers, addMcp } = useStore()
  const [openId, setOpenId] = useState<string | null>(mcpServers[0]?.id ?? null)
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">Connect remote MCP servers (Streamable HTTP) to give the AI extra tools. Browsers can't launch local stdio servers; use a remote URL or a local HTTP bridge with CORS enabled.</p>
      {mcpServers.map((s) => <McpCard key={s.id} s={s} open={openId === s.id} toggle={() => setOpenId(openId === s.id ? null : s.id)} />)}
      <button onClick={() => { const s: McpServer = { id: uid(), name: 'New server', url: '', enabled: true, tools: [] }; addMcp(s); setOpenId(s.id) }} className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-dashed border-line text-sm font-medium text-muted transition hover:border-accent/50 hover:text-accent"><Plus size={16} />Add MCP server</button>
    </div>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="min-w-0"><div className="text-sm font-medium">{label}</div>{hint && <div className="text-xs text-muted">{hint}</div>}</div>
      <div className="min-w-0 sm:w-72">{children}</div>
    </div>
  )
}

function ProviderSelect({ value, onChange, prefer }: { value: string; onChange: (v: string) => void; prefer: string[] }) {
  const providers = useStore((s) => s.providers)
  const auto = pickProvider(providers, '', prefer)
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={cn(field, 'appearance-none')}>
      <option value="">{auto ? `Auto (${auto.name})` : 'No provider available'}</option>
      {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  )
}

function Voice() {
  const { settings, setSettings, providers } = useStore()
  const { stt, tts } = settings
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [prev, setPrev] = useState(false)
  useEffect(() => {
    const load = () => setVoices(window.speechSynthesis?.getVoices() ?? [])
    load()
    window.speechSynthesis?.addEventListener?.('voiceschanged', load)
    return () => window.speechSynthesis?.removeEventListener?.('voiceschanged', load)
  }, [])
  const sttP = pickProvider(providers, stt.providerId, ['openai', 'groq'])
  const ttsP = pickProvider(providers, tts.providerId, ['openai'])
  const eng = [{ value: 'api', label: 'Provider model' }, { value: 'browser', label: 'Browser' }] as const
  const sttEng = [{ value: 'koko', label: 'KokoChat' }, { value: 'api', label: 'Your provider' }, { value: 'browser', label: 'Browser' }] as const
  const signedIn = !!useStore((s) => s.sync.token)
  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface/50 p-4">
        <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-soft text-accent"><Mic size={18} /></span>
          <div><div className="text-sm font-medium">Speech to text</div><div className="text-xs text-muted">Dictate with the mic button. Text appears in the box so you can edit before sending.</div></div></div>
        <Row label="Hosted by" hint={stt.engine === 'browser' ? 'Uses your browser\'s built-in recognition' : stt.engine === 'koko' ? (signedIn ? 'Audio goes to the KokoChat server, which transcribes it with Whisper. No key needed.' : 'Needs a Sync sign-in (Settings → Sync).') : 'Sends audio to your own provider'}>
          <Segmented value={stt.engine} onChange={(v) => setSettings({ stt: { ...stt, engine: v } })} options={[...sttEng]} />
        </Row>
        {stt.engine === 'api' && (<>
          <Row label="Provider"><ProviderSelect value={stt.providerId} prefer={['openai', 'groq']} onChange={(v) => setSettings({ stt: { ...stt, providerId: v } })} /></Row>
          <Row label="Model" hint="Any OpenAI-compatible /audio/transcriptions model">
            <ModelSelect value={stt.model} onChange={(x) => setSettings({ stt: { ...stt, model: x } })} options={[...(STT_SUGGESTIONS[sttP?.preset ?? 'openai'] ?? STT_SUGGESTIONS.openai), ...(sttP?.models ?? []).map((m) => m.id).filter((m) => /whisper|transcribe|stt/i.test(m))]} preset={sttP?.preset ?? 'openai'} provider={sttP?.name} />
          </Row>
        </>)}
        <Row label="Language" hint="Optional ISO code, e.g. en. Blank = auto-detect">
          <input value={stt.language} onChange={(e) => setSettings({ stt: { ...stt, language: e.target.value.trim() } })} placeholder="auto" className={field} />
        </Row>
      </section>

      <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface/50 p-4">
        <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-soft text-accent"><Volume2 size={18} /></span>
          <div><div className="text-sm font-medium">Text to speech</div><div className="text-xs text-muted">Use the speaker button under any reply to hear it read aloud.</div></div></div>
        <Row label="Engine" hint={tts.engine === 'browser' ? 'Free, uses system voices' : 'Higher quality, uses your provider'}>
          <Segmented value={tts.engine} onChange={(v) => setSettings({ tts: { ...tts, engine: v } })} options={[...eng]} />
        </Row>
        {tts.engine === 'api' ? (<>
          <Row label="Provider"><ProviderSelect value={tts.providerId} prefer={['openai']} onChange={(v) => setSettings({ tts: { ...tts, providerId: v } })} /></Row>
          <Row label="Model">
            <ModelSelect value={tts.model} onChange={(x) => setSettings({ tts: { ...tts, model: x } })} options={[...(TTS_SUGGESTIONS[ttsP?.preset ?? 'openai'] ?? TTS_SUGGESTIONS.openai), ...(ttsP?.models ?? []).map((m) => m.id).filter((m) => /tts|speech/i.test(m))]} preset={ttsP?.preset ?? 'openai'} provider={ttsP?.name} />
          </Row>
          <Row label="Voice">
            <ModelSelect icons={false} value={tts.voice} onChange={(x) => setSettings({ tts: { ...tts, voice: x } })} options={OPENAI_VOICES} placeholder="Choose a voice" />
          </Row>
        </>) : (
          <Row label="Voice">
            <select value={tts.voiceURI} onChange={(e) => setSettings({ tts: { ...tts, voiceURI: e.target.value } })} className={cn(field, 'appearance-none')}>
              <option value="">System default</option>
              {voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}
            </select>
          </Row>
        )}
        <Row label="Speed"><div className="flex items-center gap-3"><input type="range" min={0.6} max={1.8} step={0.1} value={tts.rate} onChange={(e) => setSettings({ tts: { ...tts, rate: +e.target.value } })} className="flex-1 accent-[var(--accent)]" /><span className="w-9 text-right text-sm tabular-nums">{tts.rate.toFixed(1)}×</span></div></Row>
        <div>
          <button
            onClick={async () => {
              if (prev) { stopSpeaking(); setPrev(false); return }
              setPrev(true)
              try { await speak(settings, providers, 'Hi! This is how I will sound when reading replies out loud.', (p) => p === 'idle' && setPrev(false)) }
              catch (e: any) { setPrev(false); toast.error(e.message) }
            }}
            className="flex h-9 items-center gap-2 rounded-full bg-fg px-4 text-sm font-medium text-bg transition active:scale-95"
          >{prev ? <><Square size={13} fill="currentColor" />Stop</> : <><Volume2 size={15} />Preview voice</>}</button>
        </div>
      </section>
    </div>
  )
}

function ago(t?: number) {
  if (!t) return 'never'
  const s = Math.round((Date.now() - t) / 1000)
  return s < 10 ? 'just now' : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`
}

function StorageMeter() {
  const u = useStore((s) => s.sync.usage)
  if (!u) return null
  const pct = Math.min(100, (u.used / u.quota) * 100)
  const tone = pct >= 95 ? 'bg-danger' : pct >= 80 ? 'bg-amber-500' : 'bg-accent'
  return (
    <section className="rounded-2xl border border-line bg-surface/50 p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <div className="text-sm font-medium">Cloud storage</div>
        <div className="text-sm tabular-nums text-muted"><span className="font-medium text-fg">{fmtBytes(u.used)}</span> of {fmtBytes(u.quota).replace('.00', '')} used</div>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-fg/8"><div className={cn('h-full rounded-full transition-all duration-500', tone)} style={{ width: `${Math.max(pct, u.used ? 1.5 : 0)}%` }} /></div>
      {pct >= 80 && <div className="mt-2 text-xs text-muted">{pct >= 100 ? 'Storage is full: new changes can\'t be uploaded.' : 'Running low. Chats with generated images are the biggest.'}</div>}
    </section>
  )
}

function Sync() {
  const sync = useStore((s) => s.sync)
  const status = useStore((s) => s.syncStatus)
  const setSync = useStore((s) => s.setSync)
  const [url, setUrl] = useState(sync.url)
  const [email, setEmail] = useState(sync.email)
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [pass, setPass] = useState(sync.passphrase)
  const signedIn = !!sync.token

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr('')
    try { await fn() } catch (e: any) { setErr(e.message) }
    setBusy(false)
  }

  if (!signedIn)
    return (
      <div className="flex flex-col gap-5">
        <p className="text-sm text-muted">Sync your chats, provider keys, settings and artifacts across devices through your own Cloudflare Worker. Sign in with a one-time code sent to your email.</p>
        <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface/50 p-4">
          <label className="text-xs font-medium text-muted">Sync server URL
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://kokochat-sync.your-name.workers.dev" disabled={step === 'code'} className={cn(field, 'mt-1 font-mono')} />
          </label>
          <label className="text-xs font-medium text-muted">Email address
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" disabled={step === 'code'} className={cn(field, 'mt-1')}
              onKeyDown={(e) => { if (e.key === 'Enter' && step === 'email') document.getElementById('send-code')?.click() }} />
          </label>
          {step === 'code' && (
            <div className="anim-fade-up">
              <label className="text-xs font-medium text-muted">6-digit code sent to {email}
                <input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, '').slice(0, 6))} placeholder="••••••"
                  onKeyDown={(e) => { if (e.key === 'Enter') document.getElementById('verify-code')?.click() }}
                  className={cn(field, 'mt-1 h-12 text-center font-mono text-xl tracking-[0.5em]')} />
              </label>
            </div>
          )}
          {err && <div className="flex items-start gap-2 rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger"><CircleAlert size={14} className="mt-px shrink-0" />{err}</div>}
          <div className="flex items-center gap-2">
            {step === 'email' ? (
              <button id="send-code" disabled={busy || !url.trim() || !email.includes('@')} onClick={() => run(async () => { await requestCode(url, email.trim()); setSync({ url: normalizeUrl(url) }); setStep('code') })} className="flex h-10 items-center gap-2 rounded-full bg-fg px-5 text-sm font-medium text-bg transition active:scale-95 disabled:opacity-40">
                {busy && <Loader2 size={14} className="spin" />}Send code
              </button>
            ) : (
              <>
                <button id="verify-code" disabled={busy || code.length !== 6} onClick={() => run(async () => { await verifyCode(url, email.trim(), code); setCode(''); setStep('email') })} className="flex h-10 items-center gap-2 rounded-full bg-fg px-5 text-sm font-medium text-bg transition active:scale-95 disabled:opacity-40">
                  {busy && <Loader2 size={14} className="spin" />}Verify &amp; sign in
                </button>
                <button onClick={() => { setStep('email'); setCode(''); setErr('') }} className="h-10 rounded-full px-4 text-sm text-muted hover:bg-fg/5">Use a different email</button>
              </>
            )}
          </div>
        </section>
        <p className="text-xs text-faint">Deploy the worker from the <code className="font-mono">worker/</code> folder; see its README for setup.</p>
      </div>
    )

  const dot = status.phase === 'syncing' ? 'bg-amber-400' : status.phase === 'error' ? 'bg-danger' : 'bg-accent'
  return (
    <div className="flex flex-col gap-5">
      <section className="flex items-center gap-3 rounded-2xl border border-line bg-surface/50 p-4">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent-soft text-accent"><Cloud size={19} /></span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{sync.email}</div>
          <div className="flex items-center gap-2 text-xs text-muted"><span className={cn('h-2 w-2 rounded-full', dot, status.phase === 'syncing' && 'animate-pulse')} />
            {status.phase === 'syncing' ? 'Syncing…' : status.phase === 'error' ? 'Sync problem' : `Synced ${ago(sync.lastSyncAt)}`} · <span className="truncate font-mono">{sync.url.replace(/^https?:\/\//, '')}</span></div>
        </div>
        <button disabled={status.phase === 'syncing'} onClick={() => void syncNow()} className="flex h-9 items-center gap-2 rounded-full bg-fg px-4 text-sm font-medium text-bg active:scale-95 disabled:opacity-40"><RefreshCw size={14} className={cn(status.phase === 'syncing' && 'spin')} />Sync now</button>
      </section>
      <StorageMeter />
      {status.phase === 'error' && status.message && <div className="flex items-start gap-2 rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger"><CircleAlert size={15} className="mt-0.5 shrink-0" />{status.message}</div>}

      <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface/50 p-4">
        <div className="flex items-center justify-between gap-3"><div><div className="text-sm font-medium">Auto-sync</div><div className="text-xs text-muted">Sync a few seconds after changes, on focus, and every minute</div></div><Toggle on={sync.auto} onChange={(b) => setSync({ auto: b })} /></div>
        <div className="text-xs text-muted">Synced: chats and messages, artifacts, provider keys and models, selected model, tool and image settings, MCP servers, voice, theme and system prompt. Chats created on two devices are both kept; edits to the same chat are merged.</div>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface/50 p-4">
        <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-soft text-accent"><ShieldCheck size={18} /></span>
          <div><div className="text-sm font-medium">End-to-end encryption <span className="ml-1 text-xs font-normal text-muted">{sync.passphrase ? 'on' : 'off'}</span></div><div className="text-xs text-muted">Encrypt everything in your browser with a passphrase, so the server (and API keys in it) can never be read. Use the same passphrase on every device. If you lose it, the cloud copy can't be recovered.</div></div></div>
        <SecretInput value={pass} onChange={setPass} placeholder="Passphrase" />
        <div className="flex gap-2">
          <button disabled={pass === sync.passphrase} onClick={() => { setSync({ passphrase: pass }); markAllDirty(); void syncNow() }} className="h-9 rounded-full bg-fg px-4 text-sm font-medium text-bg active:scale-95 disabled:opacity-40">{pass ? 'Save passphrase & re-encrypt' : 'Turn off encryption'}</button>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => run(signOut)} className="h-9 rounded-full bg-fg/8 px-4 text-sm font-medium hover:bg-fg/12">Sign out</button>
        <button onClick={() => run(async () => { if (await askConfirm('Delete ALL data stored in the cloud for this account? Local data on your devices is kept.')) { await deleteCloudData(); toast.success('Cloud data deleted') } })} className="h-9 rounded-full bg-danger/10 px-4 text-sm font-medium text-danger hover:bg-danger/20">Delete cloud data</button>
      </div>
      {err && <div className="text-xs text-danger">{err}</div>}
    </div>
  )
}

const ACCENTS: { id: AppearanceSettings['accent']; color: string; label: string }[] = [
  { id: 'green', color: '#10a37f', label: 'Green' }, { id: 'blue', color: '#2563eb', label: 'Blue' }, { id: 'violet', color: '#7c3aed', label: 'Violet' },
  { id: 'rose', color: '#e11d48', label: 'Rose' }, { id: 'orange', color: '#ea580c', label: 'Orange' }, { id: 'slate', color: '#475569', label: 'Slate' },
]
const PALETTES: { id: AppearanceSettings['palette']; label: string; hint: string; sw: [string, string, string] }[] = [
  { id: 'default', label: 'Default', hint: 'Neutral grey', sw: ['#f4f4f5', '#ffffff', '#0d0d0e'] },
  { id: 'warm', label: 'Paper', hint: 'Warm and soft', sw: ['#f5f0e8', '#fffdf8', '#151210'] },
  { id: 'slate', label: 'Slate', hint: 'Cool blue-grey', sw: ['#edf0f4', '#ffffff', '#0b1017'] },
  { id: 'black', label: 'Black', hint: 'True black in dark mode', sw: ['#f4f4f5', '#ffffff', '#000000'] },
]

function Appearance() {
  const { settings, setSettings } = useStore()
  const a = settings.appearance
  const set = (p: Partial<AppearanceSettings>) => setSettings({ appearance: { ...useStore.getState().settings.appearance, ...p } })
  return (
    <section className="flex flex-col gap-5 rounded-2xl border border-line bg-surface/50 p-4">
      <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">Mode</span>
        <Segmented value={settings.theme} onChange={(v) => setSettings({ theme: v })} options={[{ value: 'light', label: 'Light', icon: <Sun size={13} /> }, { value: 'dark', label: 'Dark', icon: <Moon size={13} /> }, { value: 'system', label: 'System', icon: <Monitor size={13} /> }]} /></div>
      <div>
        <div className="mb-2 text-sm font-medium">Accent colour</div>
        <div className="flex flex-wrap gap-2.5">
          {ACCENTS.map((c) => (
            <button key={c.id} title={c.label} onClick={() => set({ accent: c.id })} style={{ background: c.color }} className={cn('grid h-9 w-9 place-items-center rounded-full text-white transition active:scale-90', a.accent === c.id ? 'ring-2 ring-fg ring-offset-2 ring-offset-bg' : 'hover:scale-110')}>
              {a.accent === c.id && <Check size={16} strokeWidth={3} />}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-2 text-sm font-medium">Theme</div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {PALETTES.map((p) => (
            <button key={p.id} onClick={() => set({ palette: p.id })} className={cn('rounded-2xl border p-2.5 text-left transition active:scale-[0.98]', a.palette === p.id ? 'border-accent bg-accent-soft' : 'border-line hover:bg-fg/4')}>
              <div className="mb-2 flex h-9 overflow-hidden rounded-lg ring-1 ring-black/10">{p.sw.map((c, i) => <span key={i} style={{ background: c }} className="flex-1" />)}</div>
              <div className="text-[13px] font-medium">{p.label}</div><div className="text-[11px] text-muted">{p.hint}</div>
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between"><span className="text-sm font-medium">Text size</span><span className="text-xs tabular-nums text-muted">{a.fontScale}%</span></div>
        <div className="flex items-center gap-3"><span className="text-xs text-faint">A</span><input type="range" min={85} max={135} step={5} value={a.fontScale} onChange={(e) => set({ fontScale: +e.target.value })} className="flex-1 accent-[var(--accent)]" /><span className="text-lg text-faint">A</span></div>
        <p className="md mt-3 rounded-xl bg-surface-2/60 px-3.5 py-2.5" style={{ fontSize: undefined }}>The quick brown fox jumps over the lazy dog.</p>
      </div>
      <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">Font</span>
        <Segmented value={a.font} onChange={(v) => set({ font: v })} options={[{ value: 'inter', label: 'Inter' }, { value: 'system', label: 'System' }, { value: 'serif', label: 'Serif' }, { value: 'mono', label: 'Mono' }]} /></div>
    </section>
  )
}

function PromptsSettings() {
  const { settings, setSettings } = useStore()
  const list = settings.prompts
  const save = (p: Prompt[]) => setSettings({ prompts: p })
  const patch = (id: string, x: Partial<Prompt>) => save(list.map((p) => (p.id === id ? { ...p, ...x } : p)))
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">Reusable prompts. Type <code className="rounded-md bg-fg/6 px-1.5 py-0.5 font-mono text-[12.5px]">/</code> in the message box to pick one. Write <code className="rounded-md bg-fg/6 px-1.5 py-0.5 font-mono text-[12.5px]">{'{text}'}</code> where the message you type should go. Press <b>Add input</b> to add a field you fill in each time: a text box, or a menu of choices (you can still type your own value). Name it, and it is inserted into the prompt as <code className="rounded-md bg-fg/6 px-1.5 py-0.5 font-mono text-[12.5px]">{'{name}'}</code>. <code className="rounded-md bg-fg/6 px-1.5 py-0.5 font-mono text-[12.5px]">{'{date}'}</code> is today's date. Writing <code className="rounded-md bg-fg/6 px-1.5 py-0.5 font-mono text-[12.5px]">{'{name: default}'}</code> by hand also works.</p>
      {list.map((p) => (
        <div key={p.id} className="flex flex-col gap-2.5 rounded-2xl border border-line bg-surface/50 p-4">
          <div className="flex items-center gap-2">
            <input value={p.name} onChange={(e) => patch(p.id, { name: e.target.value })} placeholder="Name" className={cn(field, 'flex-1 font-medium')} />
            <div className="flex w-40 shrink-0 items-center rounded-xl border border-line bg-surface-2/60 pl-3 focus-within:border-accent/60"><span className="font-mono text-sm text-faint">/</span><input value={p.slash} onChange={(e) => patch(p.id, { slash: slugify(e.target.value) })} placeholder="command" className="h-10 min-w-0 flex-1 bg-transparent px-1.5 font-mono text-sm" /></div>
            <IconButton title="Delete prompt" className="hover:text-danger" onClick={() => save(list.filter((x) => x.id !== p.id))}><Trash2 size={16} /></IconButton>
          </div>
          <PromptEditor prompt={p} onChange={(x) => patch(p.id, x)} textClass={cn(field, 'h-auto resize-y py-2.5 leading-relaxed')} />
          {list.some((x) => x.id !== p.id && x.slash === p.slash) && <div className="text-xs text-danger">Another prompt already uses /{p.slash}.</div>}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => save([...list, { id: uid(), name: 'New prompt', slash: `prompt${list.length + 1}`, text: '{text}' }])} className="flex h-9 items-center gap-2 rounded-full bg-fg px-4 text-sm font-medium text-bg active:scale-95"><Plus size={14} />New prompt</button>
        <button onClick={() => { const have = new Set(list.map((p) => p.slash)); save([...list, ...DEFAULT_PROMPTS.filter((d) => !have.has(d.slash))]) }} className="h-9 rounded-full bg-fg/8 px-4 text-sm font-medium active:scale-95">Restore built-in prompts</button>
      </div>
    </div>
  )
}

function FilesSettings() {
  const { settings, setSettings, providers, kbFiles } = useStore()
  const r = settings.rag
  const total = kbFiles.reduce((a, f) => a + f.size, 0)
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface/50 p-4">
      <div><div className="text-sm font-medium">Files and search</div><div className="text-xs text-muted">PDFs and long documents are split into passages that the AI searches, instead of pasting everything into the prompt. {kbFiles.length ? `${kbFiles.length} file${kbFiles.length === 1 ? '' : 's'} indexed on this device (${fmtBytes(total)}).` : ''}</div></div>
      <Row label="Meaning-based search" hint="Uses an embeddings model so searches match ideas, not just words. Without it, keyword search is used."><Toggle on={r.embed} onChange={(b) => setSettings({ rag: { ...r, embed: b } })} /></Row>
      {r.embed && (
        <>
          <Row label="Provider"><ProviderSelect value={r.providerId} onChange={(v) => setSettings({ rag: { ...r, providerId: v } })} prefer={['openai']} /></Row>
          <Row label="Embedding model"><ModelSelect value={r.model} onChange={(x) => setSettings({ rag: { ...r, model: x } })} options={['text-embedding-3-small', 'text-embedding-3-large', 'gemini-embedding-001', ...providers.flatMap((p) => [...(p.embedModels ?? []).map((m) => m.id), ...p.models.map((m) => m.id).filter((m) => /embed/i.test(m))])]} placeholder="text-embedding-3-small" /></Row>
          {!providers.length && <div className="text-xs text-muted">Add a provider first. Anthropic has no embeddings API, so keyword search is used for it.</div>}
        </>
      )}
    </section>
  )
}

function CodeSettings() {
  const { settings, setSettings, codeRules, removeCodeRule, providers } = useStore()
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">Code mode lets the AI work inside a project folder on this computer: read and edit files, run commands, search the web and generate images into the project. It always asks before changing anything unless you turn that off for a session.</p>
      <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface/50 p-4">
        <Row label="New sessions start with" hint="Reading and searching files inside the project folder never needs approval. Bypassing all permissions can only be turned on inside a session, after a warning.">
          <Segmented value={settings.codeDefaultPermission ?? 'auto'} onChange={(v) => setSettings({ codeDefaultPermission: v })} options={[{ value: 'ask', label: 'Ask first' }, { value: 'acceptEdits', label: 'Auto-approve edits' }, { value: 'auto', label: 'Auto' }]} />
        </Row>
        <div className="rounded-xl bg-fg/4 px-3.5 py-3 text-xs leading-relaxed text-muted">
          <span className="font-medium text-fg/80">Auto mode.</span> A small, fast model reads each command together with what you asked for and lets safe ones run. Things that cannot be undone, such as deploying, publishing, pushing to a remote or deleting data, are blocked unless you explicitly asked for them in your message (for example “deploy after you are done”). The AI is told why, so it can explain and move on. If the reviewer is unsure, it asks you.
        </div>
        <Row label="Reviewer model" hint="Any small model is enough; it only judges one command at a time. Leave empty to use the model you are chatting with.">
          <div className="flex flex-col gap-2">
            <ProviderSelect value={settings.codeGuard?.providerId ?? ''} onChange={(v) => setSettings({ codeGuard: { providerId: v, model: settings.codeGuard?.model ?? '' } })} prefer={['openai']} />
            <ModelSelect value={settings.codeGuard?.model ?? ''} onChange={(m) => setSettings({ codeGuard: { providerId: settings.codeGuard?.providerId ?? '', model: m } })} options={['gpt-6-luna', 'gpt-5-nano', 'gpt-5-mini', 'gemini-2.5-flash-lite', 'claude-haiku-4-5', ...providers.flatMap((p) => p.models.map((m) => m.id)).filter((m) => /nano|mini|luna|flash|haiku|lite|small/i.test(m))]} placeholder="Same as the chat model" />
          </div>
        </Row>
      </section>
      <section className="rounded-2xl border border-line bg-surface/50 p-4">
        <div className="mb-1 text-sm font-medium">Always-allowed commands</div>
        <p className="mb-3 text-xs text-muted">Commands you chose "Always allow" for, per project. They run without asking, except when chained with something else or when they look dangerous.</p>
        {codeRules.length === 0 ? <p className="rounded-xl border border-dashed border-line p-4 text-center text-xs text-faint">None yet</p> : (
          <div className="flex flex-col divide-y divide-line">
            {codeRules.map((r) => (
              <div key={r.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <code className="rounded-md bg-fg/6 px-2 py-0.5 font-mono text-[12.5px]">{r.pattern}</code>
                <span className="min-w-0 flex-1 truncate text-xs text-muted" title={r.cwd}>{r.cwd}</span>
                <IconButton title="Remove" className="hover:text-danger" onClick={() => removeCodeRule(r.id)}><Trash2 size={15} /></IconButton>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function General() {
  const { settings, setSettings } = useStore()
  return (
    <div className="flex flex-col gap-5">
      <MigrationSection />
      <Appearance />
      <NotificationSettings />
      {isDesktop() && <QuickAskSettings />}
      <FilesSettings />
      <label className="text-sm font-medium">System prompt
        <textarea value={settings.systemPrompt} onChange={(e) => setSettings({ systemPrompt: e.target.value })} rows={5} className={cn(field, 'mt-2 h-auto resize-y py-2.5 font-normal leading-relaxed')} /></label>
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface/50 p-4">
        <div><div className="text-sm font-medium">Backup</div><div className="text-xs text-muted">Export every chat to a JSON file, or import one.</div></div>
        <div className="flex gap-2">
          <button onClick={() => exportChatsJson(useStore.getState().chats.filter((c) => c.messages.length))} className="h-9 rounded-full bg-fg px-4 text-sm font-medium text-bg active:scale-95">Export</button>
          <button onClick={() => window.dispatchEvent(new Event('koko:import'))} className="h-9 rounded-full bg-fg/8 px-4 text-sm font-medium active:scale-95">Import</button>
        </div>
      </div>
      <div className="rounded-2xl border border-danger/30 p-4">
        <div className="text-sm font-medium">Danger zone</div>
        <p className="mb-3 text-xs text-muted">Chats, providers and keys live only in this browser. Clearing wipes all of it.</p>
        <button onClick={async () => { if (await askConfirm('Delete all chats, providers and keys from this browser?')) { await idbDel('kokochat-v1'); location.reload() } }} className="h-9 rounded-full bg-danger/10 px-4 text-sm font-medium text-danger transition hover:bg-danger/20">Erase all data</button>
      </div>
    </div>
  )
}

export function SettingsModal() {
  const { settingsOpen, settingsTab, closeSettings, openSettings } = useStore()
  const admin = useStore((s) => !!s.sync.token && !!s.sync.admin)
  if (!settingsOpen) return null
  const desktop = isDesktop()
  const tabs = [{ id: 'providers', label: 'Providers', icon: <Plug size={16} /> }, ...(desktop ? [{ id: 'code' as const, label: 'Code', icon: <Code2 size={16} /> }] : []), { id: 'tools', label: 'Tools', icon: <Wrench size={16} /> }, { id: 'integrations', label: 'Integrations', icon: <Puzzle size={16} /> }, { id: 'mcp', label: 'MCP servers', icon: <Server size={16} /> }, { id: 'voice', label: 'Voice', icon: <Mic size={16} /> }, { id: 'sync', label: 'Sync', icon: <Cloud size={16} /> }, { id: 'published', label: 'Published', icon: <Globe size={16} /> }, { id: 'prompts', label: 'Prompts', icon: <BookText size={16} /> }, { id: 'memory', label: 'Memory', icon: <Brain size={16} /> }, { id: 'plugins', label: 'Plugins', icon: <Blocks size={16} /> }, { id: 'usage', label: 'Usage', icon: <BarChart3 size={16} /> }, ...(admin ? [{ id: 'admin' as const, label: 'Admin', icon: <ShieldCheck size={16} /> }] : []), { id: 'general', label: 'General', icon: <SlidersHorizontal size={16} /> }] as const
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/30 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && closeSettings()}>
      <div className="glass-strong anim-pop flex h-[min(720px,90vh)] w-full max-w-5xl flex-col overflow-hidden rounded-[32px] sm:flex-row">
        <nav className="no-scrollbar flex shrink-0 gap-1 overflow-x-auto border-b border-line p-3 sm:w-60 sm:flex-col sm:overflow-visible sm:border-b-0 sm:border-r">
          <div className="hidden px-3 pb-2 pt-1 text-lg font-semibold tracking-tight sm:block">Settings</div>
          {tabs.map((t) => (
            <button key={t.id} onClick={() => openSettings(t.id)} className={cn('flex h-10 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-full px-3.5 text-sm transition', settingsTab === t.id ? 'bg-fg/8 font-medium' : 'text-muted hover:bg-fg/5 hover:text-fg')}>{t.icon}{t.label}</button>
          ))}
          <IconButton className="ml-auto sm:hidden" onClick={closeSettings}><X size={18} /></IconButton>
        </nav>
        <div className="relative min-h-0 flex-1 overflow-y-auto p-6 sm:p-8">
          <IconButton className="absolute right-3 top-3 hidden sm:grid" onClick={closeSettings}><X size={18} /></IconButton>
          <h2 className="mb-4 text-lg font-semibold tracking-tight">{tabs.find((t) => t.id === settingsTab)?.label}</h2>
          {settingsTab === 'providers' ? <Providers /> : settingsTab === 'tools' ? <Tools /> : settingsTab === 'integrations' ? <IntegrationsSettings /> : settingsTab === 'mcp' ? <Mcp /> : settingsTab === 'voice' ? <Voice /> : settingsTab === 'sync' ? <Sync /> : settingsTab === 'published' ? <PublishedSettings /> : settingsTab === 'admin' ? <AdminPanel /> : settingsTab === 'code' ? <CodeSettings /> : settingsTab === 'usage' ? <UsageDashboard /> : settingsTab === 'prompts' ? <PromptsSettings /> : settingsTab === 'plugins' ? <PluginsSettings /> : settingsTab === 'memory' ? <MemorySettings /> : <General />}
        </div>
      </div>
    </div>
  )
}
