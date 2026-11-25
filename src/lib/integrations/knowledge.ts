import type { Settings } from '../../types'
import type { ToolDef } from '../tools'
import type { Describe, Integration, RunCtx } from './types'

/* ---------------------------------------------------------------------------
 *  Developer knowledge pack: Wikipedia, Hugging Face, PyPI, npm.
 *  All four have public, CORS-enabled APIs, so they work straight from the browser.
 * ------------------------------------------------------------------------ */

class KError extends Error {}
const clip = (t: string, n = 20_000) => (t.length > n ? t.slice(0, n) + `\n…[truncated, ${t.length} characters total]` : t)
const num = (n: number | undefined) => (n == null ? '?' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : String(n))
const day = (s?: string) => (s ? String(s).slice(0, 10) : '?')
const strip = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')

async function getJson(url: string, ctx: RunCtx, what: string, init?: RequestInit): Promise<any> {
  const res = await getRes(url, ctx, what, init)
  return res.json()
}
async function getRes(url: string, ctx: RunCtx, what: string, init?: RequestInit): Promise<Response> {
  let res: Response
  try { res = await fetch(url, { signal: ctx.signal, ...init }) } catch (e: any) {
    if (e?.name === 'AbortError') throw e
    throw new KError(`Could not reach ${what}.`)
  }
  if (res.status === 404) throw new KError('Not found.')
  if (res.status === 429) throw new KError(`${what} is rate limiting requests right now. Try again in a minute.`)
  if (!res.ok) throw new KError(`${what} returned ${res.status}.`)
  return res
}
const meta = (ctx: RunCtx, m: Record<string, unknown>) => ctx.update((b) => { b.meta = { ...(b.meta ?? {}), ...m } })

/* -------------------------------- Wikipedia -------------------------------- */
const lang = (a: Record<string, any>) => (/^[a-z]{2,3}(-[a-z]+)?$/i.test(String(a.lang ?? '')) ? String(a.lang).toLowerCase() : 'en')
const wikiUrl = (l: string, title: string) => `https://${l}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`

const wikiTools: ToolDef[] = [
  {
    name: 'wikipedia_search',
    description: 'Search Wikipedia articles. Use it for encyclopedic facts, history, science, people, places, definitions.',
    parameters: { type: 'object', properties: { query: { type: 'string' }, lang: { type: 'string', description: 'Language code, default "en".' }, limit: { type: 'number', description: 'Default 5, max 10.' } }, required: ['query'], additionalProperties: false },
  },
  {
    name: 'wikipedia_page',
    description: 'Read a Wikipedia article as plain text (use the exact title from a search). Optionally read just one section.',
    parameters: { type: 'object', properties: { title: { type: 'string' }, lang: { type: 'string' }, section: { type: 'string', description: 'Only this section heading.' } }, required: ['title'], additionalProperties: false },
  },
]

async function runWiki(tool: string, a: Record<string, any>, ctx: RunCtx) {
  const l = lang(a)
  const api = `https://${l}.wikipedia.org/w/api.php`
  if (tool === 'wikipedia_search') {
    const q = String(a.query ?? '').trim()
    if (!q) throw new KError('Provide a search query.')
    const limit = Math.min(10, Math.max(1, Number(a.limit) || 5))
    const j = await getJson(`${api}?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=${limit}&format=json&origin=*`, ctx, 'Wikipedia')
    const hits: any[] = j.query?.search ?? []
    meta(ctx, { url: `https://${l}.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}`, summary: `${hits.length} articles` })
    if (!hits.length) return { output: 'No Wikipedia articles matched.' }
    return { output: hits.map((h) => `${h.title} — ${strip(h.snippet)} (${num(h.wordcount)} words)`).join('\n') }
  }
  const title = String(a.title ?? '').trim()
  if (!title) throw new KError('Provide the article title.')
  const j = await getJson(`${api}?action=query&prop=extracts|info&explaintext=1&exsectionformat=wiki&redirects=1&inprop=url&titles=${encodeURIComponent(title)}&format=json&origin=*`, ctx, 'Wikipedia')
  const page: any = Object.values(j.query?.pages ?? {})[0]
  if (!page || page.missing !== undefined) throw new KError(`No Wikipedia article titled "${title}". Try wikipedia_search first.`)
  let text: string = page.extract ?? ''
  const url = page.fullurl ?? wikiUrl(l, page.title)
  meta(ctx, { url, label: page.title, summary: `${num(text.length)} characters` })
  if (a.section) {
    const want = String(a.section).toLowerCase()
    const re = /^==+\s*(.+?)\s*==+\s*$/gm
    const marks: { name: string; at: number; end: number }[] = []
    for (let m; (m = re.exec(text)); ) marks.push({ name: m[1], at: m.index, end: m.index + m[0].length })
    const i = marks.findIndex((x) => x.name.toLowerCase().includes(want))
    if (i < 0) return { output: `No section like "${a.section}". Sections: ${marks.map((x) => x.name).join(', ') || '(none)'}` }
    text = text.slice(marks[i].end, marks[i + 1]?.at ?? text.length).trim()
    return { output: `${page.title} — section "${marks[i].name}":\n${clip(text)}` }
  }
  return { output: `${page.title}\n${url}\n\n${clip(text)}` }
}

function describeWiki(tool: string, a: Record<string, any>): Describe {
  if (tool === 'wikipedia_search') return { present: 'Searching Wikipedia for', past: 'Searched Wikipedia for', subject: `“${a.query ?? ''}”`, url: a.query ? `https://${lang(a)}.wikipedia.org/w/index.php?search=${encodeURIComponent(String(a.query))}` : undefined, failed: "Couldn't search Wikipedia for" }
  const t = String(a.title ?? '')
  return { present: 'Reading Wikipedia article', past: 'Read Wikipedia article', subject: t || 'an article', extra: a.section ? `(section “${a.section}”)` : undefined, url: t ? wikiUrl(lang(a), t) : undefined, failed: "Couldn't read Wikipedia article" }
}

/* ------------------------------- Hugging Face ------------------------------- */
const HF = 'https://huggingface.co'
const hfTools: ToolDef[] = [
  {
    name: 'huggingface_search',
    description: 'Search the Hugging Face Hub for models, datasets, Spaces (apps) or papers. Use it to find ML models/datasets for a task or to look up research papers.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' }, type: { type: 'string', enum: ['models', 'datasets', 'spaces', 'papers'], description: 'Default "models".' }, limit: { type: 'number', description: 'Default 8, max 20.' }, sort: { type: 'string', enum: ['downloads', 'likes', 'trending'], description: 'Default downloads.' } },
      required: ['query'], additionalProperties: false,
    },
  },
  {
    name: 'huggingface_info',
    description: 'Read a Hugging Face model, dataset or Space: metadata, tags, license, files and its README / model card.',
    parameters: { type: 'object', properties: { id: { type: 'string', description: 'e.g. "meta-llama/Llama-3.1-8B" or "squad".' }, type: { type: 'string', enum: ['model', 'dataset', 'space'], description: 'Default "model".' } }, required: ['id'], additionalProperties: false },
  },
]

const hfKind = (a: Record<string, any>) => (a.type === 'dataset' || a.type === 'space' ? (a.type as 'dataset' | 'space') : 'model')
const hfWeb = (kind: string, id: string) => `${HF}/${kind === 'model' ? '' : kind + 's/'}${id}`

async function runHf(tool: string, a: Record<string, any>, ctx: RunCtx) {
  const token = ctx.settings.integrations.huggingface.token.trim()
  const init: RequestInit = token ? { headers: { Authorization: `Bearer ${token}` } } : {}
  if (tool === 'huggingface_search') {
    const q = String(a.query ?? '').trim()
    if (!q) throw new KError('Provide a search query.')
    const type = ['models', 'datasets', 'spaces', 'papers'].includes(a.type) ? a.type : 'models'
    const limit = Math.min(20, Math.max(1, Number(a.limit) || 8))
    if (type === 'papers') {
      const j = await getJson(`${HF}/api/papers/search?q=${encodeURIComponent(q)}`, ctx, 'Hugging Face', init)
      const items = (Array.isArray(j) ? j : []).slice(0, limit)
      meta(ctx, { url: `${HF}/papers?q=${encodeURIComponent(q)}`, summary: `${items.length} papers` })
      return { output: items.length ? items.map((x: any) => `${x.paper?.id ?? x.id} — ${x.title ?? x.paper?.title} (${day(x.paper?.publishedAt ?? x.publishedAt)}): ${String(x.paper?.summary ?? x.summary ?? '').replace(/\s+/g, ' ').slice(0, 220)}`).join('\n') : 'No papers matched.' }
    }
    const sort = a.sort === 'likes' ? 'likes' : a.sort === 'trending' ? 'trendingScore' : 'downloads'
    const items: any[] = await getJson(`${HF}/api/${type}?search=${encodeURIComponent(q)}&limit=${limit}&sort=${sort}&direction=-1`, ctx, 'Hugging Face', init)
    meta(ctx, { url: `${HF}/${type}?search=${encodeURIComponent(q)}`, summary: `${items.length} ${type}` })
    if (!items.length) return { output: `No ${type} matched.` }
    return { output: items.map((x) => `${x.id ?? x.modelId} — ${[x.pipeline_tag, x.library_name].filter(Boolean).join(', ') || x.sdk || ''} · ↓${num(x.downloads)} ♥${num(x.likes)}${x.tags?.length ? ' · ' + x.tags.filter((t: string) => !t.includes(':')).slice(0, 5).join(', ') : ''}`).join('\n') }
  }
  const id = String(a.id ?? '').trim().replace(/^https?:\/\/huggingface\.co\/(datasets\/|spaces\/)?/, '').replace(/\/$/, '')
  if (!id) throw new KError('Provide the model, dataset or Space id.')
  const kind = hfKind(a)
  const info = await getJson(`${HF}/api/${kind}s/${id}`, ctx, 'Hugging Face', init).catch((e) => { throw e instanceof KError && e.message === 'Not found.' ? new KError(`No Hugging Face ${kind} "${id}". Try huggingface_search.`) : e })
  const readme = await getRes(`${hfWeb(kind, id)}/raw/main/README.md`, ctx, 'Hugging Face', init).then((r) => r.text()).catch(() => '')
  meta(ctx, { url: hfWeb(kind, id), label: id, summary: `↓${num(info.downloads)} ♥${num(info.likes)}` })
  const files = (info.siblings ?? []).slice(0, 30).map((s: any) => s.rfilename).join(', ')
  const head = [
    `${kind[0].toUpperCase() + kind.slice(1)}: ${info.id}`,
    info.pipeline_tag ? `Task: ${info.pipeline_tag}` : '', info.library_name ? `Library: ${info.library_name}` : '',
    `Downloads: ${num(info.downloads)} · Likes: ${num(info.likes)} · Updated: ${day(info.lastModified)}`,
    info.cardData?.license || info.license ? `License: ${info.cardData?.license ?? info.license}` : '',
    info.tags?.length ? `Tags: ${info.tags.filter((t: string) => !t.includes(':') || t.startsWith('license')).slice(0, 15).join(', ')}` : '',
    info.gated ? 'Gated: access must be requested on the website.' : '',
    files ? `Files: ${files}` : '',
  ].filter(Boolean).join('\n')
  return { output: `${head}\n\n${readme ? clip(readme.replace(/^---[\s\S]*?---\s*/, ''), 10_000) : '(no README)'}` }
}

function describeHf(tool: string, a: Record<string, any>): Describe {
  if (tool === 'huggingface_search') {
    const t = ['datasets', 'spaces', 'papers'].includes(a.type) ? a.type : 'models'
    return { present: `Searching Hugging Face ${t} for`, past: `Searched Hugging Face ${t} for`, subject: `“${a.query ?? ''}”`, url: a.query ? `${HF}/${t === 'models' ? 'models' : t}?search=${encodeURIComponent(String(a.query))}` : undefined, failed: `Couldn't search Hugging Face ${t} for` }
  }
  const kind = hfKind(a)
  const id = String(a.id ?? '')
  return { present: `Reading Hugging Face ${kind}`, past: `Read Hugging Face ${kind}`, subject: id || `a ${kind}`, url: id ? hfWeb(kind, id) : undefined, failed: `Couldn't read Hugging Face ${kind}` }
}

/* ----------------------------------- PyPI ----------------------------------- */
const pypiTools: ToolDef[] = [
  {
    name: 'pypi_package',
    description: 'Look up a Python package on PyPI: latest version, summary, release history, dependencies, links and its README. Use it for questions about Python libraries, versions and compatibility.',
    parameters: { type: 'object', properties: { name: { type: 'string' }, version: { type: 'string', description: 'A specific version (default: latest).' } }, required: ['name'], additionalProperties: false },
  },
]

async function runPypi(_tool: string, a: Record<string, any>, ctx: RunCtx) {
  const name = String(a.name ?? '').trim()
  if (!name) throw new KError('Provide the package name.')
  const v = String(a.version ?? '').trim()
  const j = await getJson(`https://pypi.org/pypi/${encodeURIComponent(name)}${v ? '/' + encodeURIComponent(v) : ''}/json`, ctx, 'PyPI').catch((e) => { throw e instanceof KError && e.message === 'Not found.' ? new KError(`No PyPI package named "${name}"${v ? ` at version ${v}` : ''}.`) : e })
  const i = j.info
  const rel = Object.entries<any[]>(j.releases ?? {}).filter(([, f]) => f.length).map(([ver, f]) => ({ ver, t: f[0].upload_time as string, yanked: f[0].yanked })).sort((x, y) => y.t.localeCompare(x.t)).slice(0, 12)
  meta(ctx, { url: i.package_url ?? `https://pypi.org/project/${name}/`, label: `${i.name} ${i.version}`, summary: `v${i.version}` })
  const out = [
    `${i.name} ${i.version} — ${i.summary ?? ''}`,
    `Requires Python: ${i.requires_python ?? 'unspecified'} · License: ${i.license_expression ?? (i.license && String(i.license).length < 60 ? i.license : 'see classifiers')} · Author: ${i.author ?? i.author_email ?? '?'}`,
    i.project_urls ? `Links: ${Object.entries(i.project_urls).map(([k, u]) => `${k}: ${u}`).join(' · ')}` : '',
    rel.length ? `Recent releases: ${rel.map((r) => `${r.ver} (${day(r.t)}${r.yanked ? ', yanked' : ''})`).join(', ')}` : '',
    i.requires_dist?.length ? `Dependencies: ${i.requires_dist.slice(0, 25).join('; ')}${i.requires_dist.length > 25 ? '; …' : ''}` : 'Dependencies: none declared',
    i.classifiers?.length ? `Classifiers: ${i.classifiers.filter((c: string) => /Programming Language|Topic|Development Status/.test(c)).slice(0, 8).join('; ')}` : '',
    i.description ? `\nDescription:\n${clip(String(i.description), 8000)}` : '',
  ].filter(Boolean).join('\n')
  return { output: out }
}

function describePypi(_t: string, a: Record<string, any>): Describe {
  const n = String(a.name ?? '')
  return { present: 'Looking up PyPI package', past: 'Looked up PyPI package', subject: n || 'a package', extra: a.version ? `(${a.version})` : undefined, url: n ? `https://pypi.org/project/${n}/` : undefined, failed: "Couldn't look up PyPI package" }
}

/* ----------------------------------- npm ------------------------------------ */
const npmTools: ToolDef[] = [
  {
    name: 'npm_package',
    description: 'Look up a package on npm: latest version, description, dependencies, dist-tags, weekly downloads and its README. Use it for questions about JavaScript/TypeScript libraries and versions.',
    parameters: { type: 'object', properties: { name: { type: 'string', description: 'e.g. "react" or "@types/node".' }, version: { type: 'string', description: 'Version or dist-tag (default: latest).' } }, required: ['name'], additionalProperties: false },
  },
  {
    name: 'npm_search',
    description: 'Search npm for packages by keyword.',
    parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number', description: 'Default 8, max 20.' } }, required: ['query'], additionalProperties: false },
  },
]

const npmPath = (n: string) => (n.startsWith('@') ? '@' + encodeURIComponent(n.slice(1)) : encodeURIComponent(n))

async function runNpm(tool: string, a: Record<string, any>, ctx: RunCtx) {
  if (tool === 'npm_search') {
    const q = String(a.query ?? '').trim()
    if (!q) throw new KError('Provide a search query.')
    const limit = Math.min(20, Math.max(1, Number(a.limit) || 8))
    const j = await getJson(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}&size=${limit}`, ctx, 'npm')
    const items: any[] = j.objects ?? []
    meta(ctx, { url: `https://www.npmjs.com/search?q=${encodeURIComponent(q)}`, summary: `${items.length} packages` })
    return { output: items.length ? items.map((o) => `${o.package.name}@${o.package.version} — ${o.package.description ?? ''} (updated ${day(o.package.date)}, score ${Math.round((o.score?.final ?? 0) * 100)})`).join('\n') : 'No packages matched.' }
  }
  const name = String(a.name ?? '').trim()
  if (!name) throw new KError('Provide the package name.')
  const ver = String(a.version ?? '').trim() || 'latest'
  const [doc, tags, dl] = await Promise.all([
    getJson(`https://registry.npmjs.org/${npmPath(name)}/${encodeURIComponent(ver)}`, ctx, 'npm').catch((e) => { throw e instanceof KError && e.message === 'Not found.' ? new KError(`No npm package "${name}"${ver !== 'latest' ? ` at ${ver}` : ''}.`) : e }),
    getJson(`https://registry.npmjs.org/-/package/${npmPath(name)}/dist-tags`, ctx, 'npm').catch(() => ({})),
    getJson(`https://api.npmjs.org/downloads/point/last-week/${name}`, ctx, 'npm').catch(() => null),
  ])
  const readme = await getRes(`https://cdn.jsdelivr.net/npm/${name}@${doc.version}/README.md`, ctx, 'npm').then((r) => r.text()).catch(() => getRes(`https://cdn.jsdelivr.net/npm/${name}@${doc.version}/readme.md`, ctx, 'npm').then((r) => r.text()).catch(() => ''))
  meta(ctx, { url: `https://www.npmjs.com/package/${name}`, label: `${doc.name}@${doc.version}`, summary: dl ? `↓${num(dl.downloads)}/week` : `v${doc.version}` })
  const deps = Object.entries(doc.dependencies ?? {}).map(([k, v]) => `${k}@${v}`)
  const out = [
    `${doc.name}@${doc.version} — ${doc.description ?? ''}`,
    `License: ${typeof doc.license === 'string' ? doc.license : doc.license?.type ?? '?'}${doc.engines?.node ? ` · Node: ${doc.engines.node}` : ''}${dl ? ` · Weekly downloads: ${num(dl.downloads)}` : ''}`,
    doc.homepage ? `Homepage: ${doc.homepage}` : '', doc.repository?.url ? `Repository: ${String(doc.repository.url).replace(/^git\+|\.git$/g, '')}` : '',
    Object.keys(tags).length ? `Dist-tags: ${Object.entries(tags).map(([k, v]) => `${k}=${v}`).join(', ')}` : '',
    doc.keywords?.length ? `Keywords: ${doc.keywords.slice(0, 12).join(', ')}` : '',
    deps.length ? `Dependencies (${deps.length}): ${deps.slice(0, 25).join(', ')}${deps.length > 25 ? ', …' : ''}` : 'Dependencies: none',
    doc.peerDependencies ? `Peer dependencies: ${Object.entries(doc.peerDependencies).map(([k, v]) => `${k}@${v}`).join(', ')}` : '',
    doc.types || doc.typings ? 'Ships TypeScript types.' : '',
    readme ? `\nREADME:\n${clip(readme, 8000)}` : '',
  ].filter(Boolean).join('\n')
  return { output: out }
}

function describeNpm(tool: string, a: Record<string, any>): Describe {
  if (tool === 'npm_search') return { present: 'Searching npm for', past: 'Searched npm for', subject: `“${a.query ?? ''}”`, url: a.query ? `https://www.npmjs.com/search?q=${encodeURIComponent(String(a.query))}` : undefined, failed: "Couldn't search npm for" }
  const n = String(a.name ?? '')
  return { present: 'Looking up npm package', past: 'Looked up npm package', subject: n || 'a package', extra: a.version ? `(${a.version})` : undefined, url: n ? `https://www.npmjs.com/package/${n}` : undefined, failed: "Couldn't look up npm package" }
}

/* ------------------------------- integrations ------------------------------- */
const wrap = (fn: (t: string, a: Record<string, any>, c: RunCtx) => Promise<{ output: string }>) => fn

export const wikipedia: Integration = {
  id: 'wikipedia', name: 'Wikipedia', icon: 'wikipedia', tools: wikiTools,
  prompt: 'You can read Wikipedia (wikipedia_search, wikipedia_page). Use it for encyclopedic facts instead of relying on memory when accuracy matters, and cite the article titles you used.',
  enabled: (s: Settings) => s.integrations.wikipedia.enabled,
  owns: (t) => t.startsWith('wikipedia_'), describe: describeWiki, run: wrap(runWiki),
  triggers: /\bwikipedia\b/i,
}
export const huggingface: Integration = {
  id: 'huggingface', name: 'Hugging Face', icon: 'huggingface', tools: hfTools,
  prompt: 'You can browse the Hugging Face Hub (huggingface_search, huggingface_info): find models, datasets, Spaces and papers, and read model cards. Look things up rather than guessing model names, sizes or licenses.',
  enabled: (s: Settings) => s.integrations.huggingface.enabled,
  owns: (t) => t.startsWith('huggingface_'), describe: describeHf, run: wrap(runHf),
  triggers: /huggingface\.co\/|\bhugging ?face\b.{0,30}\b(model|dataset|space|paper)s?\b/i,
}
export const pypi: Integration = {
  id: 'pypi', name: 'PyPI', icon: 'pypi', tools: pypiTools,
  prompt: 'You can look up Python packages on PyPI (pypi_package). Check it for current versions, Python compatibility and dependencies instead of guessing.',
  enabled: (s: Settings) => s.integrations.pypi.enabled,
  owns: (t) => t.startsWith('pypi_'), describe: describePypi, run: wrap(runPypi),
  triggers: /pypi\.org\/project\/|\bon pypi\b/i,
}
export const npm: Integration = {
  id: 'npm', name: 'npm', icon: 'npm', tools: npmTools,
  prompt: 'You can look up and search npm packages (npm_package, npm_search). Check them for current versions, dependencies and TypeScript support instead of guessing.',
  enabled: (s: Settings) => s.integrations.npm.enabled,
  owns: (t) => t.startsWith('npm_'), describe: describeNpm, run: wrap(runNpm),
  triggers: /npmjs\.com\/package\/|\bon npm\b/i,
}
