import { HttpError } from './util'

/**
 * Cloudflare's API does not allow calls from a web page (no CORS), so Workers AI would not work in the browser.
 * This forwards only Workers AI requests to api.cloudflare.com. The caller's own Cloudflare API token is sent along as-is
 * and is never stored or logged; Cloudflare itself checks it.
 */
const ALLOWED = [
  /^\/accounts\/[0-9a-f]{32}\/ai\/v1\/(chat\/completions|embeddings|responses|models)$/,
  /^\/accounts\/[0-9a-f]{32}\/ai\/models\/(search|schema)$/,
  /^\/accounts\/[0-9a-f]{32}\/ai\/run\/@[\w-]+\/[\w.-]+\/[\w.-]+(\/[\w.-]+)?$/,
]
const MAX_BODY = 8 * 1024 * 1024

export async function proxyCloudflare(req: Request, subpath: string): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'POST') throw new HttpError(405, 'Method not allowed')
  if (!ALLOWED.some((re) => re.test(subpath))) throw new HttpError(403, 'That Cloudflare endpoint is not available through this proxy.')
  const auth = req.headers.get('Authorization')
  if (!auth || !/^Bearer\s+\S+$/i.test(auth)) throw new HttpError(401, 'Send your Cloudflare API token as a Bearer token.')
  if (Number(req.headers.get('Content-Length') ?? 0) > MAX_BODY) throw new HttpError(413, 'Request body too large.')

  const url = new URL(req.url)
  const headers = new Headers({ Authorization: auth })
  const ct = req.headers.get('Content-Type'); if (ct) headers.set('Content-Type', ct)
  let upstream: Response
  try {
    upstream = await fetch('https://api.cloudflare.com/client/v4' + subpath + url.search, { method: req.method, headers, body: req.method === 'POST' ? req.body : undefined })
  } catch { throw new HttpError(502, 'Could not reach Cloudflare.') }

  const out = new Headers()
  for (const h of ['Content-Type', 'Retry-After']) { const v = upstream.headers.get(h); if (v) out.set(h, v) }
  out.set('Cache-Control', 'no-store')
  return new Response(upstream.body, { status: upstream.status, headers: out })
}
