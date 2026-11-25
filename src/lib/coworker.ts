import { useStore } from '../store'
import type { Message, Source } from '../types'
import { runAssistant } from './llm'
import { toast } from './toast'
import { uid } from './utils'

export type Schedule =
  | { kind: 'daily'; time: string; days: number[] } // time "HH:MM", days 0=Sun…6=Sat
  | { kind: 'interval'; hours: number }
  | { kind: 'manual' }

export interface CoRun {
  id: string
  startedAt: number
  endedAt?: number
  status: 'running' | 'done' | 'error' | 'stopped'
  text: string
  sources: Source[]
  steps: string[]
  error?: string
  model?: string
}

export interface CoJob {
  id: string
  name: string
  prompt: string
  schedule: Schedule
  providerId: string
  model: string
  enabled: boolean
  notify: boolean
  createdAt: number
  runs: CoRun[]
}

export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]
export const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const MAX_RUNS = 12

export const TEMPLATES: { name: string; prompt: string; schedule: Schedule }[] = [
  {
    name: 'Security advisories',
    prompt: 'Find the latest zero-day vulnerabilities and security advisories (CVEs) for PHP, Node.js, Python and Pterodactyl Panel/Wings. For each: the CVE id, what is affected, severity, whether it is actively exploited, and the fixed version or a mitigation. Group by product, put anything critical or actively exploited first, and link the official advisory.',
    schedule: { kind: 'daily', time: '08:00', days: ALL_DAYS },
  },
  {
    name: 'Dependency & release watch',
    prompt: 'Check for new releases and breaking changes in React, Vite, Tailwind CSS and TypeScript. Summarise what changed, anything deprecated, and whether upgrading needs action.',
    schedule: { kind: 'daily', time: '09:00', days: [1, 2, 3, 4, 5] },
  },
  {
    name: 'Industry news digest',
    prompt: 'Give me the five most important AI and developer-tooling news items from the last day. One short paragraph each with why it matters, and a link.',
    schedule: { kind: 'daily', time: '07:30', days: ALL_DAYS },
  },
]

const hm = (t: string) => { const [h, m] = t.split(':').map(Number); return { h: h || 0, m: m || 0 } }

/** The most recent time this schedule was due, at or before `now`. */
export function lastSlot(s: Schedule, now: number): number | null {
  if (s.kind !== 'daily') return null
  const { h, m } = hm(s.time)
  const days = s.days.length ? s.days : ALL_DAYS
  for (let i = 0; i < 8; i++) {
    const d = new Date(now); d.setDate(d.getDate() - i); d.setHours(h, m, 0, 0)
    if (d.getTime() <= now && days.includes(d.getDay())) return d.getTime()
  }
  return null
}

/** The next time this job will run (null when manual or paused). */
export function nextRun(j: CoJob, now = Date.now()): number | null {
  if (!j.enabled) return null
  const s = j.schedule
  if (s.kind === 'manual') return null
  if (s.kind === 'interval') return (lastStart(j) ?? j.createdAt) + s.hours * 3600e3
  const { h, m } = hm(s.time)
  const days = s.days.length ? s.days : ALL_DAYS
  for (let i = 0; i < 9; i++) {
    const d = new Date(now); d.setDate(d.getDate() + i); d.setHours(h, m, 0, 0)
    if (d.getTime() > now && days.includes(d.getDay())) return d.getTime()
  }
  return null
}

const lastStart = (j: CoJob) => j.runs[0]?.startedAt

/** Due now: a scheduled slot has passed since the last run (so a job missed while the app was closed runs once on return). */
export function isDue(j: CoJob, now = Date.now()): boolean {
  if (!j.enabled) return false
  const s = j.schedule
  if (s.kind === 'manual') return false
  if (s.kind === 'interval') return now >= (lastStart(j) ?? j.createdAt) + s.hours * 3600e3
  const slot = lastSlot(s, now)
  return slot != null && slot > Math.max(lastStart(j) ?? 0, j.createdAt)
}

export function describeSchedule(s: Schedule): string {
  if (s.kind === 'manual') return 'Manual only'
  if (s.kind === 'interval') return s.hours === 1 ? 'Every hour' : `Every ${s.hours} hours`
  const { h, m } = hm(s.time)
  const t = new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const d = s.days.length ? s.days : ALL_DAYS
  const label = d.length === 7 ? 'Every day' : d.length === 5 && !d.includes(0) && !d.includes(6) ? 'Weekdays' : d.length === 2 && d.includes(0) && d.includes(6) ? 'Weekends' : d.map((x) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][x]).join(', ')
  return `${label} at ${t}`
}

const SYSTEM = (name: string) => `You are Koko's co-worker, running the scheduled job "${name}" on your own while nobody is watching.
- Never ask questions or wait for input; do the best job you can with what you have.
- Research with web_search and read_url (and any other tools offered). Prefer primary sources: official advisories, changelogs, vendor pages. Check dates, and ignore anything old.
- Your reply is shown on a dashboard card, so write it as a briefing in clean Markdown: one short summary line first, then the details under short headings or as bullets. Put the most important items first. Include dates, ids and links. Keep it tight and skimmable.
- A previous report may be provided. Lead with what is NEW or CHANGED since then and do not repeat old items unless their status changed. If nothing meaningful is new, say so in one line.
- Cite sources inline with [n] using only numbers that appeared in search results.`

const CONTEXT_CAP = 6000

/** Run one job now, in the background; the result is saved on the job. */
export async function runJob(id: string): Promise<void> {
  const st = useStore.getState()
  const job = st.coworkers.find((j) => j.id === id)
  if (!job || st.coRunning[id]) return
  const provider = st.providers.find((p) => p.id === job.providerId) ?? st.providers.find((p) => p.id === st.selected?.providerId) ?? st.providers[0]
  const model = job.model || st.selected?.model || provider?.models[0]?.id || ''
  const run: CoRun = { id: uid(), startedAt: Date.now(), status: 'running', text: '', sources: [], steps: [], model }
  const patchRun = (p: Partial<CoRun>) => useStore.getState().patchCoworker(id, (j) => ({ ...j, runs: j.runs.map((r) => (r.id === run.id ? { ...r, ...p } : r)) }))
  st.patchCoworker(id, (j) => ({ ...j, runs: [run, ...j.runs].slice(0, MAX_RUNS) }))
  const ctrl = new AbortController()
  useStore.setState((s) => ({ coRunning: { ...s.coRunning, [id]: ctrl } }))

  const finish = (p: Partial<CoRun>) => {
    patchRun({ endedAt: Date.now(), ...p })
    useStore.setState((s) => { const n = { ...s.coRunning }; delete n[id]; return { coRunning: n } })
  }
  if (!provider || !model) return finish({ status: 'error', error: 'No model selected. Add a provider in Settings and choose a model for this job.' })
  if (!provider.apiKey && !['ollama', 'lmstudio', 'custom'].includes(provider.preset)) return finish({ status: 'error', error: `Add your ${provider.name} API key in Settings → Providers.` })

  const prev = job.runs.find((r) => r.status === 'done' && r.text.trim())
  const ask = prev
    ? `${job.prompt}\n\n---\nPrevious report (${new Date(prev.startedAt).toLocaleString()}). Only report what is new or changed since then:\n${prev.text.slice(0, CONTEXT_CAP)}`
    : job.prompt
  const history: Message[] = [{ id: uid(), role: 'user', text: ask, createdAt: Date.now() }]
  const draft: Message = { id: uid(), role: 'assistant', createdAt: Date.now(), blocks: [], status: 'streaming' }

  const sync = () => {
    const text = (draft.blocks ?? []).filter((b) => b.type === 'text').map((b) => (b as any).text as string).join('\n\n')
    const steps = (draft.blocks ?? []).filter((b) => b.type === 'tool').map((b: any) => {
      let a: any = {}; try { a = JSON.parse(b.args || '{}') } catch { /* partial */ }
      return b.name === 'web_search' ? `Searched “${a.query ?? ''}”` : b.name === 'read_url' ? `Read ${a.url ?? 'a page'}` : `Used ${String(b.name).replace(/_/g, ' ')}`
    })
    patchRun({ text, steps, sources: draft.sources ?? [] })
  }
  let last = 0
  const flush = () => { if (Date.now() - last > 600) { last = Date.now(); sync() } }

  try {
    const s = useStore.getState()
    await runAssistant({
      provider, model, history, draft, chatId: `cowork:${id}`, unattended: true, isolated: false,
      settings: { ...s.settings, deepResearch: false, searchMode: 'always' },
      mcpServers: s.mcpServers, providers: s.providers, chatSystem: SYSTEM(job.name), effort: s.settings.effort, signal: ctrl.signal, flush,
    })
    sync()
    const text = (draft.blocks ?? []).filter((b) => b.type === 'text').map((b) => (b as any).text as string).join('\n\n').trim()
    if (!text) { finish({ status: 'error', error: 'The model returned no report.' }); return }
    finish({ status: 'done' })
    notify(job, text)
  } catch (e: any) {
    sync()
    if (ctrl.signal.aborted) finish({ status: 'stopped' })
    else { finish({ status: 'error', error: String(e?.message ?? e) }) }
  }
}

export const stopJob = (id: string) => useStore.getState().coRunning[id]?.abort()

function notify(job: CoJob, text: string) {
  if (!job.notify || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const first = text.replace(/[#*_`>\-[\]]/g, '').split('\n').map((l) => l.trim()).find(Boolean) ?? 'New report ready'
  try { new Notification(`${job.name} updated`, { body: first.slice(0, 140), silent: true }) } catch { /* ignore */ }
}

export async function enableNotifications(): Promise<boolean> {
  if (typeof Notification === 'undefined') { toast.error('Notifications are not supported here.'); return false }
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') { toast.error('Notifications are blocked. Allow them in your browser or system settings.'); return false }
  return (await Notification.requestPermission()) === 'granted'
}

let queue: Promise<void> = Promise.resolve()
const queued = new Set<string>()

/** Run due jobs one at a time. Safe to call often. */
export function checkDue() {
  const { coworkers, coRunning } = useStore.getState()
  for (const j of coworkers) {
    if (!isDue(j) || coRunning[j.id] || queued.has(j.id)) continue
    queued.add(j.id)
    queue = queue.then(() => runJob(j.id)).catch(() => {}).finally(() => queued.delete(j.id))
  }
}

let started = false
/** Start the scheduler (once). Jobs only run while Koko is open; anything missed runs when it opens again. */
export function startScheduler() {
  if (started) return
  started = true
  // a run that was cut off by closing the app
  useStore.setState((s) => ({ coworkers: s.coworkers.map((j) => ({ ...j, runs: j.runs.map((r) => (r.status === 'running' ? { ...r, status: 'error' as const, error: 'Interrupted when Koko was closed.', endedAt: r.endedAt ?? Date.now() } : r)) })) }))
  setTimeout(checkDue, 4000)
  setInterval(checkDue, 30_000)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDue() })
}
