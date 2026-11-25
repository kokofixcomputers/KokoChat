import { useState } from 'react'
import { Bell } from 'lucide-react'
import { useStore } from '../store'
import { Toggle } from './ui'
import { ensureNotificationPermission, notifyTest } from '../lib/notify'
import { isDesktop } from '../lib/desktop'
import { toast } from '../lib/toast'

export function NotificationSettings() {
  const { settings, setSettings } = useStore()
  const n = settings.notifications
  const [msg, setMsg] = useState('')
  const set = (p: Partial<typeof n>) => setSettings({ notifications: { ...n, ...p } })
  const row = (label: string, hint: string, key: 'onFinish' | 'onApproval' | 'sound') => (
    <div className="flex items-center gap-3"><div className="flex-1"><div className="text-sm font-medium">{label}</div><div className="text-xs text-muted">{hint}</div></div><Toggle on={n[key]} onChange={(b) => set({ [key]: b })} /></div>
  )
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface/50 p-4">
      <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-soft text-accent"><Bell size={18} /></span>
        <div className="flex-1"><div className="text-sm font-medium">Notifications</div><div className="text-xs text-muted">Get a system notification when Koko is not in front: when the AI finishes, and when it needs your approval or an answer.</div></div>
        <Toggle on={n.enabled} onChange={async (b) => { set({ enabled: b }); if (b && !(await ensureNotificationPermission())) setMsg('Your browser is blocking notifications. Allow them for this site, then try the test button.') }} /></div>
      {n.enabled && (<>
        {row('When the AI finishes', 'For chats and Code sessions, after a reply that took a few seconds.', 'onFinish')}
        {row('When it needs you', isDesktop() ? 'Approvals show Allow and Deny buttons, so you can answer without opening Koko.' : 'When a command or action is waiting for your approval, or the AI asks a question.', 'onApproval')}
        {row('Play a sound', 'Use the system notification sound.', 'sound')}
        <div className="flex items-center gap-3">
          <button onClick={async () => { const e = await notifyTest(); setMsg(e); if (!e) toast.info('Sent. If nothing appeared, check your system notification settings for Koko.') }} className="h-9 rounded-full bg-fg/8 px-4 text-sm font-medium transition hover:bg-fg/12 active:scale-95">Send a test</button>
          {msg && <span className="min-w-0 flex-1 text-xs text-danger">{msg}</span>}
        </div>
      </>)}
    </section>
  )
}
