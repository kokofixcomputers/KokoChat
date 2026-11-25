import { HttpError, quotaOf, type Env } from './util'
import { wipe } from './sync'

export const adminList = (env: Env) =>
  (env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)

export const isAdmin = (env: Env, email: string) => adminList(env).includes(email.toLowerCase())

const ID_RE = /^[0-9a-f]{32}$/

export async function listUsers(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT u.user_id, u.email, u.created, u.quota_bytes, u.disabled, u.last_login, u.last_sync,
            COALESCE(SUM(CASE WHEN i.deleted = 0 THEN i.size END), 0) + (SELECT COALESCE(SUM(size), 0) FROM shares sh WHERE sh.user_id = u.user_id) + (SELECT COALESCE(SUM(size), 0) FROM artifacts ar WHERE ar.user_id = u.user_id) AS used,
            COALESCE(SUM(CASE WHEN i.deleted = 0 THEN 1 END), 0) AS items,
            (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.user_id AND s.expires > ?) AS sessions
       FROM users u LEFT JOIN items i ON i.user_id = u.user_id
      GROUP BY u.user_id ORDER BY u.created DESC`,
  ).bind(Date.now()).all<any>()
  const dflt = quotaOf(env)
  const users = results.map((r) => ({
    userId: r.user_id,
    email: r.email,
    created: r.created,
    lastLogin: r.last_login ?? null,
    lastSync: r.last_sync ?? null,
    used: r.used,
    items: r.items,
    sessions: r.sessions,
    quota: r.quota_bytes ?? dflt,
    customQuota: r.quota_bytes != null,
    disabled: !!r.disabled,
    admin: isAdmin(env, r.email),
  }))
  return {
    users,
    defaultQuota: dflt,
    totals: { users: users.length, used: users.reduce((a, u) => a + u.used, 0), items: users.reduce((a, u) => a + u.items, 0) },
  }
}

async function target(env: Env, id: string) {
  if (!ID_RE.test(id)) throw new HttpError(400, 'Bad user id')
  const u = await env.DB.prepare('SELECT user_id, email FROM users WHERE user_id = ?').bind(id).first<{ user_id: string; email: string }>()
  if (!u) throw new HttpError(404, 'User not found')
  return u
}

export async function setQuota(env: Env, id: string, body: any) {
  await target(env, id)
  let q: number | null = null
  if (body?.quotaBytes !== null && body?.quotaBytes !== undefined) {
    q = Math.floor(Number(body.quotaBytes))
    if (!Number.isFinite(q) || q < 0 || q > 10 * 1024 * 1024 * 1024) throw new HttpError(400, 'Quota must be between 0 and 10 GB.')
  }
  await env.DB.prepare('UPDATE users SET quota_bytes = ? WHERE user_id = ?').bind(q, id).run()
  return { ok: true, quota: q ?? quotaOf(env), customQuota: q != null }
}

export async function setDisabled(env: Env, id: string, body: any, selfId: string) {
  await target(env, id)
  if (id === selfId) throw new HttpError(400, "You can't suspend your own account.")
  const disabled = !!body?.disabled
  await env.DB.prepare('UPDATE users SET disabled = ? WHERE user_id = ?').bind(disabled ? 1 : 0, id).run()
  if (disabled) await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run()
  return { ok: true, disabled }
}

export async function revokeSessions(env: Env, id: string) {
  await target(env, id)
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run()
  return { ok: true }
}

export async function deleteUser(env: Env, id: string, selfId: string) {
  const u = await target(env, id)
  if (id === selfId) throw new HttpError(400, "You can't delete your own account here. Use Settings → Sync → Delete cloud data.")
  await wipe(env, id)
  await env.DB.prepare('DELETE FROM otp WHERE email = ?').bind(u.email).run()
  return { ok: true }
}
