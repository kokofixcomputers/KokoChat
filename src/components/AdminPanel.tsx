import { useCallback, useEffect, useMemo, useState } from 'react'
import { Ban, CircleAlert, Loader2, LogOut, RefreshCw, Search, ShieldCheck, Trash2, UserCheck, Users } from 'lucide-react'
import { useStore } from '../store'
import { cn, fmtBytes } from '../lib/utils'
import { toast } from '../lib/toast'

export interface AdminUser {
  userId: string; email: string; created: number; lastLogin: number | null; lastSync: number | null
  used: number; items: number; sessions: number; quota: number; customQuota: boolean; disabled: boolean; admin: boolean
}
interface Listing { users: AdminUser[]; defaultQuota: number; totals: { users: number; used: number; items: number } }

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const { url, token } = useStore.getState().sync
  const res = await fetch(url + '/v1/admin' + path, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const j: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(j.error ?? `Server error (${res.status})`)
  return j as T
}

const ago = (t: number | null) => {
  if (!t) return 'never'
  const s = Math.round((Date.now() - t) / 1000)
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`
}
const mb = (b: number) => +(b / 1024 / 1024).toFixed(2)

function Badge({ children, tone }: { children: React.ReactNode; tone: 'accent' | 'danger' | 'muted' }) {
  return <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', tone === 'accent' ? 'bg-accent-soft text-accent' : tone === 'danger' ? 'bg-danger/10 text-danger' : 'bg-fg/8 text-muted')}>{children}</span>
}

function UserRow({ u, me, onChange }: { u: AdminUser; me: boolean; onChange: () => void }) {
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(String(mb(u.quota)))
  const pct = u.quota ? Math.min(100, (u.used / u.quota) * 100) : 100
  const tone = pct >= 95 ? 'bg-danger' : pct >= 80 ? 'bg-amber-500' : 'bg-accent'

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true)
    try { await fn(); if (ok) toast.success(ok); onChange() } catch (e: any) { toast.error(e.message) }
    setBusy(false)
  }
  const btn = 'flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition active:scale-95 disabled:opacity-40'

  return (
    <div className={cn('rounded-2xl border border-line bg-surface/50 p-3.5 transition', u.disabled && 'opacity-70')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 truncate text-sm font-medium">{u.email}</span>
        {me && <Badge tone="muted">You</Badge>}
        {u.admin && <Badge tone="accent">Admin</Badge>}
        {u.disabled && <Badge tone="danger">Suspended</Badge>}
        {u.customQuota && <Badge tone="muted">Custom quota</Badge>}
      </div>
      <div className="mt-1 text-xs text-muted">Joined {new Date(u.created).toLocaleDateString()} · last sync {ago(u.lastSync)} · {u.items} item{u.items === 1 ? '' : 's'} · {u.sessions} active session{u.sessions === 1 ? '' : 's'}</div>

      <div className="mt-3">
        <div className="mb-1 flex justify-between text-xs tabular-nums text-muted"><span><span className="font-medium text-fg">{fmtBytes(u.used)}</span> used</span><span>of {fmtBytes(u.quota).replace('.00', '')}</span></div>
        <div className="h-1.5 overflow-hidden rounded-full bg-fg/8"><div className={cn('h-full rounded-full transition-all', tone)} style={{ width: `${Math.max(pct, u.used ? 1.5 : 0)}%` }} /></div>
      </div>

      {editing ? (
        <div className="anim-fade-up mt-3 flex flex-wrap items-center gap-2">
          <input type="number" min={0} step={0.5} value={val} onChange={(e) => setVal(e.target.value)} autoFocus
            className="h-8 w-24 rounded-xl border border-line bg-surface-2/60 px-2.5 text-sm tabular-nums focus:border-accent/60" />
          <span className="text-sm text-muted">MB</span>
          <button disabled={busy || !(+val >= 0)} onClick={() => run(async () => { await call(`/users/${u.userId}/quota`, 'POST', { quotaBytes: Math.round(+val * 1024 * 1024) }); setEditing(false) }, 'Quota updated')} className={cn(btn, 'bg-fg text-bg')}>Save</button>
          {u.customQuota && <button disabled={busy} onClick={() => run(async () => { await call(`/users/${u.userId}/quota`, 'POST', { quotaBytes: null }); setEditing(false) }, 'Reset to default')} className={cn(btn, 'bg-fg/8 hover:bg-fg/12')}>Use default</button>}
          <button onClick={() => setEditing(false)} className={cn(btn, 'text-muted hover:bg-fg/5')}>Cancel</button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button disabled={busy} onClick={() => { setVal(String(mb(u.quota))); setEditing(true) }} className={cn(btn, 'bg-fg/8 hover:bg-fg/12')}>Change quota</button>
          {!me && (
            <button disabled={busy} onClick={() => run(() => call(`/users/${u.userId}/disable`, 'POST', { disabled: !u.disabled }), u.disabled ? 'Account reactivated' : 'Account suspended')} className={cn(btn, 'bg-fg/8 hover:bg-fg/12')}>
              {u.disabled ? <><UserCheck size={14} />Reactivate</> : <><Ban size={14} />Suspend</>}
            </button>
          )}
          <button disabled={busy || !u.sessions} onClick={() => run(() => call(`/users/${u.userId}/sessions`, 'DELETE'), 'Signed out everywhere')} className={cn(btn, 'bg-fg/8 hover:bg-fg/12')}><LogOut size={14} />Sign out everywhere</button>
          {!me && <button disabled={busy} onClick={() => { if (confirm(`Permanently delete ${u.email} and all of their synced data? This cannot be undone.`)) void run(() => call(`/users/${u.userId}`, 'DELETE'), 'User deleted') }} className={cn(btn, 'ml-auto bg-danger/10 text-danger hover:bg-danger/20')}><Trash2 size={14} />Delete</button>}
          {busy && <Loader2 size={15} className="spin self-center text-muted" />}
        </div>
      )}
    </div>
  )
}

export function AdminPanel() {
  const me = useStore((s) => s.sync.email)
  const [data, setData] = useState<Listing | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try { setData(await call<Listing>('/users')) } catch (e: any) { setErr(e.message) }
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])

  const users = useMemo(() => (data?.users ?? []).filter((u) => u.email.toLowerCase().includes(q.toLowerCase())), [data, q])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface/50 p-4">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent-soft text-accent"><ShieldCheck size={19} /></span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Admin mode</div>
          <div className="text-xs text-muted">{data ? `${data.totals.users} user${data.totals.users === 1 ? '' : 's'} · ${fmtBytes(data.totals.used)} stored · default quota ${fmtBytes(data.defaultQuota).replace('.00', '')}` : 'Loading…'}</div>
        </div>
        <button onClick={() => void load()} disabled={loading} className="grid h-9 w-9 place-items-center rounded-full text-muted transition hover:bg-fg/5 hover:text-fg" title="Refresh"><RefreshCw size={16} className={cn(loading && 'spin')} /></button>
      </div>

      <div className="relative">
        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search users" className="h-10 w-full rounded-full border border-line bg-surface-2/60 pl-9 pr-3 text-sm placeholder:text-faint focus:border-accent/60" />
      </div>

      {err && <div className="flex items-start gap-2 rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger"><CircleAlert size={15} className="mt-0.5 shrink-0" />{err}</div>}
      {data && users.map((u) => <UserRow key={u.userId} u={u} me={u.email === me} onChange={load} />)}
      {data && !users.length && <div className="flex flex-col items-center gap-2 py-10 text-sm text-faint"><Users size={20} />No users found</div>}
    </div>
  )
}
