import { HttpError, now, randomToken, type Env } from './util'
import { usage } from './sync'

const MAX_PAGE = 4 * 1024 * 1024
const CHUNK = 400_000
const enc = new TextEncoder()
const ID_RE = /^[\w-]{10,40}$/

const chunks = (s: string) => {
  const out: string[] = []
  for (let i = 0; i < s.length; i += CHUNK) out.push(s.slice(i, i + CHUNK))
  return out.length ? out : ['']
}

/** Publish (or republish, when `ref` already has a page) an HTML artifact. */
export async function publish(env: Env, userId: string, body: any) {
  const html = body?.html
  if (typeof html !== 'string' || !html.trim()) throw new HttpError(400, 'Nothing to publish.')
  const title = String(body?.title ?? 'Untitled').slice(0, 200)
  const ref = String(body?.ref ?? '').slice(0, 80)
  const size = enc.encode(html).length
  if (size > MAX_PAGE) throw new HttpError(413, `That page is too large (${(size / 1048576).toFixed(1)} MB, limit ${MAX_PAGE / 1048576} MB).`)
  const prev = ref ? await env.DB.prepare('SELECT id, size FROM artifacts WHERE user_id = ? AND ref = ?').bind(userId, ref).first<{ id: string; size: number }>() : null
  const { used, quota } = await usage(env, userId)
  if (used - (prev?.size ?? 0) + size > quota) throw new HttpError(413, 'Not enough cloud storage left to publish this (published pages count towards your quota).', { quota: true })
  const id = prev?.id ?? randomToken(12)
  const t = now()
  const rows = chunks(html).map((c, i) => env.DB.prepare('INSERT INTO blobs (user_id, key, rev, idx, chunk) VALUES (?, ?, 1, ?, ?)').bind(userId, 'artifact:' + id, i, c))
  await env.DB.batch([
    env.DB.prepare('DELETE FROM blobs WHERE user_id = ? AND key = ?').bind(userId, 'artifact:' + id),
    ...rows,
    prev
      ? env.DB.prepare('UPDATE artifacts SET title = ?, updated = ?, size = ? WHERE id = ?').bind(title, t, size, id)
      : env.DB.prepare('INSERT INTO artifacts (id, user_id, ref, title, created, updated, views, size) VALUES (?, ?, ?, ?, ?, ?, 0, ?)').bind(id, userId, ref, title, t, t, size),
  ])
  return { id, path: `/artifact/${id}`, updated: t, size, republished: !!prev }
}

export async function list(env: Env, userId: string) {
  const { results } = await env.DB.prepare('SELECT id, ref, title, created, updated, views, size FROM artifacts WHERE user_id = ? ORDER BY updated DESC').bind(userId).all<any>()
  return { artifacts: results }
}

export async function unpublish(env: Env, userId: string, id: string) {
  if (!ID_RE.test(id)) throw new HttpError(400, 'Bad id')
  const row = await env.DB.prepare('SELECT id FROM artifacts WHERE id = ? AND user_id = ?').bind(id, userId).first()
  if (!row) throw new HttpError(404, 'Published page not found')
  await env.DB.batch([
    env.DB.prepare('DELETE FROM blobs WHERE user_id = ? AND key = ?').bind(userId, 'artifact:' + id),
    env.DB.prepare('DELETE FROM artifacts WHERE id = ?').bind(id),
  ])
  return { ok: true }
}

/** Public page. Served sandboxed (no same-origin access) so a published page can never touch the worker's own origin. */
export async function serve(env: Env, id: string): Promise<Response> {
  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': 'sandbox allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  }
  const gone = (status: number, msg: string) => new Response(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${msg}</title><body style="font:16px system-ui;display:grid;place-items:center;min-height:100vh;margin:0;color:#555">${msg}</body>`, { status, headers })
  if (!ID_RE.test(id)) return gone(404, 'This page does not exist.')
  const row = await env.DB.prepare('SELECT user_id FROM artifacts WHERE id = ?').bind(id).first<{ user_id: string }>()
  if (!row) return gone(404, 'This page does not exist or was unpublished.')
  const { results } = await env.DB.prepare('SELECT chunk FROM blobs WHERE user_id = ? AND key = ? AND rev = 1 ORDER BY idx').bind(row.user_id, 'artifact:' + id).all<{ chunk: string }>()
  await env.DB.prepare('UPDATE artifacts SET views = views + 1 WHERE id = ?').bind(id).run()
  return new Response(results.map((r) => r.chunk).join(''), { headers })
}
