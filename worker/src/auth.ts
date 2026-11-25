import { HttpError, normEmail, randomCode, randomToken, safeEqual, sha256Hex, validEmail, now, type Env } from './util'
import { sendMail } from './smtp'
import { adminList, isAdmin } from './admin'

const OTP_TTL = 10 * 60 * 1000
const COOLDOWN = 30 * 1000
const MAX_PER_HOUR = 6
const MAX_ATTEMPTS = 5
const SESSION_TTL = 90 * 24 * 60 * 60 * 1000

export interface Session { userId: string; email: string }

const codeHash = (env: Env, email: string, code: string) => sha256Hex(`${email}:${code}:kokochat-otp`)

function allowed(env: Env, email: string) {
  const list = (env.ALLOWED_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  return !list.length || list.includes(email) || adminList(env).includes(email)
}

export async function requestCode(env: Env, body: any) {
  const email = normEmail(body?.email)
  if (!validEmail(email)) throw new HttpError(400, 'Enter a valid email address.')
  // Same response whether or not the email is allowed, so the allow-list cannot be probed.
  if (!allowed(env, email)) return { ok: true, expiresIn: OTP_TTL / 1000 }
  const existing = await env.DB.prepare('SELECT disabled FROM users WHERE email = ?').bind(email).first<{ disabled: number }>()
  if (existing?.disabled) return { ok: true, expiresIn: OTP_TTL / 1000 } // suspended: no email, same response

  const t = now()
  const row = await env.DB.prepare('SELECT * FROM otp WHERE email = ?').bind(email).first<any>()
  let hourStart = t, sent = 0
  if (row) {
    if (t - row.last_sent < COOLDOWN) throw new HttpError(429, `Please wait ${Math.ceil((COOLDOWN - (t - row.last_sent)) / 1000)}s before requesting another code.`)
    if (t - row.hour_start < 3600_000) { hourStart = row.hour_start; sent = row.sent_this_hour }
    if (sent >= MAX_PER_HOUR) throw new HttpError(429, 'Too many codes requested. Try again later.')
  }
  const code = randomCode()
  await env.DB.prepare(
    `INSERT INTO otp (email, code_hash, expires, attempts, last_sent, hour_start, sent_this_hour) VALUES (?, ?, ?, 0, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires = excluded.expires, attempts = 0, last_sent = excluded.last_sent, hour_start = excluded.hour_start, sent_this_hour = excluded.sent_this_hour`,
  ).bind(email, await codeHash(env, email, code), t + OTP_TTL, t, hourStart, sent + 1).run()

  const app = env.APP_NAME || 'Koko Chat'
  if (env.DEV_LOG_CODES === 'true') console.log(`[dev] sign-in code for ${email}: ${code}`)
  else {
    try {
      await sendMail(env, {
        to: email,
        subject: `${code} is your ${app} sign-in code`,
        text: `Your ${app} sign-in code is ${code}\n\nIt expires in 10 minutes. If you didn't request it, you can ignore this email.`,
        html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:420px;margin:0 auto;padding:24px"><h2 style="margin:0 0 12px">Sign in to ${app}</h2><p style="color:#555;margin:0 0 20px">Enter this code in the app:</p><div style="font-size:34px;letter-spacing:8px;font-weight:700;background:#f4f4f5;border-radius:14px;padding:18px;text-align:center">${code}</div><p style="color:#888;font-size:13px;margin-top:20px">It expires in 10 minutes. If you didn't request it, you can ignore this email.</p></div>`,
      })
    } catch (e: any) {
      console.error('send failed', e?.message)
      throw new HttpError(502, 'Could not send the email. Check the SMTP settings on the server.')
    }
  }
  return { ok: true, expiresIn: OTP_TTL / 1000 }
}

export async function verifyCode(env: Env, body: any) {
  const email = normEmail(body?.email)
  const code = String(body?.code ?? '').replace(/\D/g, '')
  if (!validEmail(email) || code.length !== 6) throw new HttpError(400, 'Enter the 6-digit code.')
  const row = await env.DB.prepare('SELECT * FROM otp WHERE email = ?').bind(email).first<any>()
  const bad = new HttpError(401, 'That code is incorrect or has expired.')
  if (!row || row.expires < now() || !allowed(env, email)) throw bad
  if (row.attempts >= MAX_ATTEMPTS) throw new HttpError(429, 'Too many attempts. Request a new code.')
  if (!safeEqual(row.code_hash, await codeHash(env, email, code))) {
    await env.DB.prepare('UPDATE otp SET attempts = attempts + 1 WHERE email = ?').bind(email).run()
    throw bad
  }
  await env.DB.prepare('UPDATE otp SET expires = 0 WHERE email = ?').bind(email).run() // single use

  const userId = (await sha256Hex('user:' + email)).slice(0, 32)
  const salt = randomToken(16)
  await env.DB.prepare('INSERT OR IGNORE INTO users (user_id, email, salt, created) VALUES (?, ?, ?, ?)').bind(userId, email, salt, now()).run()
  const user = await env.DB.prepare('SELECT salt, disabled FROM users WHERE user_id = ?').bind(userId).first<{ salt: string; disabled: number }>()
  if (user?.disabled) throw new HttpError(403, 'This account has been suspended.')
  await env.DB.prepare('UPDATE users SET last_login = ? WHERE user_id = ?').bind(now(), userId).run()

  const token = randomToken(32)
  const t = now()
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, email, created, expires) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256Hex(token), userId, email, t, t + SESSION_TTL).run()
  // opportunistic cleanup
  await env.DB.prepare('DELETE FROM sessions WHERE expires < ?').bind(t).run()
  return { token, email, salt: user!.salt, admin: isAdmin(env, email) }
}

export async function authenticate(env: Env, req: Request): Promise<Session & { tokenHash: string }> {
  const h = req.headers.get('Authorization') ?? ''
  const token = /^Bearer\s+(.+)$/i.exec(h)?.[1]
  if (!token) throw new HttpError(401, 'Not signed in.')
  const tokenHash = await sha256Hex(token)
  const row = await env.DB.prepare('SELECT s.user_id, s.email, s.expires, u.disabled FROM sessions s LEFT JOIN users u ON u.user_id = s.user_id WHERE s.token_hash = ?').bind(tokenHash).first<any>()
  if (!row || row.expires < now()) throw new HttpError(401, 'Session expired. Sign in again.')
  if (row.disabled) throw new HttpError(403, 'This account has been suspended.')
  return { userId: row.user_id, email: row.email, tokenHash }
}
