import type { Settings } from '../../types'
import type { ToolDef } from '../tools'
import type { Describe, Integration, RunCtx } from './types'

const API = 'https://api.notion.com/v1'
const VERSION = '2022-06-28'

class NError extends Error {}
const clip = (t: string, n = 30_000) => (t.length > n ? t.slice(0, n) + `\n…[truncated, ${t.length} characters total]` : t)

async function nx(path: string, ctx: RunCtx, body?: unknown): Promise<any> {
  const token = ctx.settings.integrations.notion.token.trim()
  if (!token) throw new NError('No Notion token. Ask the user to add one in Settings → Integrations.')
  let res: Response
  try {
    res = await fetch(API + path, {
      method: body === undefined ? 'GET' : 'POST', signal: ctx.signal,
      headers: { Authorization: `Bearer ${token}`, 'Notion-Version': VERSION, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e
    throw new NError('Could not reach Notion.')
  }
  if (res.ok) return res.json()
  const j: any = await res.json().catch(() => ({}))
  if (res.status === 401) throw new NError('The Notion token was rejected. Check it in Settings → Integrations.')
  if (res.status === 404) throw new NError('Not found. In Notion, open the page or database, choose ••• → Connections and add your integration so it can see it.')
  if (res.status === 429) throw new NError('Notion is rate limiting requests. Try again in a moment.')
  throw new NError(j.message ? `Notion: ${String(j.message).slice(0, 200)}` : `Notion returned ${res.status}.`)
}

/** Notion ids come bare, dashed, or inside a notion.so URL. */
export function notionId(input: unknown): string | null {
  const s = String(input ?? '').trim()
  const m = /([0-9a-f]{32})(?![0-9a-f])/i.exec(s.replace(/-/g, '')) ?? null
  if (!m) return null
  const x = m[1].toLowerCase()
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`
}

const rich = (arr: any[] | undefined): string =>
  (arr ?? []).map((t) => (t.href && t.plain_text ? `[${t.plain_text}](${t.href})` : t.plain_text ?? '')).join('')

function titleOf(obj: any): string {
  if (obj.object === 'database') return rich(obj.title) || 'Untitled database'
  for (const p of Object.values<any>(obj.properties ?? {})) if (p.type === 'title') return rich(p.title) || 'Untitled'
  return 'Untitled'
}

function propValue(p: any): string {
  switch (p.type) {
    case 'title': return rich(p.title)
    case 'rich_text': return rich(p.rich_text)
    case 'number': return p.number == null ? '' : String(p.number)
    case 'select': return p.select?.name ?? ''
    case 'status': return p.status?.name ?? ''
    case 'multi_select': return (p.multi_select ?? []).map((x: any) => x.name).join(', ')
    case 'date': return p.date ? `${p.date.start}${p.date.end ? ' → ' + p.date.end : ''}` : ''
    case 'checkbox': return p.checkbox ? 'yes' : 'no'
    case 'url': return p.url ?? ''
    case 'email': return p.email ?? ''
    case 'phone_number': return p.phone_number ?? ''
    case 'people': return (p.people ?? []).map((x: any) => x.name ?? x.id).join(', ')
    case 'created_time': return p.created_time
    case 'last_edited_time': return p.last_edited_time
    case 'formula': return String(p.formula?.[p.formula?.type] ?? '')
    case 'relation': return p.relation?.length ? `${p.relation.length} linked` : ''
    case 'rollup': return p.rollup?.type === 'number' ? String(p.rollup.number) : p.rollup?.type === 'array' ? `${p.rollup.array?.length ?? 0} items` : ''
    case 'files': return (p.files ?? []).map((f: any) => f.name).join(', ')
    default: return ''
  }
}

/* ------------------------------ blocks → markdown ------------------------------ */
async function blocksToMarkdown(id: string, ctx: RunCtx, depth: number, budget: { left: number }): Promise<string> {
  const lines: string[] = []
  let cursor: string | undefined
  do {
    const j = await nx(`/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`, ctx)
    const kids: string[] = []
    let n = 0
    for (const b of j.results as any[]) {
      if (budget.left-- <= 0) { lines.push('…[page truncated]'); return lines.join('\n') }
      const t = b.type
      const data = b[t] ?? {}
      let line = ''
      switch (t) {
        case 'paragraph': line = rich(data.rich_text); break
        case 'heading_1': line = `# ${rich(data.rich_text)}`; break
        case 'heading_2': line = `## ${rich(data.rich_text)}`; break
        case 'heading_3': line = `### ${rich(data.rich_text)}`; break
        case 'bulleted_list_item': line = `- ${rich(data.rich_text)}`; break
        case 'numbered_list_item': line = `${++n}. ${rich(data.rich_text)}`; break
        case 'to_do': line = `- [${data.checked ? 'x' : ' '}] ${rich(data.rich_text)}`; break
        case 'toggle': line = `▸ ${rich(data.rich_text)}`; break
        case 'quote': line = `> ${rich(data.rich_text)}`; break
        case 'callout': line = `> ${data.icon?.emoji ? data.icon.emoji + ' ' : ''}${rich(data.rich_text)}`; break
        case 'code': line = '```' + (data.language ?? '') + '\n' + rich(data.rich_text) + '\n```'; break
        case 'divider': line = '---'; break
        case 'equation': line = `$$${data.expression}$$`; break
        case 'child_page': line = `[Page: ${data.title}] (id ${b.id})`; break
        case 'child_database': line = `[Database: ${data.title}] (id ${b.id})`; break
        case 'bookmark': case 'link_preview': case 'embed': line = data.url ?? ''; break
        case 'image': case 'file': case 'pdf': case 'video': line = `[${t}${rich(data.caption) ? ': ' + rich(data.caption) : ''}]`; break
        case 'table_row': line = '| ' + (data.cells ?? []).map((c: any[]) => rich(c)).join(' | ') + ' |'; break
        default: line = ''
      }
      if (t !== 'numbered_list_item') n = 0
      if (line) lines.push(line)
      if (b.has_children && depth > 0 && t !== 'child_page' && t !== 'child_database') {
        kids.push(b.id)
        const inner = await blocksToMarkdown(b.id, ctx, depth - 1, budget)
        if (inner) lines.push(inner.split('\n').map((l) => '  ' + l).join('\n'))
      }
    }
    cursor = j.has_more ? j.next_cursor : undefined
  } while (cursor && budget.left > 0)
  return lines.join('\n')
}

/* ----------------------------------- tools ----------------------------------- */
const tools: ToolDef[] = [
  {
    name: 'notion_search',
    description: 'Search the user\'s Notion workspace for pages and databases (only those shared with the integration). Use it to find notes, docs, wikis and tasks.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search text; empty lists recently edited items.' }, type: { type: 'string', enum: ['page', 'database', 'any'] }, limit: { type: 'number', description: 'Default 10, max 25.' } }, required: ['query'], additionalProperties: false },
  },
  {
    name: 'notion_read_page',
    description: 'Read a Notion page: its properties and full content as text. Accepts a page id or a notion.so URL.',
    parameters: { type: 'object', properties: { page: { type: 'string', description: 'Page id or notion.so URL.' } }, required: ['page'], additionalProperties: false },
  },
  {
    name: 'notion_database',
    description: 'Query a Notion database and list its rows with their properties. Optionally pass a Notion API `filter` object.',
    parameters: {
      type: 'object',
      properties: { database: { type: 'string', description: 'Database id or notion.so URL.' }, filter: { type: 'object', description: 'Optional Notion filter object, e.g. {"property":"Status","status":{"equals":"Done"}}.' }, limit: { type: 'number', description: 'Default 25, max 100.' } },
      required: ['database'], additionalProperties: false,
    },
  },
]

const meta = (ctx: RunCtx, m: Record<string, unknown>) => ctx.update((b) => { b.meta = { ...(b.meta ?? {}), ...m } })

async function run(tool: string, a: Record<string, any>, ctx: RunCtx): Promise<{ output: string }> {
  if (tool === 'notion_search') {
    const limit = Math.min(25, Math.max(1, Number(a.limit) || 10))
    const body: any = { query: String(a.query ?? ''), page_size: limit, sort: { direction: 'descending', timestamp: 'last_edited_time' } }
    if (a.type === 'page' || a.type === 'database') body.filter = { property: 'object', value: a.type }
    const j = await nx('/search', ctx, body)
    const items: any[] = j.results ?? []
    meta(ctx, { summary: `${items.length} results` })
    if (!items.length) return { output: 'Nothing found. Only pages and databases shared with the Notion integration are visible to the AI.' }
    return { output: items.map((x) => `${x.object === 'database' ? '[database]' : '[page]'} ${titleOf(x)} — edited ${String(x.last_edited_time).slice(0, 10)} — id ${x.id} — ${x.url}`).join('\n') }
  }

  if (tool === 'notion_read_page') {
    const id = notionId(a.page)
    if (!id) throw new NError('Provide a page id or notion.so URL.')
    const page = await nx(`/pages/${id}`, ctx)
    const title = titleOf(page)
    meta(ctx, { url: page.url, label: title })
    const props = Object.entries<any>(page.properties ?? {}).filter(([, p]) => p.type !== 'title').map(([k, p]) => ({ k, v: propValue(p) })).filter((x) => x.v)
    const body = await blocksToMarkdown(id, ctx, 2, { left: 400 })
    meta(ctx, { summary: `${body.split('\n').length} lines` })
    return { output: clip(`# ${title}\n${page.url}\nLast edited: ${String(page.last_edited_time).slice(0, 10)}${props.length ? '\n\nProperties:\n' + props.map((p) => `- ${p.k}: ${p.v}`).join('\n') : ''}\n\n${body || '(empty page)'}`) }
  }

  if (tool === 'notion_database') {
    const id = notionId(a.database)
    if (!id) throw new NError('Provide a database id or notion.so URL.')
    const limit = Math.min(100, Math.max(1, Number(a.limit) || 25))
    const [db, rows] = await Promise.all([nx(`/databases/${id}`, ctx), nx(`/databases/${id}/query`, ctx, { page_size: limit, ...(a.filter && typeof a.filter === 'object' ? { filter: a.filter } : {}) })])
    meta(ctx, { url: db.url, label: titleOf(db), summary: `${rows.results.length} rows` })
    const cols = Object.entries<any>(db.properties ?? {}).map(([k, p]) => `${k} (${p.type})`).join(', ')
    const lines = (rows.results as any[]).map((r) => {
      const t = titleOf(r)
      const rest = Object.entries<any>(r.properties ?? {}).filter(([, p]) => p.type !== 'title').map(([k, p]) => ({ k, v: propValue(p) })).filter((x) => x.v).map((x) => `${x.k}: ${x.v}`).join(' | ')
      return `- ${t}${rest ? ' — ' + rest : ''} (id ${r.id})`
    })
    return { output: clip(`Database: ${titleOf(db)}\nColumns: ${cols}\n${rows.results.length}${rows.has_more ? '+' : ''} rows:\n${lines.join('\n') || '(no rows)'}`) }
  }
  throw new NError(`Unknown Notion action ${tool}`)
}

function describe(tool: string, a: Record<string, any>): Describe {
  if (tool === 'notion_search') return { present: 'Searching Notion for', past: 'Searched Notion for', subject: a.query ? `“${a.query}”` : 'recent pages', failed: "Couldn't search Notion for" }
  if (tool === 'notion_read_page') return { present: 'Reading Notion page', past: 'Read Notion page', subject: 'page', failed: "Couldn't read Notion page" }
  return { present: 'Querying Notion database', past: 'Queried Notion database', subject: 'database', failed: "Couldn't query Notion database" }
}

export const notion: Integration = {
  id: 'notion', name: 'Notion', icon: 'notion', tools,
  prompt: 'You can read the user\'s Notion workspace (notion_search, notion_read_page, notion_database). When they refer to their notes, docs, wiki, tasks or projects in Notion, search it and read the real pages instead of guessing. Only pages shared with the integration are visible; if something is missing, tell them to share it (••• → Connections). This access is read-only.',
  enabled: (s: Settings) => s.integrations.notion.enabled && !!s.integrations.notion.token.trim(),
  owns: (t) => t.startsWith('notion_'), describe, run,
  triggers: /notion\.so\/|\bnotion\b.{0,30}\b(page|database|doc|notes?|wiki|workspace)\b|\bin (my )?notion\b/i,
}
