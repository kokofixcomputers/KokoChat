import { HttpError, now, quotaOf, type Env } from './util'

export const CHUNK_SIZE = 400_000
const KEY_RE = /^(settings|selected|chat:[\w-]{4,64}|provider:[\w-]{1,64}|mcp:[\w-]{1,64}|cowork:[\w-]{1,64}|memory:[\w-]{1,64})$/
const CHUNK = 400_000 // characters; <= ~1.2 MB of UTF-8, safely under D1's 2 MB row limit
const enc = new TextEncoder()

const chunks = (s: string) => {
  const out: string[] = []
  for (let i = 0; i < s.length; i += CHUNK) out.push(s.slice(i, i + CHUNK))
  return out.length ? out : ['']
}

export async function usage(env: Env, userId: string) {
  const r = await env.DB.prepare('SELECT COALESCE(SUM(size), 0) AS used FROM items WHERE user_id = ? AND deleted = 0').bind(userId).first<{ used: number }>()
  const sh = await env.DB.prepare('SELECT COALESCE(SUM(size), 0) AS used FROM shares WHERE user_id = ?').bind(userId).first<{ used: number }>()
  const u = await env.DB.prepare('SELECT quota_bytes FROM users WHERE user_id = ?').bind(userId).first<{ quota_bytes: number | null }>()
  return { used: (r?.used ?? 0) + (sh?.used ?? 0), quota: u?.quota_bytes ?? quotaOf(env) }
}

export async function index(env: Env, userId: string, admin = false) {
  const { results } = await env.DB.prepare('SELECT key, rev, deleted, updated_at, size FROM items WHERE user_id = ?').bind(userId).all<any>()
  const items: Record<string, { rev: number; deleted: boolean; updatedAt: number; size: number }> = {}
  for (const r of results) items[r.key] = { rev: r.rev, deleted: !!r.deleted, updatedAt: r.updated_at, size: r.size }
  return { items, usage: await usage(env, userId), admin }
}

export async function get(env: Env, userId: string, body: any) {
  const keys: string[] = Array.isArray(body?.keys) ? body.keys.filter((k: unknown) => typeof k === 'string' && KEY_RE.test(k)).slice(0, 25) : []
  const out: Record<string, { rev: number; deleted: boolean; updatedAt: number; data: string | null }> = {}
  await Promise.all(
    keys.map(async (key) => {
      const row = await env.DB.prepare('SELECT rev, deleted, updated_at FROM items WHERE user_id = ? AND key = ?').bind(userId, key).first<any>()
      if (!row) return
      let data: string | null = null
      if (!row.deleted) {
        const { results } = await env.DB.prepare('SELECT chunk FROM blobs WHERE user_id = ? AND key = ? AND rev = ? ORDER BY idx').bind(userId, key, row.rev).all<{ chunk: string }>()
        data = results.length ? results.map((r) => r.chunk).join('') : null
      }
      out[key] = { rev: row.rev, deleted: !!row.deleted, updatedAt: row.updated_at, data }
    }),
  )
  return { items: out }
}

type Change = { key: string; baseRev: number; data: string | null; deleted?: boolean }

const dropChunks = (env: Env, userId: string, key: string, rev: number) =>
  env.DB.prepare('DELETE FROM blobs WHERE user_id = ? AND key = ? AND rev = ?').bind(userId, key, rev).run().catch(() => {})

/** Optimistic-concurrency writes: a change is only accepted if baseRev equals the server's current rev. */
export async function put(env: Env, userId: string, body: any) {
  const changes: Change[] = Array.isArray(body?.changes) ? body.changes.slice(0, 25) : []
  const results: { key: string; status: 'ok' | 'conflict' | 'quota' | 'error'; rev?: number; error?: string }[] = []
  let { used, quota } = await usage(env, userId)

  for (const ch of changes) {
    if (typeof ch?.key !== 'string' || !KEY_RE.test(ch.key)) { results.push({ key: String(ch?.key), status: 'error', error: 'bad key' }); continue }
    const del = !!ch.deleted
    if (!del && typeof ch.data !== 'string') { results.push({ key: ch.key, status: 'error', error: 'bad payload' }); continue }
    const base = Number(ch.baseRev) || 0
    const row = await env.DB.prepare('SELECT rev, deleted, size FROM items WHERE user_id = ? AND key = ?').bind(userId, ch.key).first<{ rev: number; deleted: number; size: number }>()
    const cur = row?.rev ?? 0
    if (cur !== base) { results.push({ key: ch.key, status: 'conflict', rev: cur }); continue }

    const size = del ? 0 : enc.encode(ch.data as string).length
    const oldSize = row && !row.deleted ? row.size : 0
    if (!del && used - oldSize + size > quota) { results.push({ key: ch.key, status: 'quota' }); continue }

    const next = cur + 1
    if (!del) {
      const parts = chunks(ch.data as string)
      await env.DB.batch(parts.map((c, i) => env.DB.prepare('INSERT OR REPLACE INTO blobs (user_id, key, rev, idx, chunk) VALUES (?, ?, ?, ?, ?)').bind(userId, ch.key, next, i, c)))
    }
    let changed = 0
    if (cur === 0) {
      const r = await env.DB.prepare('INSERT OR IGNORE INTO items (user_id, key, rev, deleted, updated_at, size) VALUES (?, ?, ?, ?, ?, ?)').bind(userId, ch.key, next, del ? 1 : 0, now(), size).run()
      changed = r.meta.changes
    } else {
      const r = await env.DB.prepare('UPDATE items SET rev = ?, deleted = ?, updated_at = ?, size = ? WHERE user_id = ? AND key = ? AND rev = ?').bind(next, del ? 1 : 0, now(), size, userId, ch.key, cur).run()
      changed = r.meta.changes
    }
    if (!changed) { // lost a race with another device
      if (!del) await dropChunks(env, userId, ch.key, next)
      const again = await env.DB.prepare('SELECT rev FROM items WHERE user_id = ? AND key = ?').bind(userId, ch.key).first<{ rev: number }>()
      results.push({ key: ch.key, status: 'conflict', rev: again?.rev ?? 0 })
      continue
    }
    if (cur > 0) await dropChunks(env, userId, ch.key, cur)
    used = used - oldSize + size
    results.push({ key: ch.key, status: 'ok', rev: next })
  }
  if (results.some((r) => r.status === 'ok')) await env.DB.prepare('UPDATE users SET last_sync = ? WHERE user_id = ?').bind(now(), userId).run()
  return { results, usage: { used, quota } }
}

export async function wipe(env: Env, userId: string) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM blobs WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM items WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM shares WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM users WHERE user_id = ?').bind(userId),
  ])
}

export { HttpError }
