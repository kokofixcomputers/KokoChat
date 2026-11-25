import { useRef, useState } from 'react'
import { Blocks, Check, ChevronRight, CircleAlert, Code2, Download, Loader2, Plus, RefreshCw, ShieldAlert, Sparkles, Trash2, Upload } from 'lucide-react'
import { useStore } from '../store'
import { usePluginUI } from '../lib/pluginHost'
import { PERMISSIONS, recordFromSource, scanSource, sha256 } from '../lib/plugins'
import { EXAMPLE_PLUGIN } from '../lib/examplePlugin'
import type { PluginRecord, PluginSetting } from '../types'
import { Toggle } from './ui'
import { toast } from '../lib/toast'
import { cn } from '../lib/utils'

const field = 'h-10 w-full rounded-xl border border-line bg-surface-2/60 px-3.5 text-sm transition placeholder:text-faint focus:border-accent/60 focus:bg-surface'

function SettingControl({ def, value, onChange }: { def: PluginSetting; value: unknown; onChange: (v: unknown) => void }) {
  if (def.type === 'boolean') return <Toggle on={!!value} onChange={onChange} />
  if (def.type === 'number') return <input type="number" min={def.min} max={def.max} value={value === undefined || value === null ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} placeholder={def.placeholder} className={cn(field, 'w-32')} />
  if (def.type === 'select') {
    const opts = (def.options ?? []).map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
    return <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className={cn(field, 'w-48 cursor-pointer')}>{opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
  }
  if (def.type === 'textarea') return <textarea value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} rows={3} placeholder={def.placeholder} className={cn(field, 'h-auto resize-y py-2.5')} />
  return <input value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder={def.placeholder} className={cn(field, 'w-64 max-w-full')} />
}

function PluginCard({ rec, onCheckUpdate }: { rec: PluginRecord; onCheckUpdate: () => void }) {
  const { patchPlugin, removePlugin, installPlugin } = useStore()
  const error = usePluginUI((s) => s.errors[rec.id])
  const liveTools = usePluginUI((s) => s.tools[rec.id])
  const running = usePluginUI((s) => !!s.running[rec.id])
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [code, setCode] = useState(rec.source)
  const [codeErr, setCodeErr] = useState('')
  const tools = liveTools ?? rec.tools

  const saveCode = () => {
    try {
      const next = recordFromSource(code, rec)
      if (next.id !== rec.id) throw new Error(`The id changed from "${rec.id}" to "${next.id}". Install it as a new plugin instead.`)
      installPlugin(next); setCodeErr(''); setEditing(false); toast.success('Plugin updated')
    } catch (e: any) { setCodeErr(e.message) }
  }

  return (
    <section className={cn('rounded-2xl border border-line bg-surface/50', !rec.enabled && 'opacity-80')}>
      <div className="flex items-center gap-3 p-4">
        <button onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <ChevronRight size={15} className={cn('shrink-0 text-faint transition-transform', open && 'rotate-90')} />
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent"><Blocks size={17} /></span>
          <span className="min-w-0">
            <span className="flex items-center gap-2"><span className="truncate text-sm font-semibold">{rec.name}</span><span className="shrink-0 text-xs text-faint">v{rec.version}{rec.author ? ` · ${rec.author}` : ''}</span>{running && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" title="Running" />}</span>
            {rec.description && <span className="block truncate text-xs text-muted">{rec.description}</span>}
          </span>
        </button>
        <Toggle on={rec.enabled} onChange={(b) => patchPlugin(rec.id, (r) => ({ ...r, enabled: b }))} />
      </div>
      {error && <div className="mx-4 mb-3 flex items-start gap-2 rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger"><CircleAlert size={14} className="mt-px shrink-0" /><span className="break-words">{error}</span></div>}
      {open && (
        <div className="flex flex-col gap-5 border-t border-line p-4">
          {(rec.permissions?.length ?? 0) > 0 && <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">Access:{rec.permissions!.map((x) => <span key={x} title={PERMISSIONS[x]} className="rounded-md bg-fg/6 px-1.5 py-0.5 font-mono">{x}</span>)}</div>}
          {rec.settings.length > 0 && (
            <div className="flex flex-col gap-3.5">
              <div className="text-xs font-medium text-muted">Settings</div>
              {rec.settings.map((s) => (
                <div key={s.key} className={cn('flex gap-x-4 gap-y-2', s.type === 'textarea' ? 'flex-col' : 'flex-wrap items-center justify-between')}>
                  <div className="min-w-0"><div className="text-sm font-medium">{s.label}</div>{s.description && <div className="text-xs text-muted">{s.description}</div>}</div>
                  <SettingControl def={s} value={s.key in rec.values ? rec.values[s.key] : s.default} onChange={(v) => patchPlugin(rec.id, (r) => ({ ...r, values: { ...r.values, [s.key]: v } }))} />
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-2.5">
            <div className="text-xs font-medium text-muted">Tools for the AI</div>
            {tools.length ? tools.map((t) => (
              <div key={t.name} className="flex items-center gap-3 rounded-xl bg-surface-2/40 px-3 py-2.5">
                <div className="min-w-0 flex-1"><div className="font-mono text-[13px]">{t.name}</div><div className="text-xs text-muted">{t.description}</div></div>
                <Toggle on={!rec.toolsOff.includes(t.name)} onChange={(b) => patchPlugin(rec.id, (r) => ({ ...r, toolsOff: b ? r.toolsOff.filter((x) => x !== t.name) : [...r.toolsOff, t.name] }))} />
              </div>
            )) : <p className="text-xs text-faint">This plugin does not add any tools.</p>}
            {tools.length > 0 && !rec.enabled && <p className="text-xs text-faint">Turn the plugin on for the AI to be able to use its tools.</p>}
          </div>
          {editing && (
            <div className="flex flex-col gap-2">
              <textarea value={code} onChange={(e) => setCode(e.target.value)} rows={14} spellCheck={false} className="w-full resize-y rounded-xl border border-line bg-surface-2/60 p-3 font-mono text-[12.5px] leading-relaxed focus:border-accent/60" />
              {codeErr && <div className="rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger">{codeErr}</div>}
              <div className="flex gap-2"><button onClick={saveCode} className="h-9 rounded-full bg-fg px-4 text-sm font-medium text-bg active:scale-95">Save and reload</button><button onClick={() => { setEditing(false); setCode(rec.source); setCodeErr('') }} className="h-9 rounded-full bg-fg/8 px-4 text-sm font-medium active:scale-95">Cancel</button></div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {rec.sourceUrl && <button onClick={onCheckUpdate} className="flex h-9 items-center gap-2 rounded-full bg-fg/8 px-4 text-sm font-medium transition hover:bg-fg/12 active:scale-95"><RefreshCw size={14} />Check for update</button>}
            {!editing && <button onClick={() => { setCode(rec.source); setEditing(true) }} className="flex h-9 items-center gap-2 rounded-full bg-fg/8 px-4 text-sm font-medium transition hover:bg-fg/12 active:scale-95"><Code2 size={14} />Edit code</button>}
            <button onClick={() => { if (confirm(`Remove the plugin “${rec.name}” and its settings?`)) removePlugin(rec.id) }} className="flex h-9 items-center gap-2 rounded-full px-4 text-sm font-medium text-danger transition hover:bg-danger/10 active:scale-95"><Trash2 size={14} />Remove</button>
          </div>
        </div>
      )}
    </section>
  )
}

const DOCS = `return {
  id: 'my-plugin', name: 'My plugin', version: '1.0.0',
  settings: [{ key: 'greeting', label: 'Greeting', type: 'string', default: 'Hi' }],   // boolean | string | number | select | textarea
  tools: [{ name: 'roll_dice', description: 'Roll a die', parameters: { type: 'object', properties: {} },
            run: (args, ctx) => String(1 + Math.floor(Math.random() * 6)) }],
  async activate(api) {
    api.css.setVariable('--accent', '#7c3aed')                       // restyle the app (undone when the plugin is turned off)
    api.css.inject('.my-class { color: red }')
    api.ui.toast('Hello ' + api.settings.get('greeting'), 'success') // 'info' | 'success' | 'error'
    api.ui.notify('Title', 'Body')                                   // system notification
    api.ui.modal({ title: 'Hi', body: 'Text, an element, or (el) => {…}', actions: [{ label: 'OK', primary: true }] })
    await api.ui.confirm('Sure?')   // true / false      await api.ui.prompt('Name?')   // string / null
    api.ui.addButton({ title: 'Say hi', icon: '👋', onClick: () => api.chat.setInput('Hello!') })
    api.ui.mount('message.footer', (el, ctx) => {                    // composer.toolbar · composer.status · message.footer
      el.append(api.ui.h('span', { class: 'kp-chip' }, 'hi'))        // message.below · topbar · sidebar.footer
      return ctx.onUpdate((data) => {})                              // data: the draft, or the message, as it changes
    })
    api.on('message:done', ({ chatId, message }) => {})              // message:sent · message:done · chat:opened
    api.hooks.beforeSend((text) => text.trim())                      // return new text, or null to cancel
    await api.ai.ask('Summarise this…')                              // needs permissions: ['ai']; uses your selected model
    api.ui.registerPanel({ id: 'p', title: 'My panel', render: (el) => { el.textContent = 'hi' } })  // side-panel tab (desktop)
    api.tools.register({ name: '…', description: '…', run: () => '…' })
    api.storage.get('key') / .set('key', value)                      // saved on this device
  },
}`

interface Review { source: string; sourceUrl?: string; hash: string; rec: PluginRecord; scan: ReturnType<typeof scanSource>; prev?: PluginRecord }

async function fetchSource(url: string): Promise<string> {
  let u: URL
  try { u = new URL(url.trim()) } catch { throw new Error('That is not a valid web address.') }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))) throw new Error('Only https addresses can be used (or http for localhost).')
  const res = await fetch(u.toString(), { cache: 'no-store' })
  if (!res.ok) throw new Error(`The server answered ${res.status} ${res.statusText}.`)
  const text = await res.text()
  if (text.length > 400_000) throw new Error('That file is too large to be a plugin.')
  return text
}

function ReviewCard({ r, onInstall, onCancel }: { r: Review; onInstall: () => void; onCancel: () => void }) {
  const [trust, setTrust] = useState(false)
  const declared = new Set(r.rec.permissions ?? [])
  const undeclared = r.scan.filter((x) => x.perm && !declared.has(x.perm))
  const same = r.prev?.hash && r.prev.hash === r.hash
  return (
    <section className="flex flex-col gap-3.5 rounded-2xl border border-accent/40 bg-surface/60 p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent"><ShieldAlert size={19} /></span>
        <div className="min-w-0">
          <div className="text-sm font-semibold">{r.prev ? 'Update' : 'Install'} “{r.rec.name}” <span className="font-normal text-faint">v{r.rec.version}{r.rec.author ? ` · ${r.rec.author}` : ''}</span></div>
          {r.rec.description && <div className="text-xs text-muted">{r.rec.description}</div>}
          <div className="mt-1 break-all text-[11px] text-faint">{r.sourceUrl ? `From ${r.sourceUrl}` : 'Pasted code'} · SHA-256 <span className="font-mono">{r.hash.slice(0, 16)}…</span>{r.prev && ` · replaces v${r.prev.version}${same ? ' (the code is identical)' : ''}`}</div>
        </div>
      </div>
      <div>
        <div className="mb-1.5 text-xs font-medium text-muted">What it says it needs</div>
        {declared.size ? <ul className="flex flex-col gap-1">{[...declared].map((k) => <li key={k} className="flex items-start gap-2 text-[13px]"><Check size={14} className="mt-0.5 shrink-0 text-accent" />{PERMISSIONS[k]}</li>)}</ul> : <p className="text-[13px] text-muted">No special access: it only changes what Koko shows.</p>}
      </div>
      {r.scan.length > 0 && (
        <div>
          <div className="mb-1.5 text-xs font-medium text-muted">What the code does</div>
          <ul className="flex flex-col gap-1">{r.scan.map((x) => { const bad = !!x.perm && !declared.has(x.perm); return <li key={x.id} className={cn('flex items-start gap-2 text-[13px]', bad && 'text-amber-600 dark:text-amber-400')}>{bad ? <CircleAlert size={14} className="mt-0.5 shrink-0" /> : <Check size={14} className="mt-0.5 shrink-0 text-faint" />}<span>{x.text}{bad && ' (not listed in its permissions)'}</span></li> })}</ul>
        </div>
      )}
      {r.rec.tools.length > 0 && <div className="text-[13px]"><span className="text-xs font-medium text-muted">Gives the AI these tools: </span><span className="font-mono text-[12px]">{r.rec.tools.map((t) => t.name).join(', ')}</span></div>}
      {undeclared.length > 0 && <div className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">The code appears to do things its permissions do not mention. That can be harmless, but be careful.</div>}
      <p className="text-xs text-faint">Plugins run inside Koko with full access to the app, so this list is only a guide from the plugin's own description and a quick scan of its code. Install code you trust.</p>
      <label className="flex cursor-pointer items-start gap-2.5 text-[13px] text-muted"><input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />I have looked at this and I trust it.</label>
      <div className="flex gap-2"><button disabled={!trust} onClick={onInstall} className="h-9 rounded-full bg-fg px-4 text-sm font-medium text-bg transition active:scale-95 disabled:opacity-40">{r.prev ? 'Update' : 'Install'}</button><button onClick={onCancel} className="h-9 rounded-full bg-fg/8 px-4 text-sm font-medium active:scale-95">Cancel</button></div>
    </section>
  )
}

export function PluginsSettings() {
  const plugins = useStore((s) => s.plugins)
  const installPlugin = useStore((s) => s.installPlugin)
  const [adding, setAdding] = useState(false)
  const [code, setCode] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [review, setReview] = useState<Review | null>(null)
  const file = useRef<HTMLInputElement>(null)

  /** Read the plugin and show what it asks for, before anything is installed. */
  const startReview = async (source: string, sourceUrl?: string) => {
    try {
      const hash = await sha256(source)
      const rec = recordFromSource(source, undefined, { sourceUrl, hash })
      setReview({ source, sourceUrl, hash, rec, scan: scanSource(source), prev: plugins.find((p) => p.id === rec.id) })
      setErr('')
    } catch (e: any) { setErr(e.message) }
  }
  const finish = () => {
    if (!review) return
    const { rec, prev } = review
    installPlugin(prev ? { ...rec, enabled: prev.enabled, toolsOff: prev.toolsOff, values: prev.values, installedAt: prev.installedAt } : rec)
    toast.success(`${rec.name} ${prev ? 'updated' : 'installed'}`)
    setReview(null); setAdding(false); setCode(''); setUrl('')
  }
  const fromUrl = async () => {
    setBusy(true); setErr('')
    try { await startReview(await fetchSource(url), url.trim()) } catch (e: any) { setErr(/Failed to fetch/i.test(e.message) ? 'Could not download that. The site may not allow web pages to read it (GitHub raw links work).' : e.message) }
    setBusy(false)
  }
  const installExample = async () => {
    const hash = await sha256(EXAMPLE_PLUGIN)
    installPlugin(recordFromSource(EXAMPLE_PLUGIN, undefined, { hash }))
    toast.success('Word Counter installed')
  }
  const checkUpdate = async (rec: PluginRecord) => {
    if (!rec.sourceUrl) return
    try {
      const src = await fetchSource(rec.sourceUrl)
      if ((await sha256(src)) === rec.hash) { toast.info(`${rec.name} is up to date`); return }
      await startReview(src, rec.sourceUrl)
    } catch (e: any) { toast.error(`Could not check for an update: ${e.message}`) }
  }
  const hasExample = plugins.some((p) => p.id === 'word-counter')

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">Plugins are small JavaScript programs that add features to Koko: change how it looks, add buttons and counters to the message box and replies, show windows and notifications, open their own side panel tab, ask your models questions, and give the AI new tools. You choose which of a plugin's tools and settings are on.</p>
      <div className="flex items-start gap-2.5 rounded-2xl bg-danger/8 px-4 py-3 text-[13px] text-danger"><CircleAlert size={16} className="mt-0.5 shrink-0" /><span>A plugin runs inside Koko with full access, including your API keys and chats. Only install code you wrote or trust completely.</span></div>

      {plugins.map((p) => <PluginCard key={p.id} rec={p} onCheckUpdate={() => void checkUpdate(p)} />)}
      {!plugins.length && (
        <div className="rounded-2xl border border-dashed border-line p-6 text-center">
          <Blocks size={24} className="mx-auto mb-2 text-faint" />
          <p className="text-sm font-medium">No plugins yet</p>
          <p className="mt-1 text-xs text-muted">Try the example: a word counter that shows a live count while you type and the length of each reply.</p>
        </div>
      )}

      {review && <ReviewCard r={review} onInstall={finish} onCancel={() => setReview(null)} />}

      {!review && (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setAdding(!adding)} className="flex h-9 items-center gap-2 rounded-full bg-fg px-4 text-sm font-medium text-bg active:scale-95"><Plus size={14} />Add plugin</button>
          {!hasExample && <button onClick={() => void installExample()} className="flex h-9 items-center gap-2 rounded-full bg-fg/8 px-4 text-sm font-medium transition hover:bg-fg/12 active:scale-95"><Sparkles size={14} />Install the word counter example</button>}
        </div>
      )}

      {adding && !review && (
        <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface/50 p-4">
          <div>
            <div className="mb-1.5 text-sm font-medium">From a web address</div>
            <div className="flex gap-2">
              <input value={url} onChange={(e) => { setUrl(e.target.value); setErr('') }} onKeyDown={(e) => e.key === 'Enter' && url.trim() && void fromUrl()} placeholder="https://raw.githubusercontent.com/you/plugin/main/plugin.js" spellCheck={false} className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-surface-2/60 px-3.5 font-mono text-[12.5px] placeholder:text-faint focus:border-accent/60" />
              <button disabled={!url.trim() || busy} onClick={() => void fromUrl()} className="flex h-10 shrink-0 items-center gap-2 rounded-full bg-fg px-4 text-sm font-medium text-bg transition active:scale-95 disabled:opacity-40">{busy ? <Loader2 size={14} className="spin" /> : <Download size={14} />}Review</button>
            </div>
          </div>
          <div className="flex items-center gap-2"><div className="h-px flex-1 bg-line" /><span className="text-xs text-faint">or paste the code</span><div className="h-px flex-1 bg-line" /></div>
          <div className="flex items-center gap-2">
            <input ref={file} type="file" accept=".js,.mjs,text/javascript" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setCode(await f.text()) }} />
            <button onClick={() => file.current?.click()} className="ml-auto flex h-8 items-center gap-1.5 rounded-full bg-fg/8 px-3 text-[13px] font-medium transition hover:bg-fg/12"><Upload size={13} />Open a .js file</button>
          </div>
          <textarea value={code} onChange={(e) => { setCode(e.target.value); setErr('') }} rows={9} spellCheck={false} placeholder={'return {\n  id: "my-plugin",\n  name: "My plugin",\n  permissions: [],\n  activate(api) {\n    api.ui.toast("Hello from my plugin")\n  },\n}'} className="w-full resize-y rounded-xl border border-line bg-surface-2/60 p-3 font-mono text-[12.5px] leading-relaxed placeholder:text-faint focus:border-accent/60" />
          {err && <div className="flex items-start gap-2 rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger"><CircleAlert size={14} className="mt-px shrink-0" /><span className="break-words">{err}</span></div>}
          <div className="flex gap-2"><button disabled={!code.trim()} onClick={() => void startReview(code)} className="h-9 rounded-full bg-fg px-4 text-sm font-medium text-bg transition active:scale-95 disabled:opacity-40">Review</button><button onClick={() => { setAdding(false); setErr('') }} className="h-9 rounded-full bg-fg/8 px-4 text-sm font-medium active:scale-95">Cancel</button></div>
        </section>
      )}
      {!adding && err && <div className="rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger">{err}</div>}

      <details className="rounded-2xl border border-line bg-surface/50 p-4">
        <summary className="cursor-pointer text-sm font-medium">Writing a plugin: API reference</summary>
        <p className="mb-2 mt-3 text-xs text-muted">The code is the body of a function that ends with <code className="font-mono">return {'{…}'}</code>. Everything a plugin does should happen inside <code className="font-mono">activate(api)</code>; whatever it adds is removed when the plugin is turned off. List what it needs in <code className="font-mono">permissions</code> (<code className="font-mono">ai, chat, network, storage, notifications</code>). Button and chip styling classes: <code className="font-mono">kp-btn kp-chip kp-card kp-muted kp-input</code>. The app's colors are CSS variables such as <code className="font-mono">--accent --bg --surface --fg --muted --line</code>.</p>
        <pre className="max-h-96 overflow-auto rounded-xl border border-line bg-surface-2/50 p-3 font-mono text-[12px] leading-relaxed">{DOCS}</pre>
      </details>
    </div>
  )
}
