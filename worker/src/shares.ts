import { HttpError, now, randomToken, type Env } from './util'
import { usage } from './sync'

const MAX_SHARE = 8 * 1024 * 1024
const CHUNK = 400_000
const enc = new TextEncoder()
const ID_RE = /^[\w-]{10,40}$/

const chunks = (s: string) => {
  const out: string[] = []
  for (let i = 0; i < s.length; i += CHUNK) out.push(s.slice(i, i + CHUNK))
  return out.length ? out : ['']
}

export async function createShare(env: Env, userId: string, body: any) {
  const title = String(body?.title ?? 'Shared chat').slice(0, 200)
  const data = body?.data
  if (typeof data !== 'string' || !data) throw new HttpError(400, 'Missing share data.')
  const size = enc.encode(data).length
  if (size > MAX_SHARE) throw new HttpError(413, `That share is too large (${(size / 1048576).toFixed(1)} MB, limit ${MAX_SHARE / 1048576} MB).`)
  const { used, quota } = await usage(env, userId)
  if (used + size > quota) throw new HttpError(413, 'Not enough cloud storage left for this share (shares count towards your quota).', { quota: true })

  const days = Number(body?.expiresInDays)
  const t = now()
  const expires = days > 0 ? t + Math.min(days, 3650) * 86_400_000 : null
  const id = randomToken(12)
  await env.DB.batch(chunks(data).map((c, i) => env.DB.prepare('INSERT INTO blobs (user_id, key, rev, idx, chunk) VALUES (?, ?, 1, ?, ?)').bind(userId, 'share:' + id, i, c)))
  await env.DB.prepare('INSERT INTO shares (id, user_id, title, created, expires, views, size) VALUES (?, ?, ?, ?, ?, 0, ?)').bind(id, userId, title, t, expires, size).run()
  return { id, created: t, expires, size }
}

export async function listShares(env: Env, userId: string) {
  const { results } = await env.DB.prepare('SELECT id, title, created, expires, views, size FROM shares WHERE user_id = ? ORDER BY created DESC').bind(userId).all<any>()
  return { shares: results }
}

export async function deleteShare(env: Env, userId: string, id: string) {
  if (!ID_RE.test(id)) throw new HttpError(400, 'Bad share id')
  const row = await env.DB.prepare('SELECT id FROM shares WHERE id = ? AND user_id = ?').bind(id, userId).first()
  if (!row) throw new HttpError(404, 'Share not found')
  await env.DB.batch([
    env.DB.prepare('DELETE FROM blobs WHERE user_id = ? AND key = ?').bind(userId, 'share:' + id),
    env.DB.prepare('DELETE FROM shares WHERE id = ?').bind(id),
  ])
  return { ok: true }
}

/** Public, unauthenticated read. The id is an unguessable capability token. */
export async function getPublicShare(env: Env, id: string) {
  if (!ID_RE.test(id)) throw new HttpError(404, 'This link is invalid.')
  const row = await env.DB.prepare('SELECT user_id, title, created, expires FROM shares WHERE id = ?').bind(id).first<any>()
  if (!row) throw new HttpError(404, 'This shared chat does not exist or was removed.')
  if (row.expires && row.expires < now()) throw new HttpError(410, 'This shared link has expired.')
  const { results } = await env.DB.prepare('SELECT chunk FROM blobs WHERE user_id = ? AND key = ? AND rev = 1 ORDER BY idx').bind(row.user_id, 'share:' + id).all<{ chunk: string }>()
  await env.DB.prepare('UPDATE shares SET views = views + 1 WHERE id = ?').bind(id).run()
  return { title: row.title, created: row.created, expires: row.expires, data: results.map((r) => r.chunk).join('') }
}
