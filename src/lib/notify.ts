import { useStore } from '../store'
import { koko } from './desktop'
import { decide, rootOf, type Approval } from './permissions'

/**
 * System notifications for when the window is not in front: the AI finished, or it is waiting for your approval or an answer.
 * In the desktop app an approval notification has Allow and Deny buttons, so you can answer without opening Koko.
 */

const handlers = new Map<string, { click?: () => void; action?: (index: number) => void }>()
let wired = false

function wire() {
  if (wired) return
  wired = true
  koko()?.notify.onEvent((e) => {
    const h = handlers.get(e.id)
    if (!h) return
    if (e.type === 'click') h.click?.()
    else h.action?.(e.index ?? 0)
  })
}

/** Only when you are not looking at Koko. */
const away = () => typeof document !== 'undefined' && (!document.hasFocus() || document.visibilityState === 'hidden')
const on = (kind: 'finish' | 'approval') => { const n = useStore.getState().settings.notifications; return !!n?.enabled && (kind === 'finish' ? n.onFinish : n.onApproval) }

const clean = (t: string, n = 130) => t.replace(/```[\s\S]*?```/g, ' ').replace(/[#*_`>~|[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, n)
const titleOf = (chatId: string) => { const c = useStore.getState().chats.find((x) => x.id === rootOf(chatId)); return (c?.title && c.title !== 'New chat' ? c.title : c?.mode === 'code' ? 'Koko Code' : 'Koko') }
const open = (chatId: string) => () => useStore.getState().openChat(rootOf(chatId))

async function show(id: string, title: string, body: string, o: { actions?: string[]; click?: () => void; action?: (i: number) => void } = {}) {
  const sound = useStore.getState().settings.notifications.sound
  handlers.set(id, { click: o.click, action: o.action })
  const k = koko()
  if (k) { wire(); const ok = await k.notify.show({ id, title, body, actions: o.actions, sound }); if (!ok) handlers.delete(id); return }
  // in a browser: plain notifications (they have no buttons), if the user allowed them
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') { handlers.delete(id); return }
  try {
    const n = new Notification(title, { body, tag: id, silent: !sound })
    n.onclick = () => { window.focus(); o.click?.(); n.close() }
    n.onclose = () => handlers.delete(id)
  } catch { handlers.delete(id) }
}

export function closeNotice(id: string) {
  handlers.delete(id)
  koko()?.notify.close(id)
}

/** The AI finished (or failed) a reply. */
export function notifyFinished(chatId: string, o: { text: string; error?: string; ms?: number }) {
  if (!on('finish') || !away()) return
  if ((o.ms ?? 0) < 2500 && !o.error) return // an instant reply is not worth interrupting for
  const code = useStore.getState().chats.find((c) => c.id === chatId)?.mode === 'code'
  const body = o.error ? `Something went wrong: ${clean(o.error, 110)}` : clean(o.text) || (code ? 'Finished working.' : 'The reply is ready.')
  void show('done:' + chatId, titleOf(chatId) + (o.error ? ' · error' : ' · done'), body, { click: open(chatId) })
}

/** Something needs a yes or no. Allow and Deny work right from the notification. */
export function notifyApproval(a: Approval) {
  if (!on('approval') || !away()) return
  const what = a.kind === 'command' ? `Run: ${a.detail ?? a.title}` : a.kind === 'edit' ? `Change: ${a.detail ?? a.title}` : a.detail ? `${a.title}: ${a.detail}` : a.title
  const agent = useStore.getState().chats.find((c) => c.id === a.chatId)?.sub?.name
  void show('appr:' + a.id, `${titleOf(a.chatId)}${agent ? ` · ${agent}` : ''} needs your OK`, (a.risky ? '⚠ ' : '') + clean(what, 200), {
    actions: ['Allow', 'Deny'],
    click: open(a.chatId),
    action: (i) => { decide(a.id, i === 0 ? 'once' : 'deny'); closeNotice('appr:' + a.id) },
  })
}

/** The AI asked you a question and is waiting. */
export function notifyAsk(chatId: string, callId: string, question: string) {
  if (!on('approval') || !away()) return
  void show('ask:' + callId, titleOf(chatId) + ' · question', clean(question, 180) || 'The AI needs your answer.', { click: open(chatId) })
}

/** Ask the system for permission (browsers need this before the first notification). */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (koko()) return true
  if (typeof Notification === 'undefined') return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  return (await Notification.requestPermission()) === 'granted'
}

/** The "Send a test" button in Settings: shows even while the window is in front. */
export async function notifyTest(): Promise<string> {
  if (!(await ensureNotificationPermission())) return 'Notifications are blocked. Allow them for this site in your browser settings.'
  const id = 'test:' + Date.now()
  void show(id, 'Koko · test', 'This is how a notification looks. In the desktop app it also has Allow and Deny buttons.', {
    actions: ['Allow', 'Deny'],
    action: (i) => { void import('./toast').then((m) => m.toast.info(i === 0 ? 'You pressed Allow' : 'You pressed Deny')) },
    click: () => undefined,
  })
  return ''
}
