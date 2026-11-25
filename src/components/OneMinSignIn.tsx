import { useState } from 'react'
import { CircleAlert, Loader2 } from 'lucide-react'
import { signInWithOneMin } from '../lib/oneminAuth'
import { ProviderDot } from './TopBar'

/** "Sign in with 1minRelay": opens the relay's consent window, then hands back the key. Typing a key by hand stays available. */
export function OneMinSignIn({ onKey, compact }: { onKey: (key: string) => void | Promise<void>; compact?: boolean }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const go = async () => {
    setBusy(true); setErr('')
    try { await onKey(await signInWithOneMin()) } catch (e: any) { setErr(/Failed to fetch/i.test(e.message) ? 'Could not reach the sign-in server.' : e.message) }
    setBusy(false)
  }
  return (
    <div className="flex flex-col gap-2">
      <button onClick={go} disabled={busy} className={`flex items-center justify-center gap-2.5 rounded-full bg-accent text-sm font-medium text-accent-fg transition hover:opacity-90 active:scale-[0.98] disabled:opacity-60 ${compact ? 'h-10' : 'h-11'}`}>
        {busy ? <Loader2 size={16} className="spin" /> : <ProviderDot preset="1minrelay" name="1minRelay" size={20} />}{busy ? 'Waiting for 1minRelay…' : 'Sign in with 1minRelay'}
      </button>
      {err && <div className="flex items-start gap-2 rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger"><CircleAlert size={14} className="mt-px shrink-0" /><span className="break-words">{err}</span></div>}
      <div className="flex items-center gap-2 text-[11px] text-faint"><span className="h-px flex-1 bg-line" />or enter a key yourself<span className="h-px flex-1 bg-line" /></div>
    </div>
  )
}
