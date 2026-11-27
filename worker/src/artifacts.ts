import { HttpError, now, randomToken, type Env } from './util'
import { usage } from './sync'
import { addBadge, badgeScript, maskEmail } from './badge'

const MAX_PAGE = 4 * 1024 * 1024
const CHUNK = 400_000
const enc = new TextEncoder()
const ID_RE = /^[\w-]{10,40}$/
// 'html' is the page itself; the others are source that the app's viewer draws
const KINDS = ['html', 'chart', 'diagram', 'mermaid']

const chunks = (s: string) => {
  const out: string[] = []
  for (let i = 0; i < s.length; i += CHUNK) out.push(s.slice(i, i + CHUNK))
  return out.length ? out : ['']
}

/** Publish (or republish, when `ref` already has a page) an HTML artifact, chart or diagram. */
export async function publish(env: Env, userId: string, body: any) {
  const kind = String(body?.kind ?? 'html')
  if (!KINDS.includes(kind)) throw new HttpError(400, 'That kind of artifact cannot be published.')
  const html = kind === 'html' ? body?.html : body?.content
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
      ? env.DB.prepare('UPDATE artifacts SET title = ?, updated = ?, size = ?, kind = ? WHERE id = ?').bind(title, t, size, kind, id)
      : env.DB.prepare('INSERT INTO artifacts (id, user_id, ref, title, created, updated, views, size, kind) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)').bind(id, userId, ref, title, t, t, size, kind),
  ])
  return { id, path: `/artifact/${id}`, updated: t, size, republished: !!prev }
}

export async function list(env: Env, userId: string) {
  const { results } = await env.DB.prepare('SELECT id, kind, ref, title, created, updated, views, size FROM artifacts WHERE user_id = ? ORDER BY updated DESC').bind(userId).all<any>()
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

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)

/**
 * The shell for a published chart or diagram: the source as inert JSON, drawn by the viewer from the app's site.
 * It is sandboxed like HTML pages, and may additionally run scripts and fetch code only from that site.
 */
function viewerPage(viewerUrl: string, kind: string, title: string, content: string, publisher: string) {
  const base = viewerUrl.replace(/\/+$/, '')
  const origin = new URL(base).origin
  const nonce = randomToken(16)
  const csp = [
    'sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox',
    "default-src 'none'",
    `script-src ${origin} 'nonce-${nonce}'`,
    `style-src ${origin} 'unsafe-inline' https://fonts.googleapis.com`,
    `font-src ${origin} https://fonts.gstatic.com data:`,
    `img-src ${origin} https: data:`,
    `connect-src ${origin}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
  // `<` is escaped so nothing in the source can close the script element
  const data = JSON.stringify({ kind, title, content }).replace(/</g, '\\u003c')
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;450;500;600&family=JetBrains+Mono:wght@400;500&display=swap">
<style>html,body,#root{height:100%;margin:0}@supports (height:100dvh){#root{height:100dvh}}body{font-family:system-ui;color:#777;background:#f4f4f5}@media (prefers-color-scheme:dark){body{background:#0d0d0e}}</style></head>
<body><div id="root"><p style="padding:24px;text-align:center">Loading…</p></div><script type="application/json" id="koko-artifact">${data}</script><script type="module" crossorigin src="${esc(base)}/viewer/viewer.js"></script>${badgeScript(publisher, nonce)}</body></html>`
  return { html, csp }
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
  const row = await env.DB.prepare('SELECT a.user_id, a.kind, a.title, u.email FROM artifacts a LEFT JOIN users u ON u.user_id = a.user_id WHERE a.id = ?').bind(id).first<{ user_id: string; kind: string; title: string; email: string | null }>()
  if (!row) return gone(404, 'This page does not exist or was unpublished.')
  const { results } = await env.DB.prepare('SELECT chunk FROM blobs WHERE user_id = ? AND key = ? AND rev = 1 ORDER BY idx').bind(row.user_id, 'artifact:' + id).all<{ chunk: string }>()
  await env.DB.prepare('UPDATE artifacts SET views = views + 1 WHERE id = ?').bind(id).run()
  const content = results.map((r) => r.chunk).join('')
  const publisher = maskEmail(row.email)
  if (row.kind === 'html') return new Response(addBadge(content, badgeScript(publisher)), { headers })
  if (!env.VIEWER_URL) return gone(503, 'This server is not set up to show charts and diagrams.')
  const page = viewerPage(env.VIEWER_URL, row.kind, row.title, content, publisher)
  return new Response(page.html, { headers: { ...headers, 'Content-Security-Policy': page.csp } })
}
