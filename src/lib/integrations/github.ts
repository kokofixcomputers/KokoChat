import type { Settings } from '../../types'
import type { ToolDef } from '../tools'
import type { Describe, Integration, RunCtx } from './types'

const API = 'https://api.github.com'
const MAX_OUT = 30_000

/* ------------------------------ repo references ------------------------------ */
export interface RepoRef { owner: string; repo: string; ref?: string; path?: string; number?: number }

/** Accepts owner/repo, github.com/owner/repo, full URLs (tree/blob/issues/pull), and git@ remotes. */
export function parseRepo(input: unknown): RepoRef | null {
  const s = String(input ?? '').trim()
  if (!s) return null
  let m = /^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i.exec(s)
  if (m) return { owner: m[1], repo: m[2] }
  m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(tree|blob|issues|pull|pulls|commit|commits)(?:\/([^?#]*))?)?(?:[?#].*)?$/i.exec(s)
  if (m) {
    const [, owner, repo, kind, rest] = m
    const out: RepoRef = { owner, repo }
    if ((kind === 'tree' || kind === 'blob') && rest) {
      const [ref, ...p] = rest.split('/')
      out.ref = decodeURIComponent(ref)
      if (p.length) out.path = p.map(decodeURIComponent).join('/')
    } else if ((kind === 'issues' || kind === 'pull') && rest && /^\d+/.test(rest)) out.number = Number(rest.split('/')[0])
    else if (kind === 'commit' && rest) out.ref = rest.split('/')[0]
    return out
  }
  m = /^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(s)
  if (m) return { owner: m[1], repo: m[2] }
  return null
}

const slug = (a: Record<string, any>) => {
  const r = parseRepo(a.repo)
  return r ? `${r.owner}/${r.repo}` : String(a.repo ?? '').trim()
}
const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/')

/* ---------------------------------- client ---------------------------------- */
export let lastRate: { limit: number; remaining: number; reset: number } | null = null
const cache = new Map<string, { t: number; v: Response; text?: string }>()

class GhError extends Error {}

function friendly(status: number, what: string, hasToken: boolean, res: Response): string {
  if (status === 404) return `Not found${hasToken ? ' (or the token cannot see it)' : '. If it is a private repository, add a GitHub token in Settings → Integrations'}.`
  if (status === 401) return 'The GitHub token was rejected. Check it in Settings → Integrations.'
  if (status === 403 || status === 429) {
    const left = res.headers.get('x-ratelimit-remaining')
    const reset = Number(res.headers.get('x-ratelimit-reset') ?? 0)
    if (left === '0' || status === 429) return `GitHub's rate limit was reached${reset ? ` (resets at ${new Date(reset * 1000).toLocaleTimeString()})` : ''}.${hasToken ? '' : ' Adding a GitHub token in Settings → Integrations raises the limit from 60 to 5,000 requests per hour.'}`
    return `GitHub refused access${hasToken ? ' (the token may lack permission)' : '; it may be private. Add a GitHub token in Settings → Integrations'}.`
  }
  if (status === 422) return `GitHub could not process that request (${what}).`
  return `GitHub returned ${status} for ${what}.`
}

async function gh(path: string, ctx: RunCtx, what: string, raw = false): Promise<Response> {
  const token = ctx.settings.integrations.github.token.trim()
  const key = `${token ? 1 : 0}|${raw ? 'r' : 'j'}|${path}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.t < 5 * 60_000) return hit.v.clone()
  let res: Response
  try {
    res = await fetch(API + path, {
      signal: ctx.signal,
      headers: { Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e
    throw new GhError('Could not reach GitHub. Check the connection.')
  }
  const limit = res.headers.get('x-ratelimit-limit')
  if (limit) lastRate = { limit: Number(limit), remaining: Number(res.headers.get('x-ratelimit-remaining') ?? 0), reset: Number(res.headers.get('x-ratelimit-reset') ?? 0) }
  if (!res.ok) throw new GhError(friendly(res.status, what, !!token, res))
  cache.set(key, { t: Date.now(), v: res.clone() })
  return res
}
const gj = async (path: string, ctx: RunCtx, what: string) => (await gh(path, ctx, what)).json()

/** Check a token / the anonymous quota (used by the Settings "Test" button). */
export async function testGithub(token: string): Promise<{ login?: string; remaining: number; limit: number }> {
  const h = { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  const res = await fetch(`${API}/rate_limit`, { headers: h })
  if (res.status === 401) throw new Error('GitHub rejected that token.')
  if (!res.ok) throw new Error(`GitHub returned ${res.status}.`)
  const j = await res.json()
  let login: string | undefined
  if (token) { const u = await fetch(`${API}/user`, { headers: h }); if (u.ok) login = (await u.json()).login }
  return { login, remaining: j.resources?.core?.remaining ?? 0, limit: j.resources?.core?.limit ?? 0 }
}

/* --------------------------------- formatting --------------------------------- */
const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1048576).toFixed(1)} MB`)
const day = (iso?: string) => (iso ? iso.slice(0, 10) : '?')
const num = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n))
const clip = (t: string, n = MAX_OUT) => (t.length > n ? t.slice(0, n) + `\n…[truncated, ${t.length} characters total]` : t)
const must = (a: Record<string, any>) => {
  const r = parseRepo(a.repo)
  if (!r) throw new GhError('Provide the repository as "owner/repo" or a github.com URL.')
  return r
}
const listing = (items: any[]) =>
  items
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
    .map((e) => `${e.type === 'dir' ? 'dir ' : 'file'} ${e.path}${e.type === 'dir' ? '/' : ` (${kb(e.size ?? 0)})`}`)
    .join('\n')

/* ----------------------------------- tools ----------------------------------- */
const REPO_PARAM = { type: 'string', description: 'The repository: "owner/repo" or a github.com URL.' }

const tools: ToolDef[] = [
  {
    name: 'github_repo',
    description: 'Get an overview of a GitHub repository: description, stats, languages, top-level files and the README. Use this first whenever the user mentions a repo or pastes a github.com link.',
    parameters: { type: 'object', properties: { repo: REPO_PARAM }, required: ['repo'], additionalProperties: false },
  },
  {
    name: 'github_files',
    description: 'List the files and folders of a GitHub repository (one directory, or the whole tree with recursive=true).',
    parameters: {
      type: 'object',
      properties: { repo: REPO_PARAM, path: { type: 'string', description: 'Directory to list (default: repository root).' }, ref: { type: 'string', description: 'Branch, tag or commit (default: the default branch).' }, recursive: { type: 'boolean', description: 'List every file under the path.' } },
      required: ['repo'], additionalProperties: false,
    },
  },
  {
    name: 'github_read_file',
    description: 'Read the contents of a file in a GitHub repository (source code, config, docs). For big files use startLine/endLine.',
    parameters: {
      type: 'object',
      properties: { repo: REPO_PARAM, path: { type: 'string', description: 'File path, e.g. src/index.ts' }, ref: { type: 'string', description: 'Branch, tag or commit (default: the default branch).' }, startLine: { type: 'number' }, endLine: { type: 'number' } },
      required: ['repo', 'path'], additionalProperties: false,
    },
  },
  {
    name: 'github_commits',
    description: 'Read a repository\'s commit history (optionally for one file/folder, author or date range), or the full details and diff of a single commit when `sha` is given.',
    parameters: {
      type: 'object',
      properties: {
        repo: REPO_PARAM, sha: { type: 'string', description: 'A commit SHA to inspect in detail (files changed and diff).' }, ref: { type: 'string', description: 'Branch or tag to list commits from.' },
        path: { type: 'string', description: 'Only commits touching this file or folder.' }, author: { type: 'string', description: 'GitHub username or email.' }, since: { type: 'string', description: 'ISO date, e.g. 2025-01-01.' }, limit: { type: 'number', description: 'How many commits (default 20, max 50).' },
      },
      required: ['repo'], additionalProperties: false,
    },
  },
  {
    name: 'github_issues',
    description: 'Read issues and pull requests of a repository: list or search them, or open one by number (with its comments, and for PRs the changed files).',
    parameters: {
      type: 'object',
      properties: {
        repo: REPO_PARAM, number: { type: 'number', description: 'Issue or pull request number to read in detail.' }, state: { type: 'string', enum: ['open', 'closed', 'all'] },
        kind: { type: 'string', enum: ['issue', 'pr', 'any'] }, query: { type: 'string', description: 'Search text.' }, labels: { type: 'string', description: 'Comma-separated labels.' }, limit: { type: 'number', description: 'Max results (default 15, max 30).' },
      },
      required: ['repo'], additionalProperties: false,
    },
  },
  {
    name: 'github_search',
    description: 'Search GitHub for repositories (works for everyone) or for code (needs a GitHub token). Use it to find a repo when the user only gives a name or topic.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' }, type: { type: 'string', enum: ['repositories', 'code'] }, repo: { type: 'string', description: 'For code search: limit to this repository.' } },
      required: ['query'], additionalProperties: false,
    },
  },
]

/* ------------------------------------ run ------------------------------------ */
async function run(tool: string, a: Record<string, any>, ctx: RunCtx): Promise<{ output: string }> {
  const meta = (m: Record<string, unknown>) => ctx.update((b) => { b.meta = { ...(b.meta ?? {}), ...m } })

  if (tool === 'github_repo') {
    const r = must(a)
    const base = `/repos/${r.owner}/${r.repo}`
    const q = r.ref ? `?ref=${encodeURIComponent(r.ref)}` : ''
    const what = `The repository ${r.owner}/${r.repo}`
    const [info, root, readme, langs] = await Promise.all([
      gj(base, ctx, what),
      gj(`${base}/contents${q}`, ctx, what).catch(() => []),
      gh(`${base}/readme${q}`, ctx, 'The README', true).then((x) => x.text()).catch(() => ''),
      gj(`${base}/languages`, ctx, what).catch(() => ({})),
    ])
    const total = Object.values<number>(langs).reduce((x, y) => x + y, 0) || 1
    const langLine = Object.entries<number>(langs).slice(0, 6).map(([k, v]) => `${k} ${Math.round((v / total) * 100)}%`).join(', ')
    meta({ url: info.html_url, summary: `★ ${num(info.stargazers_count)} · ${info.language ?? 'no language'}` })
    const out = [
      `Repository: ${info.full_name}${info.fork ? ' (fork)' : ''}${info.archived ? ' (archived)' : ''}${info.private ? ' (private)' : ''}`,
      info.description ? `Description: ${info.description}` : '',
      `Stars: ${info.stargazers_count} · Forks: ${info.forks_count} · Watchers: ${info.subscribers_count ?? info.watchers_count} · Open issues/PRs: ${info.open_issues_count}`,
      `Default branch: ${info.default_branch} · License: ${info.license?.spdx_id ?? 'none'} · Size: ${kb((info.size ?? 0) * 1024)}`,
      `Created: ${day(info.created_at)} · Last push: ${day(info.pushed_at)}`,
      langLine ? `Languages: ${langLine}` : '',
      info.topics?.length ? `Topics: ${info.topics.join(', ')}` : '',
      info.homepage ? `Homepage: ${info.homepage}` : '',
      Array.isArray(root) && root.length ? `\nTop-level files${r.ref ? ` (at ${r.ref})` : ''}:\n${listing(root)}` : '',
      readme ? `\nREADME:\n${clip(readme, 9000)}` : '\n(No README found.)',
    ].filter(Boolean).join('\n')
    return { output: out }
  }

  if (tool === 'github_files') {
    const r = must(a)
    const ref = String(a.ref ?? r.ref ?? '')
    const path = String(a.path ?? r.path ?? '').replace(/^\/+|\/+$/g, '')
    const what = `${r.owner}/${r.repo}${path ? '/' + path : ''}`
    meta({ url: `https://github.com/${r.owner}/${r.repo}/tree/${ref || 'HEAD'}${path ? '/' + path : ''}` })
    if (a.recursive) {
      const j = await gj(`/repos/${r.owner}/${r.repo}/git/trees/${encodeURIComponent(ref || 'HEAD')}?recursive=1`, ctx, what)
      const files = (j.tree as any[]).filter((e) => e.type === 'blob' && (!path || e.path === path || e.path.startsWith(path + '/')))
      const shown = files.slice(0, 600).map((e) => `${e.path} (${kb(e.size ?? 0)})`)
      return { output: `${files.length} files under ${what}${j.truncated ? ' (GitHub truncated the tree)' : ''}:\n${shown.join('\n')}${files.length > 600 ? `\n…and ${files.length - 600} more` : ''}` }
    }
    const items = await gj(`/repos/${r.owner}/${r.repo}/contents${path ? '/' + enc(path) : ''}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`, ctx, what)
    if (!Array.isArray(items)) return { output: `${what} is a file (${kb(items.size ?? 0)}), not a directory. Use the file reader.` }
    return { output: `Contents of ${what}${ref ? ` at ${ref}` : ''}:\n${listing(items)}` }
  }

  if (tool === 'github_read_file') {
    const r = must(a)
    const path = String(a.path ?? r.path ?? '').replace(/^\/+/, '')
    if (!path) throw new GhError('Provide the file path.')
    const ref = String(a.ref ?? r.ref ?? '')
    const what = `${path} in ${r.owner}/${r.repo}`
    meta({ url: `https://github.com/${r.owner}/${r.repo}/blob/${ref || 'HEAD'}/${path}` })
    const res = await gh(`/repos/${r.owner}/${r.repo}/contents/${enc(path)}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`, ctx, what, true)
    const ct = res.headers.get('content-type') ?? ''
    if (ct.includes('application/json') && !ct.includes('raw')) { // a directory comes back as a JSON listing; a file as raw text
      const items = await res.json()
      return { output: Array.isArray(items) ? `${path} is a directory:\n${listing(items)}` : `Could not read ${path} as text.` }
    }
    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.subarray(0, 4000).includes(0)) return { output: `${path} is a binary file (${kb(buf.length)}); it cannot be shown as text.` }
    let text = new TextDecoder().decode(buf)
    const start = Number(a.startLine) || 0
    const end = Number(a.endLine) || 0
    if (start || end) {
      const lines = text.split('\n')
      const s = Math.max(1, start || 1)
      const e = Math.min(lines.length, end || s + 400)
      text = lines.slice(s - 1, e).map((l, i) => `${s + i}: ${l}`).join('\n')
      return { output: `${path} lines ${s}-${e} of ${lines.length}:\n${clip(text)}` }
    }
    meta({ summary: `${text.split('\n').length} lines · ${kb(buf.length)}` })
    return { output: `${path} (${kb(buf.length)}):\n${clip(text)}` }
  }

  if (tool === 'github_commits') {
    const r = must(a)
    const base = `/repos/${r.owner}/${r.repo}`
    const sha = String(a.sha ?? (r.ref && /^[0-9a-f]{7,40}$/i.test(r.ref) ? r.ref : '')).trim()
    if (sha) {
      const c = await gj(`${base}/commits/${encodeURIComponent(sha)}`, ctx, `Commit ${sha.slice(0, 7)} in ${r.owner}/${r.repo}`)
      meta({ url: c.html_url, summary: `${c.files?.length ?? 0} files · +${c.stats?.additions ?? 0} −${c.stats?.deletions ?? 0}` })
      const files = (c.files ?? []).slice(0, 25).map((f: any) => `--- ${f.filename} (${f.status}, +${f.additions} −${f.deletions})\n${f.patch ? clip(f.patch, 2500) : '(no text diff)'}`)
      return { output: clip(`Commit ${c.sha.slice(0, 10)} by ${c.commit.author?.name} on ${day(c.commit.author?.date)}\n${c.commit.message}\n\nStats: +${c.stats?.additions} −${c.stats?.deletions} across ${c.files?.length ?? 0} files\n\n${files.join('\n\n')}`) }
    }
    const limit = Math.min(50, Math.max(1, Number(a.limit) || 20))
    const qs = new URLSearchParams({ per_page: String(limit) })
    const ref = a.ref ?? r.ref
    if (ref) qs.set('sha', String(ref))
    if (a.path ?? r.path) qs.set('path', String(a.path ?? r.path))
    if (a.author) qs.set('author', String(a.author))
    if (a.since) qs.set('since', new Date(String(a.since)).toISOString())
    const list = await gj(`${base}/commits?${qs}`, ctx, `The commit history of ${r.owner}/${r.repo}`)
    meta({ url: `https://github.com/${r.owner}/${r.repo}/commits${ref ? '/' + ref : ''}`, summary: `${list.length} commits` })
    if (!list.length) return { output: 'No commits matched.' }
    return { output: `Latest ${list.length} commits${a.path ? ` touching ${a.path}` : ''}:\n` + list.map((c: any) => `${c.sha.slice(0, 7)} ${day(c.commit.author?.date)} ${c.commit.author?.name ?? c.author?.login ?? '?'} — ${String(c.commit.message).split('\n')[0]}`).join('\n') }
  }

  if (tool === 'github_issues') {
    const r = must(a)
    const base = `/repos/${r.owner}/${r.repo}`
    const n = Number(a.number ?? r.number)
    if (n) {
      const what = `#${n} in ${r.owner}/${r.repo}`
      const [issue, comments] = await Promise.all([gj(`${base}/issues/${n}`, ctx, what), gj(`${base}/issues/${n}/comments?per_page=20`, ctx, what).catch(() => [])])
      meta({ url: issue.html_url, summary: `${issue.state} · ${issue.comments} comments` })
      let extra = ''
      if (issue.pull_request) {
        const [pr, files] = await Promise.all([gj(`${base}/pulls/${n}`, ctx, what).catch(() => null), gj(`${base}/pulls/${n}/files?per_page=30`, ctx, what).catch(() => [])])
        if (pr) extra = `\nPull request: ${pr.head?.label} → ${pr.base?.label} · ${pr.merged ? 'merged' : pr.draft ? 'draft' : pr.state} · +${pr.additions} −${pr.deletions} in ${pr.changed_files} files\n` + files.map((f: any) => `  ${f.status} ${f.filename} (+${f.additions} −${f.deletions})`).join('\n')
      }
      const cm = (comments as any[]).map((c) => `— ${c.user?.login} (${day(c.created_at)}):\n${clip(String(c.body ?? ''), 1500)}`).join('\n\n')
      return { output: clip(`${issue.pull_request ? 'PR' : 'Issue'} #${n}: ${issue.title}\nState: ${issue.state} · by ${issue.user?.login} · ${day(issue.created_at)}${issue.labels?.length ? ' · labels: ' + issue.labels.map((l: any) => l.name).join(', ') : ''}${extra}\n\n${clip(String(issue.body ?? '(no description)'), 6000)}${cm ? `\n\nComments:\n${cm}` : ''}`) }
    }
    const limit = Math.min(30, Math.max(1, Number(a.limit) || 15))
    const state = ['open', 'closed', 'all'].includes(a.state) ? a.state : 'open'
    const kind = ['issue', 'pr', 'any'].includes(a.kind) ? a.kind : 'any'
    let items: any[]
    if (a.query) {
      const q = [`repo:${r.owner}/${r.repo}`, String(a.query), state !== 'all' ? `state:${state}` : '', kind === 'issue' ? 'is:issue' : kind === 'pr' ? 'is:pr' : '', a.labels ? String(a.labels).split(',').map((l) => `label:"${l.trim()}"`).join(' ') : ''].filter(Boolean).join(' ')
      items = (await gj(`/search/issues?q=${encodeURIComponent(q)}&per_page=${limit}`, ctx, `Issues in ${r.owner}/${r.repo}`)).items
    } else {
      const qs = new URLSearchParams({ state, per_page: String(Math.min(100, limit * 2)) })
      if (a.labels) qs.set('labels', String(a.labels))
      items = (await gj(`${base}/issues?${qs}`, ctx, `Issues in ${r.owner}/${r.repo}`)).filter((i: any) => (kind === 'any' ? true : kind === 'pr' ? !!i.pull_request : !i.pull_request)).slice(0, limit)
    }
    meta({ url: `https://github.com/${r.owner}/${r.repo}/issues`, summary: `${items.length} results` })
    if (!items.length) return { output: 'No matching issues or pull requests.' }
    return { output: items.map((i: any) => `#${i.number} [${i.pull_request ? 'PR' : 'issue'}, ${i.state}] ${i.title} — ${i.user?.login}, ${day(i.created_at)}, ${i.comments} comments${i.labels?.length ? ', ' + i.labels.map((l: any) => l.name).join('/') : ''}`).join('\n') }
  }

  if (tool === 'github_search') {
    const q = String(a.query ?? '').trim()
    if (!q) throw new GhError('Provide a search query.')
    meta({ url: `https://github.com/search?q=${encodeURIComponent(q)}` })
    if (a.type === 'code') {
      if (!ctx.settings.integrations.github.token.trim()) return { output: 'GitHub code search needs a personal access token. Ask the user to add one in Settings → Integrations, or browse the files directly instead.' }
      const repo = a.repo ? parseRepo(a.repo) : null
      const j = await gj(`/search/code?q=${encodeURIComponent(q + (repo ? ` repo:${repo.owner}/${repo.repo}` : ''))}&per_page=15`, ctx, 'Code search')
      meta({ summary: `${j.total_count} matches` })
      return { output: j.items.length ? `${j.total_count} matches (top ${j.items.length}):\n` + j.items.map((i: any) => `${i.repository.full_name}: ${i.path}`).join('\n') : 'No code matched.' }
    }
    const j = await gj(`/search/repositories?q=${encodeURIComponent(q)}&per_page=10&sort=stars`, ctx, 'Repository search')
    meta({ summary: `${j.total_count} repositories` })
    return { output: j.items.length ? j.items.map((i: any) => `${i.full_name} ★${num(i.stargazers_count)} ${i.language ?? ''} — ${i.description ?? ''}`).join('\n') : 'No repositories matched.' }
  }

  throw new GhError(`Unknown GitHub action ${tool}`)
}

/* -------------------------------- how it reads -------------------------------- */
function describe(tool: string, a: Record<string, any>): Describe {
  const r = parseRepo(a.repo)
  const repo = r ? `${r.owner}/${r.repo}` : String(a.repo ?? '').trim() || 'repository'
  const url = r ? `https://github.com/${r.owner}/${r.repo}` : undefined
  switch (tool) {
    case 'github_repo':
      return { present: 'Fetching GitHub repository', past: 'Fetched GitHub repository', subject: repo, url, failed: "Couldn't fetch GitHub repository" }
    case 'github_files': {
      const p = String(a.path ?? r?.path ?? '').replace(/^\/+|\/+$/g, '')
      return { present: a.recursive ? 'Listing every file in' : 'Browsing files in', past: a.recursive ? 'Listed every file in' : 'Browsed files in', subject: p ? `${repo}/${p}` : repo, url, failed: "Couldn't browse files in" }
    }
    case 'github_read_file': {
      const p = String(a.path ?? r?.path ?? '')
      return { present: 'Reading', past: 'Read', subject: p || 'a file', in: repo, url, failed: "Couldn't read" }
    }
    case 'github_commits': {
      const sha = String(a.sha ?? '').trim()
      if (sha) return { present: 'Reading commit', past: 'Read commit', subject: sha.slice(0, 7), in: repo, url: r ? `${url}/commit/${sha}` : undefined, failed: "Couldn't read commit" }
      const p = String(a.path ?? '').trim()
      return { present: 'Checking commit history of', past: 'Checked commit history of', subject: p ? `${p}` : repo, in: p ? repo : undefined, url: r ? `${url}/commits` : undefined, failed: "Couldn't read the commit history of" }
    }
    case 'github_issues': {
      const n = Number(a.number ?? r?.number)
      if (n) return { present: 'Reading issue or pull request', past: 'Read issue or pull request', subject: `#${n}`, in: repo, url: r ? `${url}/issues/${n}` : undefined, failed: "Couldn't read issue or pull request" }
      return { present: a.query ? 'Searching issues and PRs in' : 'Listing issues and PRs in', past: a.query ? 'Searched issues and PRs in' : 'Listed issues and PRs in', subject: repo, extra: a.query ? `for “${a.query}”` : undefined, url: r ? `${url}/issues` : undefined, failed: "Couldn't look up issues in" }
    }
    case 'github_search':
      return { present: a.type === 'code' ? 'Searching GitHub code for' : 'Searching GitHub for', past: a.type === 'code' ? 'Searched GitHub code for' : 'Searched GitHub for', subject: `“${a.query ?? ''}”`, url: a.query ? `https://github.com/search?q=${encodeURIComponent(String(a.query))}` : undefined, failed: "Couldn't search GitHub for" }
  }
  return { present: 'Using GitHub', past: 'Used GitHub', failed: "Couldn't use GitHub" }
}

export const github: Integration = {
  id: 'github',
  name: 'GitHub',
  icon: 'github',
  tools,
  prompt:
    'You can read GitHub through the github_* tools: repository overviews and READMEs, file trees, file contents, commit history and diffs, issues and pull requests, and repository search. Whenever the user mentions a repository ("owner/repo", a github.com link, or a project by name) look at the real repository instead of guessing: start with github_repo, then browse and read the files you need. Never invent file contents, commit messages or repository facts. Mention file paths when you explain code. If a repository is private or the rate limit is hit, tell the user to add a GitHub token in Settings → Integrations.',
  enabled: (s: Settings) => s.integrations.github.enabled,
  owns: (t) => t.startsWith('github_'),
  describe,
  run,
  triggers: /github\.com\/[\w.-]+\/[\w.-]+|\bgithub\b.{0,40}\b(repo|repository|commit|issue|pull request|PR|readme)\b/i,
}
