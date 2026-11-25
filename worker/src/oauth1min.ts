import { HttpError, type Env } from './util'

/**
 * "Sign in with 1minRelay". The relay's token endpoint needs a client secret, which cannot live in a web page or a desktop app,
 * so this worker does that one step: it swaps the one-time code for the user's relay key and hands the key back. Nothing is stored.
 */
const DEFAULT_HOST = 'https://v4.kokodev.cc'
const DEFAULT_REDIRECTS = ['https://kokochat.pages.dev/oauth/1min', 'http://localhost:5173/oauth/1min', 'http://localhost:5176/oauth/1min']

const host = (env: Env) => (env.ONEMIN_HOST || DEFAULT_HOST).replace(/\/+$/, '')
const redirects = (env: Env) => (env.ONEMIN_REDIRECTS ? env.ONEMIN_REDIRECTS.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_REDIRECTS)

function configured(env: Env) {
  if (!env.ONEMIN_CLIENT_ID || !env.ONEMIN_CLIENT_SECRET) throw new HttpError(501, 'Sign in with 1minRelay is not set up on this server yet. Enter your key by hand instead.')
}

/** What the app needs to start the sign-in (the client id is public). */
export function oneMinConfig(env: Env) {
  configured(env)
  return { client_id: env.ONEMIN_CLIENT_ID, authorize_url: `${host(env)}/oauth/authorize`, redirect_uris: redirects(env) }
}

export async function oneMinExchange(env: Env, body: any) {
  configured(env)
  const code = typeof body?.code === 'string' ? body.code.trim() : ''
  const redirect = typeof body?.redirect_uri === 'string' ? body.redirect_uri.trim() : ''
  if (!code || code.length > 500) throw new HttpError(400, 'Missing code.')
  if (!redirects(env).includes(redirect)) throw new HttpError(400, 'That redirect address is not allowed.')

  let tokenRes: Response
  try {
    tokenRes = await fetch(`${host(env)}/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', code, client_id: env.ONEMIN_CLIENT_ID, client_secret: env.ONEMIN_CLIENT_SECRET, redirect_uri: redirect }),
    })
  } catch { throw new HttpError(502, 'Could not reach 1minRelay.') }
  const tok: any = await tokenRes.json().catch(() => ({}))
  if (!tokenRes.ok || !tok.access_token) throw new HttpError(400, `1minRelay did not accept the sign-in (${tokenRes.status})${tok?.detail || tok?.error_description || tok?.error ? `: ${String(typeof tok.detail === 'string' ? tok.detail : tok.error_description || tok.error || JSON.stringify(tok.detail)).slice(0, 200)}` : ''}.`)

  let meRes: Response
  try { meRes = await fetch(`${host(env)}/oauth/me`, { headers: { Authorization: `Bearer ${tok.access_token}` } }) } catch { throw new HttpError(502, 'Could not reach 1minRelay.') }
  const me: any = await meRes.json().catch(() => ({}))
  if (!meRes.ok || !me.relay_key) throw new HttpError(400, 'No relay key was shared. Sign in again and choose a key when asked.')
  return { relay_key: String(me.relay_key), expires_in: Number(tok.expires_in) || null }
}
