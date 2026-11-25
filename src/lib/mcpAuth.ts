import type { McpOAuth, McpServer } from '../types'

const redirectUri = () => `${location.origin}/oauth/callback`

let persist: (id: string, patch: Partial<McpServer>) => void = () => {}
export const setMcpPersist = (fn: typeof persist) => { persist = fn }

const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const rand = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)))

async function getJson(url: string): Promise<any | null> {
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' } })
    return r.ok ? await r.json() : null
  } catch { return null }
}

/** RFC 9728 / RFC 8414 discovery. */
export async function discover(serverUrl: string, wwwAuthenticate?: string | null) {
  const u = new URL(serverUrl)
  const path = u.pathname.replace(/\/$/, '')
  const hinted = /resource_metadata="([^"]+)"/.exec(wwwAuthenticate ?? '')?.[1]
  const scope = /scope="([^"]+)"/.exec(wwwAuthenticate ?? '')?.[1]
  const prm =
    (hinted && (await getJson(hinted))) ||
    (await getJson(`${u.origin}/.well-known/oauth-protected-resource${path}`)) ||
    (await getJson(`${u.origin}/.well-known/oauth-protected-resource`))
  const issuer: string = prm?.authorization_servers?.[0] ?? u.origin
  const iu = new URL(issuer)
  const ipath = iu.pathname.replace(/\/$/, '')
  const meta =
    (await getJson(`${iu.origin}/.well-known/oauth-authorization-server${ipath}`)) ||
    (await getJson(`${iu.origin}/.well-known/openid-configuration${ipath}`)) ||
    (await getJson(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`))
  if (!meta?.authorization_endpoint || !meta?.token_endpoint)
    throw new Error('Could not discover OAuth endpoints for this server (or it blocks browser requests).')
  return { meta, resource: prm?.resource ?? serverUrl, scope: scope ?? (prm?.scopes_supported ?? []).join(' ') }
}

async function register(meta: any, clientName = 'Koko Chat'): Promise<string> {
  if (!meta.registration_endpoint) throw new Error('This server has no dynamic client registration. Enter a Client ID in the server settings.')
  const r = await fetch(meta.registration_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [redirectUri()],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  })
  if (!r.ok) throw new Error(`Client registration failed (${r.status}): ${(await r.text()).slice(0, 160)}`)
  return (await r.json()).client_id
}

async function tokenRequest(meta: any, params: Record<string, string>): Promise<Partial<McpOAuth>> {
  const r = await fetch(meta.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.access_token) throw new Error(j.error_description ?? j.error ?? `Token request failed (${r.status})`)
  return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: j.expires_in ? Date.now() + j.expires_in * 1000 : undefined }
}

/** Interactive sign-in. `popup` must be opened synchronously from a click. */
export async function authorize(s: McpServer, popup: Window | null, wwwAuthenticate?: string | null): Promise<McpOAuth> {
  try {
    const d = await discover(s.url, wwwAuthenticate)
    const clientId = s.oauth?.clientId || (await register(d.meta))
    const verifier = rand(48)
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
    const state = rand(16)
    const url = new URL(d.meta.authorization_endpoint)
    const q: Record<string, string> = {
      response_type: 'code', client_id: clientId, redirect_uri: redirectUri(), code_challenge: challenge,
      code_challenge_method: 'S256', state, resource: d.resource,
    }
    if (d.scope) q.scope = d.scope
    for (const [k, v] of Object.entries(q)) url.searchParams.set(k, v)
    if (!popup) throw new Error('Popup was blocked. Allow popups for this site and try again.')
    popup.location.href = url.toString()

    const code = await new Promise<string>((resolve, reject) => {
      const done = () => { window.removeEventListener('message', onMsg); clearInterval(poll); clearTimeout(to) }
      const onMsg = (e: MessageEvent) => {
        if (e.origin !== location.origin || e.data?.type !== 'mcp-oauth') return
        done()
        if (e.data.state !== state) return reject(new Error('OAuth state mismatch'))
        e.data.error ? reject(new Error(e.data.error_description ?? e.data.error)) : resolve(e.data.code)
      }
      window.addEventListener('message', onMsg)
      const poll = setInterval(() => { if (popup.closed) { done(); reject(new Error('Sign-in window was closed')) } }, 600)
      const to = setTimeout(() => { done(); reject(new Error('Sign-in timed out')) }, 5 * 60_000)
    })

    const tokens = await tokenRequest(d.meta, {
      grant_type: 'authorization_code', code, redirect_uri: redirectUri(), client_id: clientId, code_verifier: verifier, resource: d.resource,
    })
    const oauth: McpOAuth = { ...tokens, clientId, meta: d.meta, resource: d.resource, scope: d.scope }
    persist(s.id, { oauth })
    s.oauth = oauth
    popup.close()
    return oauth
  } catch (e) {
    popup?.close()
    throw e
  }
}

/** Returns a valid access token (refreshing if needed) or undefined. */
export async function accessToken(s: McpServer, force = false): Promise<string | undefined> {
  const o = s.oauth
  if (!o?.accessToken) return undefined
  if (!force && (!o.expiresAt || o.expiresAt - Date.now() > 60_000)) return o.accessToken
  if (!o.refreshToken || !o.meta || !o.clientId) return force ? undefined : o.accessToken
  try {
    const t = await tokenRequest(o.meta, { grant_type: 'refresh_token', refresh_token: o.refreshToken, client_id: o.clientId, resource: o.resource ?? s.url })
    const next: McpOAuth = { ...o, ...t, refreshToken: t.refreshToken ?? o.refreshToken }
    persist(s.id, { oauth: next })
    s.oauth = next
    return next.accessToken
  } catch {
    persist(s.id, { oauth: { ...o, accessToken: undefined, refreshToken: undefined } })
    s.oauth = { ...o, accessToken: undefined, refreshToken: undefined }
    return undefined
  }
}

/** Runs inside the popup at /oauth/callback. */
export function handleCallback() {
  const p = new URLSearchParams(location.search)
  window.opener?.postMessage(
    { type: 'mcp-oauth', code: p.get('code'), state: p.get('state'), error: p.get('error'), error_description: p.get('error_description') },
    location.origin,
  )
  document.body.innerHTML = '<p style="font:15px system-ui;padding:32px;text-align:center">Signed in. You can close this window.</p>'
  setTimeout(() => window.close(), 300)
}
