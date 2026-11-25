import { create } from 'zustand'
import type { Settings } from '../../types'
import { useStore } from '../../store'
import type { ToolDef } from '../tools'
import type { Describe, Integration, RunCtx } from './types'

/* ---------------------------------------------------------------------------
 *  Google Workspace: Calendar, Gmail, Drive (+ Docs/Sheets/Slides text).
 *  Sign-in uses Google Identity Services in the browser with the user's own OAuth client id,
 *  so there is no server and no client secret. Access is read-only, tokens last about an hour
 *  and live only in this tab's memory/session.
 * ------------------------------------------------------------------------ */

class GError extends Error {}

export const SCOPES = {
  calendar: 'https://www.googleapis.com/auth/calendar.readonly',
  gmail: 'https://www.googleapis.com/auth/gmail.readonly',
  drive: 'https://www.googleapis.com/auth/drive.readonly',
}

interface Token { accessToken: string; expiresAt: number; scope: string }
interface GState { connected: boolean; email?: string; expiresAt?: number; busy?: boolean; error?: string }

export const useGoogle = create<GState>(() => ({ connected: false }))

let token: Token | null = null
try { const raw = sessionStorage.getItem('koko:google'); if (raw) { const t = JSON.parse(raw) as Token & { email?: string }; if (t.expiresAt > Date.now() + 30_000) { token = t; useGoogle.setState({ connected: true, email: t.email, expiresAt: t.expiresAt }) } } } catch { /* ignore */ }
const save = (email?: string) => { try { token ? sessionStorage.setItem('koko:google', JSON.stringify({ ...token, email })) : sessionStorage.removeItem('koko:google') } catch { /* ignore */ } }

let gisLoad: Promise<void> | null = null
function loadGis(): Promise<void> {
  if ((window as any).google?.accounts?.oauth2) return Promise.resolve()
  return (gisLoad ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => { gisLoad = null; reject(new GError('Could not load Google sign-in.')) }
    document.head.appendChild(s)
  }))
}

export const scopesFor = (g: Settings['integrations']['google']) =>
  ['openid', 'email', g.calendar && SCOPES.calendar, g.gmail && SCOPES.gmail, g.drive && SCOPES.drive].filter(Boolean).join(' ')

/** Ask Google for an access token. `interactive` shows the consent screen; otherwise it must succeed silently. */
export function connectGoogle(interactive: boolean): Promise<void> {
  const g = useStore.getState().settings.integrations.google
  if (!g.clientId.trim()) return Promise.reject(new GError('Add your Google OAuth client id in Settings → Integrations first.'))
  useGoogle.setState({ busy: true, error: undefined })
  return loadGis().then(
    () =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { useGoogle.setState({ busy: false }); reject(new GError('Google sign-in timed out. Reconnect in Settings → Integrations.')) }, interactive ? 120_000 : 12_000)
        const client = (window as any).google.accounts.oauth2.initTokenClient({
          client_id: g.clientId.trim(),
          scope: scopesFor(g),
          prompt: interactive ? '' : 'none',
          callback: async (r: any) => {
            clearTimeout(timer)
            if (r.error || !r.access_token) {
              useGoogle.setState({ busy: false, error: r.error_description ?? r.error })
              return reject(new GError(interactive ? `Google sign-in failed: ${r.error_description ?? r.error ?? 'cancelled'}` : 'Your Google session expired. Reconnect in Settings → Integrations (sessions last about an hour).'))
            }
            token = { accessToken: r.access_token, expiresAt: Date.now() + (Number(r.expires_in) || 3600) * 1000, scope: r.scope ?? '' }
            let email: string | undefined
            try { const u = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${token.accessToken}` } }); if (u.ok) email = (await u.json()).email } catch { /* optional */ }
            save(email)
            useGoogle.setState({ connected: true, email, expiresAt: token.expiresAt, busy: false, error: undefined })
            resolve()
          },
          error_callback: (e: any) => { clearTimeout(timer); useGoogle.setState({ busy: false, error: e?.type }); reject(new GError(e?.type === 'popup_closed' ? 'The Google sign-in window was closed.' : 'Google sign-in failed.')) },
        })
        client.requestAccessToken()
      }),
    (e) => { useGoogle.setState({ busy: false }); throw e },
  )
}

export function disconnectGoogle() {
  const t = token
  token = null
  save()
  useGoogle.setState({ connected: false, email: undefined, expiresAt: undefined })
  try { if (t) (window as any).google?.accounts?.oauth2?.revoke(t.accessToken, () => {}) } catch { /* ignore */ }
}

async function bearer(): Promise<string> {
  if (token && token.expiresAt > Date.now() + 60_000) return token.accessToken
  await connectGoogle(false)
  return token!.accessToken
}

async function gg(url: string, ctx: RunCtx, init?: RequestInit): Promise<Response> {
  const t = await bearer()
  let res: Response
  try { res = await fetch(url, { signal: ctx.signal, ...init, headers: { Authorization: `Bearer ${t}`, ...(init?.headers ?? {}) } }) } catch (e: any) {
    if (e?.name === 'AbortError') throw e
    throw new GError('Could not reach Google.')
  }
  if (res.ok) return res
  const j: any = await res.json().catch(() => ({}))
  const msg: string = j.error?.message ?? ''
  if (res.status === 401) { token = null; save(); useGoogle.setState({ connected: false }); throw new GError('Your Google session expired. Reconnect in Settings → Integrations.') }
  if (res.status === 403 && /has not been used|is disabled|accessNotConfigured/i.test(msg + (j.error?.status ?? ''))) throw new GError(`That Google API is not enabled for your OAuth project. Enable it in the Google Cloud console (${msg.slice(0, 120)}).`)
  if (res.status === 403) throw new GError(`Google denied access${msg ? ': ' + msg.slice(0, 160) : ''}. Reconnect and approve all permissions.`)
  if (res.status === 404) throw new GError('Not found.')
  if (res.status === 429) throw new GError('Google is rate limiting requests. Try again shortly.')
  throw new GError(msg ? `Google: ${msg.slice(0, 200)}` : `Google returned ${res.status}.`)
}
const gj = async (url: string, ctx: RunCtx) => (await gg(url, ctx)).json()

const clip = (t: string, n = 20_000) => (t.length > n ? t.slice(0, n) + `\n…[truncated, ${t.length} characters total]` : t)
const meta = (ctx: RunCtx, m: Record<string, unknown>) => ctx.update((b) => { b.meta = { ...(b.meta ?? {}), ...m } })
const b64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)))
const when = (ev: any) => {
  const s = ev.start?.dateTime ?? ev.start?.date
  const e = ev.end?.dateTime ?? ev.end?.date
  if (!s) return '?'
  if (ev.start?.date) return `${s}${e && e !== s ? ' → ' + e : ''} (all day)`
  const f = (x: string) => new Date(x).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return `${f(s)} – ${new Date(e).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
}

/* ----------------------------------- tools ----------------------------------- */
const T_CAL: ToolDef = {
  name: 'google_calendar',
  description: 'Read the user\'s Google Calendar: upcoming or past events in a date range, optionally filtered by text. Use it for questions about schedule, availability and meetings.',
  parameters: {
    type: 'object',
    properties: { from: { type: 'string', description: 'Start (ISO date/time). Default: now.' }, to: { type: 'string', description: 'End (ISO date/time). Default: 14 days after the start.' }, query: { type: 'string', description: 'Free-text filter.' }, calendar: { type: 'string', description: 'Calendar id (default "primary").' }, limit: { type: 'number', description: 'Default 25, max 100.' } },
    additionalProperties: false,
  },
}
const T_GMAIL_SEARCH: ToolDef = {
  name: 'gmail_search',
  description: 'Search the user\'s Gmail using Gmail search syntax (from:, subject:, after:2025/01/01, is:unread, has:attachment, label:…). Returns sender, subject, date and a snippet for each message.',
  parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number', description: 'Default 10, max 20.' } }, required: ['query'], additionalProperties: false },
}
const T_GMAIL_READ: ToolDef = {
  name: 'gmail_read',
  description: 'Read one email in full (headers, text body, attachment names). Use an id from gmail_search.',
  parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
}
const T_DRIVE_SEARCH: ToolDef = {
  name: 'drive_search',
  description: 'Search the user\'s Google Drive for files by name or content. Returns names, types, owners and ids.',
  parameters: { type: 'object', properties: { query: { type: 'string' }, type: { type: 'string', enum: ['any', 'doc', 'sheet', 'slides', 'pdf', 'folder'] }, limit: { type: 'number', description: 'Default 10, max 25.' } }, required: ['query'], additionalProperties: false },
}
const T_DRIVE_READ: ToolDef = {
  name: 'drive_read',
  description: 'Read the text of a Google Drive file by id: Google Docs and Slides as text, Sheets as CSV, and plain text/markdown/CSV/JSON files. (PDFs and other binary files cannot be read.)',
  parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
}

const toolsFor = (s: Settings): ToolDef[] => {
  const g = s.integrations.google
  return [...(g.calendar ? [T_CAL] : []), ...(g.gmail ? [T_GMAIL_SEARCH, T_GMAIL_READ] : []), ...(g.drive ? [T_DRIVE_SEARCH, T_DRIVE_READ] : [])]
}

function bodyText(payload: any): { text: string; attachments: string[] } {
  const attachments: string[] = []
  let plain = '', html = ''
  const walk = (p: any) => {
    if (!p) return
    if (p.filename) attachments.push(`${p.filename} (${p.mimeType}${p.body?.size ? ', ' + Math.round(p.body.size / 1024) + ' KB' : ''})`)
    else if (p.body?.data) {
      if (p.mimeType === 'text/plain') plain += b64(p.body.data)
      else if (p.mimeType === 'text/html') html += b64(p.body.data)
    }
    ;(p.parts ?? []).forEach(walk)
  }
  walk(payload)
  const stripped = html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n')
  return { text: (plain || stripped).trim(), attachments }
}
const hdr = (m: any, n: string) => m.payload?.headers?.find((h: any) => h.name.toLowerCase() === n.toLowerCase())?.value ?? ''
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

async function run(tool: string, a: Record<string, any>, ctx: RunCtx): Promise<{ output: string }> {
  if (tool === 'google_calendar') {
    const from = a.from ? new Date(String(a.from)) : new Date()
    const to = a.to ? new Date(String(a.to)) : new Date(from.getTime() + 14 * 86_400_000)
    if (isNaN(+from) || isNaN(+to)) throw new GError('Use ISO dates like 2025-03-01 or 2025-03-01T09:00:00.')
    const cal = encodeURIComponent(String(a.calendar ?? 'primary'))
    const qs = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: String(Math.min(100, Math.max(1, Number(a.limit) || 25))) })
    if (a.query) qs.set('q', String(a.query))
    const j = await gj(`https://www.googleapis.com/calendar/v3/calendars/${cal}/events?${qs}`, ctx)
    const evs: any[] = j.items ?? []
    meta(ctx, { url: 'https://calendar.google.com/', summary: `${evs.length} events` })
    const head = `Now: ${new Date().toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone}). Events ${from.toLocaleDateString()} – ${to.toLocaleDateString()}:`
    if (!evs.length) return { output: `${head}\nNo events.` }
    return { output: `${head}\n` + evs.map((e) => `- ${when(e)} — ${e.summary ?? '(no title)'}${e.location ? ` @ ${e.location}` : ''}${e.attendees?.length ? ` · ${e.attendees.length} attendees (${e.attendees.slice(0, 5).map((x: any) => x.displayName ?? x.email).join(', ')})` : ''}${e.hangoutLink ? ` · ${e.hangoutLink}` : ''}${e.description ? `\n    ${String(e.description).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').slice(0, 300)}` : ''}`).join('\n') }
  }

  if (tool === 'gmail_search') {
    const limit = Math.min(20, Math.max(1, Number(a.limit) || 10))
    const q = String(a.query ?? '').trim()
    const list = await gj(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=${limit}`, ctx)
    const ids: { id: string }[] = list.messages ?? []
    meta(ctx, { url: `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(q)}`, summary: `${ids.length} emails` })
    if (!ids.length) return { output: 'No emails matched.' }
    const msgs = await Promise.all(ids.map((m) => gj(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, ctx)))
    return { output: msgs.map((m) => `id ${m.id} | ${hdr(m, 'Date').slice(0, 25)} | ${hdr(m, 'From')} | ${hdr(m, 'Subject') || '(no subject)'} — ${String(m.snippet ?? '').slice(0, 140)}`).join('\n') }
  }

  if (tool === 'gmail_read') {
    const id = String(a.id ?? '').trim()
    if (!id) throw new GError('Provide the message id from gmail_search.')
    const m = await gj(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`, ctx)
    const { text, attachments } = bodyText(m.payload)
    meta(ctx, { url: `https://mail.google.com/mail/u/0/#all/${id}`, label: hdr(m, 'Subject') || 'email', summary: `${text.length} characters` })
    return { output: clip(`From: ${hdr(m, 'From')}\nTo: ${hdr(m, 'To')}${hdr(m, 'Cc') ? `\nCc: ${hdr(m, 'Cc')}` : ''}\nDate: ${hdr(m, 'Date')}\nSubject: ${hdr(m, 'Subject')}${attachments.length ? `\nAttachments: ${attachments.join('; ')}` : ''}\n\n${text || '(no text body)'}`) }
  }

  if (tool === 'drive_search') {
    const q = String(a.query ?? '').trim()
    const mime = { doc: "mimeType='application/vnd.google-apps.document'", sheet: "mimeType='application/vnd.google-apps.spreadsheet'", slides: "mimeType='application/vnd.google-apps.presentation'", pdf: "mimeType='application/pdf'", folder: "mimeType='application/vnd.google-apps.folder'" }[a.type as string]
    const clauses = ['trashed=false', q ? `(name contains '${esc(q)}' or fullText contains '${esc(q)}')` : '', mime ?? ''].filter(Boolean).join(' and ')
    const qs = new URLSearchParams({ q: clauses, pageSize: String(Math.min(25, Math.max(1, Number(a.limit) || 10))), orderBy: 'modifiedTime desc', fields: 'files(id,name,mimeType,modifiedTime,owners(displayName),webViewLink,size)' })
    const j = await gj(`https://www.googleapis.com/drive/v3/files?${qs}`, ctx)
    const files: any[] = j.files ?? []
    meta(ctx, { url: `https://drive.google.com/drive/search?q=${encodeURIComponent(q)}`, summary: `${files.length} files` })
    if (!files.length) return { output: 'No files matched.' }
    return { output: files.map((f) => `${f.name} — ${String(f.mimeType).replace('application/vnd.google-apps.', 'google ').replace('application/', '')} — modified ${String(f.modifiedTime).slice(0, 10)} — ${f.owners?.[0]?.displayName ?? '?'} — id ${f.id}`).join('\n') }
  }

  if (tool === 'drive_read') {
    const id = String(a.id ?? '').trim()
    if (!id) throw new GError('Provide the file id from drive_search.')
    const f = await gj(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,webViewLink`, ctx)
    meta(ctx, { url: f.webViewLink, label: f.name })
    const m: string = f.mimeType
    let url: string
    if (m === 'application/vnd.google-apps.document' || m === 'application/vnd.google-apps.presentation') url = `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=${encodeURIComponent('text/plain')}`
    else if (m === 'application/vnd.google-apps.spreadsheet') url = `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=${encodeURIComponent('text/csv')}`
    else if (/^text\/|json|csv|markdown|xml|javascript|yaml/.test(m)) url = `https://www.googleapis.com/drive/v3/files/${id}?alt=media`
    else throw new GError(`"${f.name}" is a ${m.replace('application/', '')} file, which cannot be read as text.`)
    const text = await (await gg(url, ctx)).text()
    meta(ctx, { summary: `${text.length} characters` })
    return { output: clip(`${f.name}:\n${text}`, 30_000) }
  }
  throw new GError(`Unknown Google action ${tool}`)
}

function describe(tool: string, a: Record<string, any>): Describe {
  switch (tool) {
    case 'google_calendar':
      return { present: 'Checking Google Calendar', past: 'Checked Google Calendar', subject: a.query ? `“${a.query}”` : undefined, extra: a.from || a.to ? `(${String(a.from ?? 'now').slice(0, 10)} → ${String(a.to ?? '').slice(0, 10) || 'soon'})` : undefined, icon: 'calendar', url: 'https://calendar.google.com/', failed: "Couldn't check Google Calendar" }
    case 'gmail_search':
      return { present: 'Searching Gmail for', past: 'Searched Gmail for', subject: `“${a.query ?? ''}”`, icon: 'gmail', url: a.query ? `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(String(a.query))}` : undefined, failed: "Couldn't search Gmail for" }
    case 'gmail_read':
      return { present: 'Reading email', past: 'Read email', subject: undefined, icon: 'gmail', failed: "Couldn't read email" }
    case 'drive_search':
      return { present: 'Searching Google Drive for', past: 'Searched Google Drive for', subject: `“${a.query ?? ''}”`, icon: 'drive', failed: "Couldn't search Google Drive for" }
    default:
      return { present: 'Reading Google Drive file', past: 'Read Google Drive file', subject: undefined, icon: 'drive', failed: "Couldn't read Google Drive file" }
  }
}

export const google: Integration = {
  id: 'google', name: 'Google', icon: 'google', tools: [T_CAL, T_GMAIL_SEARCH, T_GMAIL_READ, T_DRIVE_SEARCH, T_DRIVE_READ],
  prompt: 'You can read the user\'s Google Workspace: Calendar (google_calendar), Gmail (gmail_search, gmail_read) and Drive (drive_search, drive_read). When they ask about their schedule, emails, documents or files, look at the real data instead of guessing. Search first, then read the specific item. Be careful with private information: quote only what is relevant. Access is read-only. If a call says the session expired or Google is not connected, tell them to reconnect in Settings → Integrations.',
  enabled: (s: Settings) => s.integrations.google.enabled && !!s.integrations.google.clientId.trim() && toolsFor(s).length > 0,
  owns: (t) => t === 'google_calendar' || t.startsWith('gmail_') || t.startsWith('drive_'),
  describe, run,
  triggers: /\b(my|the) (calendar|inbox|gmail|google drive|drive)\b|\bgoogle (calendar|drive|docs?|sheets?)\b|\b(emails?|meetings?|schedule) (from|with|about|today|tomorrow|this week)\b/i,
}

/** Only the tools for services the user switched on. */
export const googleToolsFor = toolsFor
