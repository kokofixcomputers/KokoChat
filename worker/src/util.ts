export interface Env {
  DB: D1Database
  /** Workers AI binding (speech-to-text) */
  AI?: { run: (model: string, input: unknown) => Promise<any> }
  APP_NAME: string
  ALLOWED_ORIGINS: string
  ALLOWED_EMAILS: string
  /** comma-separated emails that get the in-app admin panel */
  ADMIN_EMAILS?: string
  SMTP_HOST: string
  SMTP_PORT: string
  SMTP_SECURE: string
  SMTP_USER: string
  SMTP_PASS: string // secret
  SMTP_FROM: string
  DEV_LOG_CODES?: string
  /** per-account storage cap in bytes (default 3 MB) */
  QUOTA_BYTES?: string
  /** address of the deployed web app; published chart and diagram pages load their viewer from it */
  VIEWER_URL?: string
  /** optional: lets admins use the sandbox without pasting a Freestyle key into the app */
  FREESTYLE_API_KEY?: string
  /** test hook; defaults to https://api.freestyle.sh */
  FREESTYLE_BASE_URL?: string
  /** "Sign in with 1minRelay": the OAuth app's id (public) and secret (wrangler secret), the relay host, and the allowed redirect addresses */
  ONEMIN_CLIENT_ID?: string
  ONEMIN_CLIENT_SECRET?: string
  ONEMIN_HOST?: string
  ONEMIN_REDIRECTS?: string
}

const enc = new TextEncoder()

export const now = () => Date.now()
export const quotaOf = (env: Env) => Number(env.QUOTA_BYTES) > 0 ? Number(env.QUOTA_BYTES) : 3 * 1024 * 1024

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function randomToken(bytes = 32): string {
  const a = crypto.getRandomValues(new Uint8Array(bytes))
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function randomCode(): string {
  // uniform 6-digit code
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000
  return String(n).padStart(6, '0')
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) { super(message) }
}

export function corsHeaders(env: Env, req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? ''
  const allowed = (env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean)
  const ok = allowed.includes('*') || allowed.includes(origin)
  return {
    'Access-Control-Allow-Origin': ok ? (allowed.includes('*') ? '*' : origin) : allowed[0] ?? '',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Freestyle-Key, Range',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Retry-After',
    Vary: 'Origin',
  }
}

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } })

export const normEmail = (e: unknown) => String(e ?? '').trim().toLowerCase()
export const validEmail = (e: string) => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
