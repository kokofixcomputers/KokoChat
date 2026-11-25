import { useStore } from '../store'
import { koko, isDesktop } from './desktop'
import { fetchModels, makeProvider } from './providers'
import { toast } from './toast'

/**
 * Sign in with 1minRelay (OAuth). A small window shows the relay's consent page; the one-time code that comes back is swapped for the
 * user's relay key by the sync server (it holds the app secret), and the key is saved like one typed in by hand.
 */

/** The address registered with the relay. The desktop app uses the same public address (its sign-in window catches the redirect before anything loads). */
export const ONEMIN_REDIRECT_PROD = 'https://kokochat.pages.dev/oauth/1min'
export const oneMinRedirect = () => (isDesktop() ? ONEMIN_REDIRECT_PROD : `${location.origin}/oauth/1min`)

const syncBase = () => (useStore.getState().sync.url || (import.meta.env.VITE_SYNC_URL as string | undefined) || '').replace(/\/+$/, '')
const PENDING = 'koko:oauth1min:pending'
const RESULT = 'koko:oauth1min:result'
export const MESSAGE = 'koko:oauth:1min'

const rand = () => { const a = new Uint8Array(16); crypto.getRandomValues(a); return [...a].map((b) => b.toString(16).padStart(2, '0')).join('') }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const base = syncBase()
  if (!base) throw new Error('Sign in needs the Koko sync server address, which is missing in this build.')
  const res = await fetch(base + path, init)
  const j: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(j?.error ?? `${res.status} ${res.statusText}`)
  return j as T
}

export type OAuthResult = { code?: string; state?: string; error?: string }

/** Browser: a popup. If popups are blocked, the whole page goes to the relay and comes back (see resumeOneMinSignIn). */
function webPopup(url: string): Promise<OAuthResult> {
  return new Promise((resolve, reject) => {
    const pop = window.open(url, 'koko-oauth', 'width=520,height=760,menubar=no,toolbar=no')
    if (!pop) { location.assign(url); return } // blocked: continue in this tab
    const done = (r: OAuthResult) => { clearInterval(timer); window.removeEventListener('message', onMsg); resolve(r) }
    const onMsg = (e: MessageEvent) => { if (e.source === pop && e.data?.type === MESSAGE) done({ code: e.data.code, state: e.data.state, error: e.data.error }) }
    window.addEventListener('message', onMsg)
    const timer = setInterval(() => { if (pop.closed) { clearInterval(timer); window.removeEventListener('message', onMsg); reject(new Error('The sign-in window was closed.')) } }, 600)
  })
}

async function finishExchange(r: OAuthResult, state: string): Promise<string> {
  if (r.error) throw new Error(r.error === 'access_denied' ? 'You did not allow access.' : r.error === 'closed' ? 'The sign-in window was closed.' : `Sign-in failed: ${r.error}`)
  if (!r.code) throw new Error('Sign-in did not return a code.')
  if (r.state !== state) throw new Error('The sign-in answer did not match this request. Please try again.')
  const out = await api<{ relay_key: string }>('/v1/oauth/1min/exchange', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: r.code, redirect_uri: oneMinRedirect() }) })
  return out.relay_key
}

/** Runs the whole sign-in and returns the relay key. */
export async function signInWithOneMin(): Promise<string> {
  const cfg = await api<{ client_id: string; authorize_url: string }>('/v1/oauth/1min/config')
  const state = rand()
  const url = `${cfg.authorize_url}?response_type=code&client_id=${encodeURIComponent(cfg.client_id)}&redirect_uri=${encodeURIComponent(oneMinRedirect())}&scope=relay_key&state=${state}`
  try { localStorage.setItem(PENDING, JSON.stringify({ state, at: Date.now() })) } catch { /* ignore */ }
  const k = koko()
  const r = k?.oauth ? await k.oauth.popup({ url, redirectUri: oneMinRedirect() }) : await webPopup(url)
  try { localStorage.removeItem(PENDING) } catch { /* ignore */ }
  return finishExchange(r, state)
}

/** Save the key on the 1minRelay provider (created if there is none) and load its models. */
export async function saveOneMinKey(key: string): Promise<void> {
  const st = useStore.getState()
  let p = st.providers.find((x) => x.preset === '1minrelay')
  if (!p) { p = { ...makeProvider('1minrelay'), apiKey: key }; st.addProvider(p) } else st.updateProvider(p.id, { apiKey: key })
  const models = await fetchModels({ ...p, apiKey: key })
  useStore.getState().updateProvider(p.id, { apiKey: key, models, modelsFetchedAt: Date.now() })
  if (!useStore.getState().selected && models[0]) useStore.getState().select(p.id, models[0].id)
}

/** When the sign-in had to use the whole page (popups blocked), the answer is waiting here after the page comes back. */
export async function resumeOneMinSignIn() {
  let res: OAuthResult | null = null, pending: { state: string } | null = null
  try { res = JSON.parse(localStorage.getItem(RESULT) ?? 'null'); pending = JSON.parse(localStorage.getItem(PENDING) ?? 'null') } catch { /* ignore */ }
  if (!res) return
  try { localStorage.removeItem(RESULT); localStorage.removeItem(PENDING) } catch { /* ignore */ }
  if (!pending) return
  try { const key = await finishExchange(res, pending.state); await saveOneMinKey(key); toast.success('Signed in with 1minRelay') } catch (e: any) { toast.error(e.message) }
}
