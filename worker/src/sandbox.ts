import { HttpError, type Env } from './util'
import { isAdmin } from './admin'

/**
 * Authenticated pass-through to the Freestyle API (https://www.freestyle.sh).
 *
 * Freestyle's API does not allow an `Authorization` header from browsers (CORS), so the app talks
 * to this proxy instead. Only signed-in users can use it, only a small allow-list of paths is
 * forwarded, and the user's Freestyle key is sent per request in `X-Freestyle-Key` and never stored.
 * Admins may instead rely on a `FREESTYLE_API_KEY` secret configured on the worker.
 */

const ALLOWED = [
  /^\/v5\/vms$/,
  /^\/v5\/vms\/[\w.-]{1,80}$/,
  /^\/v5\/vms\/[\w.-]{1,80}\/(exec-await|start|pause)$/,
  /^\/v5\/vms\/[\w.-]{1,80}\/fs\/(read|write|dir|exists|stat|mkdir|remove)$/,
  /^\/v5\/tls$/,
  /^\/v5\/tls\/[\w.-]{1,80}$/,
]

const METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE'])
const MAX_BODY = 12 * 1024 * 1024

export async function proxySandbox(env: Env, req: Request, email: string, subpath: string): Promise<Response> {
  const url = new URL(req.url)
  if (!METHODS.has(req.method)) throw new HttpError(405, 'Method not allowed')
  if (!ALLOWED.some((re) => re.test(subpath))) throw new HttpError(403, 'That Freestyle endpoint is not available through this proxy.')

  const key = req.headers.get('X-Freestyle-Key')?.trim() || (isAdmin(env, email) ? env.FREESTYLE_API_KEY : undefined)
  if (!key) throw new HttpError(400, 'No Freestyle API key. Add one in Settings → Tools → Sandbox.')

  const len = Number(req.headers.get('Content-Length') ?? 0)
  if (len > MAX_BODY) throw new HttpError(413, 'Request body too large.')

  const headers = new Headers({ Authorization: `Bearer ${key}` })
  for (const h of ['Content-Type', 'Range']) { const v = req.headers.get(h); if (v) headers.set(h, v) }

  const base = (env.FREESTYLE_BASE_URL || 'https://api.freestyle.sh').replace(/\/+$/, '')
  const hasBody = req.method === 'POST' || req.method === 'PUT'
  let upstream: Response
  try {
    upstream = await fetch(base + subpath + url.search, { method: req.method, headers, body: hasBody ? req.body : undefined })
  } catch {
    throw new HttpError(502, 'Could not reach Freestyle.')
  }

  const out = new Headers()
  for (const h of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges', 'Retry-After']) {
    const v = upstream.headers.get(h)
    if (v) out.set(h, v)
  }
  out.set('Cache-Control', 'no-store')
  return new Response(upstream.body, { status: upstream.status, headers: out })
}
