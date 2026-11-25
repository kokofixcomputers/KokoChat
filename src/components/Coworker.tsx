import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Bell, BellOff, CalendarClock, ChevronDown, Clock, Loader2, PanelLeft, Pause, Pencil, Play, Plus, Sparkles, Square, Trash2, X } from 'lucide-react'
import { useStore } from '../store'
import { Markdown } from './Markdown'
import { ModelSelect } from './ModelSelect'
import { IconButton, Segmented, Toggle } from './ui'
import { ALL_DAYS, DAY_LABELS, TEMPLATES, describeSchedule, enableNotifications, nextRun, runJob, stopJob, type CoJob, type CoRun, type Schedule } from '../lib/coworker'
import { cn } from '../lib/utils'

const ago = (t: number) => {
  const s = Math.max(0, (Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
const when = (t: number) => {
  const d = new Date(t), today = new Date()
  const tm = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const tomorrow = new Date(today.getTime() + 864e5)
  return d.toDateString() === today.toDateString() ? `today ${tm}` : d.toDateString() === tomorrow.toDateString() ? `tomorrow ${tm}` : `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} ${tm}`
}

function Card({ job, onEdit }: { job: CoJob; onEdit: () => void }) {
  const running = useStore((s) => !!s.coRunning[job.id])
  const patch = useStore((s) => s.patchCoworker)
  const del = useStore((s) => s.deleteCoworker)
  const [pick, setPick] = useState<string | null>(null)
  const [hist, setHist] = useState(false)
  const [full, setFull] = useState(false)
  const [, tick] = useState(0)
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(i) }, [])

  const latest = job.runs[0]
  const shown: CoRun | undefined = job.runs.find((r) => r.id === pick) ?? job.runs.find((r) => r.text.trim()) ?? latest
  const next = nextRun(job)
  const failed = latest?.status === 'error'

  return (
    <section className="glass flex min-w-0 flex-col rounded-[28px] p-5">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <span className="truncate">{job.name}</span>
            {running && <Loader2 size={14} className="spin shrink-0 text-accent" />}
          </h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-faint">
            <span className="inline-flex items-center gap-1"><CalendarClock size={12} />{describeSchedule(job.schedule)}</span>
            {running ? <span className="text-accent">Working…</span>
              : latest?.endedAt ? <span className={cn('inline-flex items-center gap-1', failed && 'text-danger')}>{failed && <AlertCircle size={12} />}{failed ? 'Failed' : 'Updated'} {ago(latest.endedAt)}</span>
              : <span>Not run yet</span>}
            {!running && next && <span className="inline-flex items-center gap-1"><Clock size={12} />Next {when(next)}</span>}
            {!job.enabled && <span className="rounded-full bg-fg/8 px-2 py-px text-muted">Paused</span>}
          </p>
        </div>
        <div className="flex shrink-0 items-center">
          {running
            ? <IconButton title="Stop" onClick={() => stopJob(job.id)}><Square size={15} /></IconButton>
            : <IconButton title="Run now" onClick={() => void runJob(job.id)}><Play size={16} /></IconButton>}
          <IconButton title={job.enabled ? 'Pause schedule' : 'Resume schedule'} onClick={() => patch(job.id, (j) => ({ ...j, enabled: !j.enabled }))}>{job.enabled ? <Pause size={16} /> : <Sparkles size={16} />}</IconButton>
          <IconButton title="Edit" onClick={onEdit}><Pencil size={15} /></IconButton>
        </div>
      </header>

      <div className="mt-4 min-h-[5rem] flex-1">
        {shown && shown.text.trim() ? (
          <>
            <div className={cn('relative overflow-hidden text-sm', !full && 'max-h-80')}>
              <Markdown text={shown.text} sources={shown.sources} small />
              {!full && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[var(--glass-fade,transparent)] to-transparent" />}
            </div>
            <button onClick={() => setFull((f) => !f)} className="mt-2 text-xs font-medium text-accent hover:underline">{full ? 'Show less' : 'Show full report'}</button>
          </>
        ) : running ? (
          <ul className="space-y-1.5 text-sm text-muted">
            {(latest?.steps.length ? latest.steps.slice(-5) : ['Getting started']).map((s, i) => <li key={i} className="flex items-center gap-2 truncate"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />{s}</li>)}
          </ul>
        ) : failed ? null : (
          <p className="text-sm text-faint">No report yet. Press play to run it now.</p>
        )}
        {failed && !running && <p className="mt-2 rounded-2xl bg-danger/10 px-3 py-2 text-xs text-danger">{latest.error}</p>}
      </div>

      {job.runs.length > 1 && (
        <div className="mt-3 border-t border-line pt-2">
          <button onClick={() => setHist((h) => !h)} className="flex items-center gap-1 text-xs font-medium text-muted hover:text-fg"><ChevronDown size={13} className={cn('transition-transform', hist && 'rotate-180')} />Earlier reports ({job.runs.length - 1})</button>
          {hist && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {job.runs.map((r) => (
                <button key={r.id} onClick={() => { setPick(r.id === shown?.id ? null : r.id); setFull(false) }} className={cn('rounded-full px-2.5 py-1 text-xs transition', r.id === shown?.id ? 'bg-fg text-bg' : 'bg-fg/5 text-muted hover:bg-fg/8', r.status === 'error' && 'text-danger')}>
                  {new Date(r.startedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })} {new Date(r.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="mt-2 flex items-center gap-2 text-xs text-faint">
        {shown?.model && <span className="truncate">{shown.model}</span>}
        {shown?.sources.length ? <span>· {shown.sources.length} sources</span> : null}
        <button onClick={() => { if (confirm(`Delete “${job.name}” and its reports?`)) del(job.id) }} className="ml-auto grid h-6 w-6 place-items-center rounded-full hover:text-danger" title="Delete"><Trash2 size={13} /></button>
      </div>
    </section>
  )
}

const field = 'w-full rounded-2xl bg-fg/5 px-3.5 py-2.5 text-sm outline-none transition placeholder:text-faint focus:bg-fg/8 focus:ring-2 focus:ring-accent/40'

function Editor({ id, seed, onClose }: { id: string | null; seed?: Partial<CoJob>; onClose: () => void }) {
  const { coworkers, providers, selected, addCoworker, patchCoworker } = useStore()
  const existing = id ? coworkers.find((j) => j.id === id) : undefined
  const base = existing ?? seed
  const [name, setName] = useState(base?.name ?? '')
  const [prompt, setPrompt] = useState(base?.prompt ?? '')
  const [sched, setSched] = useState<Schedule>(base?.schedule ?? { kind: 'daily', time: '08:00', days: ALL_DAYS })
  const [providerId, setProviderId] = useState(base?.providerId ?? selected?.providerId ?? providers[0]?.id ?? '')
  const [model, setModel] = useState(base?.model ?? selected?.model ?? '')
  const [notify, setNotify] = useState(base?.notify ?? false)
  const prov = providers.find((p) => p.id === providerId)
  const ok = name.trim() && prompt.trim() && model

  const save = async () => {
    if (!ok) return
    if (notify) await enableNotifications()
    const data = { name: name.trim(), prompt: prompt.trim(), schedule: sched, providerId, model, notify, enabled: existing?.enabled ?? true }
    if (existing) patchCoworker(existing.id, (j) => ({ ...j, ...data }))
    else { const nid = addCoworker(data); if (sched.kind === 'manual' || confirmRunNow()) void runJob(nid) }
    onClose()
  }
  const confirmRunNow = () => true // new jobs run once straight away so the card is never empty

  const kind = sched.kind
  return (
    <div className="fixed inset-0 z-[110] grid place-items-center bg-black/30 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="glass-strong anim-pop flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-[28px]">
        <div className="flex items-center justify-between px-6 pb-2 pt-5">
          <h2 className="text-lg font-semibold tracking-tight">{existing ? 'Edit job' : 'New job'}</h2>
          <IconButton onClick={onClose}><X size={18} /></IconButton>
        </div>
        <div className="space-y-4 overflow-y-auto px-6 pb-5 pt-2">
          <label className="block"><span className="mb-1.5 block text-xs font-medium text-muted">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Security advisories" className={field} autoFocus={!existing} /></label>
          <label className="block"><span className="mb-1.5 block text-xs font-medium text-muted">What should it do each time?</span>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={6} placeholder="Find the latest zero-day vulnerabilities for PHP, Node.js, Python and Pterodactyl. List severity, what is affected and the fix." className={cn(field, 'resize-y leading-relaxed')} />
            <span className="mt-1 block text-xs text-faint">It searches the web, reads pages and only reports what is new since its last run.</span></label>

          <div>
            <span className="mb-1.5 block text-xs font-medium text-muted">Schedule</span>
            <Segmented value={kind} onChange={(k) => setSched(k === 'daily' ? { kind: 'daily', time: '08:00', days: ALL_DAYS } : k === 'interval' ? { kind: 'interval', hours: 6 } : { kind: 'manual' })} options={[{ value: 'daily', label: 'Daily' }, { value: 'interval', label: 'Repeat' }, { value: 'manual', label: 'Manual' }]} />
            {sched.kind === 'daily' && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <input type="time" value={sched.time} onChange={(e) => setSched({ ...sched, time: e.target.value || '08:00' })} className={cn(field, 'w-32')} />
                <div className="flex gap-1.5">
                  {DAY_LABELS.map((d, i) => {
                    const on = sched.days.includes(i)
                    return <button key={i} onClick={() => { const days = on ? sched.days.filter((x) => x !== i) : [...sched.days, i].sort(); setSched({ ...sched, days: days.length ? days : sched.days }) }} className={cn('grid h-8 w-8 place-items-center rounded-full text-xs font-medium transition', on ? 'bg-fg text-bg' : 'bg-fg/5 text-muted hover:bg-fg/8')}>{d}</button>
                  })}
                </div>
              </div>
            )}
            {sched.kind === 'interval' && (
              <div className="mt-3 flex items-center gap-2 text-sm">
                Every <input type="number" min={1} max={168} value={sched.hours} onChange={(e) => setSched({ kind: 'interval', hours: Math.max(1, Math.min(168, Number(e.target.value) || 1)) })} className={cn(field, 'w-20')} /> hours
              </div>
            )}
            <p className="mt-2 text-xs text-faint">{sched.kind === 'manual' ? 'Runs only when you press play.' : 'Runs while Koko is open. If it was closed at the scheduled time, the job runs when you open it again.'}</p>
          </div>

          <div>
            <span className="mb-1.5 block text-xs font-medium text-muted">Model</span>
            <div className="flex items-center gap-2">
              <select value={providerId} onChange={(e) => { setProviderId(e.target.value); setModel(providers.find((p) => p.id === e.target.value)?.models[0]?.id ?? '') }} className={cn(field, 'w-44 cursor-pointer')}>
                {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <ModelSelect value={model} onChange={setModel} options={(prov?.models ?? []).map((m) => m.id)} preset={prov?.preset ?? 'openai'} provider={prov?.name} />
            </div>
          </div>

          <label className="flex items-center justify-between gap-3 rounded-2xl bg-fg/5 px-4 py-3 text-sm">
            <span className="flex items-center gap-2">{notify ? <Bell size={15} className="text-accent" /> : <BellOff size={15} className="text-faint" />}Notify me when a report is ready</span>
            <Toggle on={notify} onChange={setNotify} />
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
          <button onClick={onClose} className="h-10 rounded-full px-5 text-sm text-muted transition hover:bg-fg/5 hover:text-fg">Cancel</button>
          <button disabled={!ok} onClick={() => void save()} className="h-10 rounded-full bg-fg px-5 text-sm font-medium text-bg transition hover:opacity-90 disabled:opacity-40">{existing ? 'Save' : 'Create and run'}</button>
        </div>
      </div>
    </div>
  )
}

export function Coworker() {
  const jobs = useStore((s) => s.coworkers)
  const { sidebarOpen, setSidebar, providers } = useStore()
  const [edit, setEdit] = useState<{ id: string | null; seed?: Partial<CoJob> } | null>(null)
  const sorted = useMemo(() => [...jobs].sort((a, b) => a.createdAt - b.createdAt), [jobs])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-2 pb-3 pt-1">
        {!sidebarOpen && <IconButton title="Open sidebar" onClick={() => setSidebar(true)}><PanelLeft size={18} /></IconButton>}
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight">Co-worker</h1>
          <p className="text-xs text-faint">Give it a job and a schedule. It researches in the background and keeps this dashboard up to date.</p>
        </div>
        <button onClick={() => setEdit({ id: null })} className="flex h-10 items-center gap-2 rounded-full bg-fg px-4 text-sm font-medium text-bg transition hover:opacity-90 active:scale-[0.98]"><Plus size={16} />New job</button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-4">
        {!providers.length && <p className="mb-4 rounded-2xl bg-fg/5 px-4 py-3 text-sm text-muted">Add a model provider in Settings first. Jobs use the model you pick for them.</p>}
        {sorted.length ? (
          <div className="grid items-start gap-4 xl:grid-cols-2">
            {sorted.map((j) => <Card key={j.id} job={j} onEdit={() => setEdit({ id: j.id })} />)}
          </div>
        ) : (
          <div className="mx-auto mt-10 max-w-2xl">
            <div className="mb-6 text-center">
              <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-accent/15 text-accent"><CalendarClock size={24} /></span>
              <h2 className="text-lg font-semibold tracking-tight">Nothing scheduled yet</h2>
              <p className="mt-1 text-sm text-muted">Start from an example or write your own.</p>
            </div>
            <div className="space-y-2.5">
              {TEMPLATES.map((t) => (
                <button key={t.name} onClick={() => setEdit({ id: null, seed: { name: t.name, prompt: t.prompt, schedule: t.schedule } })} className="glass flex w-full items-start gap-3 rounded-3xl p-4 text-left transition hover:bg-fg/5">
                  <Sparkles size={17} className="mt-0.5 shrink-0 text-accent" />
                  <span className="min-w-0"><span className="block text-sm font-medium">{t.name}</span><span className="mt-0.5 block text-xs leading-relaxed text-muted">{t.prompt.slice(0, 150)}…</span></span>
                </button>
              ))}
            </div>
          </div>
        )}
        {!!sorted.length && (
          <div className="mt-5">
            <p className="mb-2 px-1 text-xs font-medium text-faint">Ideas</p>
            <div className="flex flex-wrap gap-2">
              {TEMPLATES.filter((t) => !jobs.some((j) => j.name === t.name)).map((t) => <button key={t.name} onClick={() => setEdit({ id: null, seed: { name: t.name, prompt: t.prompt, schedule: t.schedule } })} className="flex items-center gap-1.5 rounded-full bg-fg/5 px-3.5 py-2 text-sm text-muted transition hover:bg-fg/8 hover:text-fg"><Plus size={13} />{t.name}</button>)}
            </div>
          </div>
        )}
      </div>
      {edit && <Editor id={edit.id} seed={edit.seed} onClose={() => setEdit(null)} />}
    </div>
  )
}
