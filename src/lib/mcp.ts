import type { McpServer, McpTool } from '../types'
import type { ToolDef } from './tools'
import { sse } from './sse'
import { accessToken } from './mcpAuth'

const sessions = new Map<string, string | null>()
let rid = 1

async function headers(s: McpServer, sessionId?: string | null): Promise<Record<string, string>> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': '2025-06-18',
  }
  const oauth = await accessToken(s)
  const tok = oauth ?? s.token
  if (tok) h.Authorization = oauth || /^(bearer|basic)\s/i.test(tok) ? (oauth ? `Bearer ${tok}` : tok) : `Bearer ${tok}`
  if (sessionId) h['Mcp-Session-Id'] = sessionId
  return h
}

async function rpc(s: McpServer, method: string, params: unknown, signal?: AbortSignal, notify = false, retried = false): Promise<any> {
  const id = notify ? undefined : rid++
  const res = await fetch(s.url, {
    method: 'POST',
    headers: await headers(s, sessions.get(s.id)),
    body: JSON.stringify({ jsonrpc: '2.0', ...(id ? { id } : {}), method, params }),
    signal,
  })
  const sid = res.headers.get('Mcp-Session-Id')
  if (sid) sessions.set(s.id, sid)
  if (res.status === 401) {
    if (!retried && s.oauth?.refreshToken && (await accessToken(s, true))) return rpc(s, method, params, signal, notify, true)
    const e: any = new Error('Authorization required. Open Settings → MCP servers and click Authorize.')
    e.status = 401
    e.wwwAuthenticate = res.headers.get('WWW-Authenticate')
    throw e
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 160)
    const e: any = new Error(`MCP ${res.status} ${res.statusText}${body ? ` — ${body}` : ''}`)
    e.status = res.status
    throw e
  }
  if (notify || res.status === 202) return null
  const ct = res.headers.get('content-type') ?? ''
  let msg: any
  if (ct.includes('text/event-stream')) {
    for await (const ev of sse(res)) {
      try {
        const d = JSON.parse(ev.data)
        if (d.id === id) { msg = d; break }
      } catch { /* ignore */ }
    }
  } else msg = await res.json()
  if (!msg) throw new Error('MCP: empty response')
  if (msg.error) throw new Error(msg.error.message ?? 'MCP error')
  return msg.result
}

async function init(s: McpServer, signal?: AbortSignal) {
  sessions.delete(s.id)
  await rpc(s, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Koko Chat', version: '1.0.0' } }, signal)
  await rpc(s, 'notifications/initialized', {}, signal, true).catch(() => {})
}

async function withSession<T>(s: McpServer, fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!sessions.has(s.id)) await init(s, signal)
  try { return await fn() } catch (e: any) {
    if (e.status === 404 || e.status === 400) { await init(s, signal); return fn() }
    throw e
  }
}

export async function listMcpTools(s: McpServer): Promise<McpTool[]> {
  sessions.delete(s.id)
  return withSession(s, async () => {
    const out: McpTool[] = []
    let cursor: string | undefined
    do {
      const r = await rpc(s, 'tools/list', cursor ? { cursor } : {})
      for (const t of r?.tools ?? []) out.push({ name: t.name, description: t.description, inputSchema: t.inputSchema })
      cursor = r?.nextCursor
    } while (cursor)
    return out
  })
}

export async function callMcpTool(s: McpServer, name: string, args: unknown, signal?: AbortSignal): Promise<string> {
  const r = await withSession(s, () => rpc(s, 'tools/call', { name, arguments: args ?? {} }, signal), signal)
  const parts: string[] = []
  for (const c of r?.content ?? []) {
    if (c.type === 'text') parts.push(c.text)
    else if (c.type === 'resource') parts.push(c.resource?.text ?? `[resource ${c.resource?.uri}]`)
    else parts.push(`[${c.type} content omitted]`)
  }
  if (!parts.length && r?.structuredContent) parts.push(JSON.stringify(r.structuredContent))
  const text = parts.join('\n').slice(0, 30000)
  return r?.isError ? `Error: ${text}` : text || '(no output)'
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 16) || 'srv'

export interface McpBinding { server: McpServer; tool: string }

export function buildMcp(servers: McpServer[]) {
  const defs: ToolDef[] = []
  const lookup = new Map<string, McpBinding>()
  for (const s of servers.filter((x) => x.enabled)) {
    for (const t of s.tools) {
      if (s.disabledTools?.includes(t.name)) continue
      const name = `mcp_${slug(s.name)}__${t.name.replace(/[^a-zA-Z0-9_-]/g, '_')}`.slice(0, 64)
      if (lookup.has(name)) continue
      lookup.set(name, { server: s, tool: t.name })
      const params: any = t.inputSchema && (t.inputSchema as any).type === 'object' ? t.inputSchema : { type: 'object', properties: {} }
      defs.push({ name, description: `[${s.name}] ${t.description ?? t.name}`.slice(0, 1000), parameters: params })
    }
  }
  return { defs, lookup }
}

export const parseMcpName = (n: string) => {
  const m = /^mcp_([^_].*?)__(.+)$/.exec(n)
  return m ? { server: m[1], tool: m[2] } : null
}
