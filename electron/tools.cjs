'use strict'
/**
 * Local tools for Code mode: files, search and shell. Pure Node (no Electron imports) so they can be tested on their own.
 * Every path is resolved against the session's working directory; leaving it needs `allowOutside` (the renderer sets that
 * only after the user approved it).
 */
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn, execFile } = require('node:child_process')

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.turbo', '.cache', 'coverage', '__pycache__', '.venv', 'venv', 'target', '.gradle', '.idea', 'out', '.svelte-kit', '.parcel-cache'])
const MAX_READ_BYTES = 2_000_000
const MAX_OUTPUT = 60_000

class ToolError extends Error {
  constructor(message, code) { super(message); this.code = code }
}

/** Resolve `p` against `cwd`; refuses anything that ends up outside it unless allowOutside. */
function resolveIn(cwd, p, allowOutside) {
  if (!cwd) throw new ToolError('No project folder is open.', 'NO_CWD')
  const root = path.resolve(cwd)
  const abs = path.resolve(root, String(p ?? '.').replace(/^~(?=$|\/)/, os.homedir()))
  let real = abs
  try { real = fs.realpathSync(abs) } catch { /* may not exist yet: check the nearest existing parent */
    let dir = path.dirname(abs)
    while (dir && !fs.existsSync(dir) && dir !== path.dirname(dir)) dir = path.dirname(dir)
    try { real = path.join(fs.realpathSync(dir), path.relative(dir, abs)) } catch { /* keep abs */ }
  }
  let realRoot = root
  try { realRoot = fs.realpathSync(root) } catch { /* ignore */ }
  const inside = real === realRoot || real.startsWith(realRoot + path.sep)
  if (!inside && !allowOutside) throw new ToolError(`${abs} is outside the project folder.`, 'OUTSIDE')
  return { abs, rel: inside ? path.relative(root, abs) || '.' : abs, inside }
}

const isBinary = (buf) => { const n = Math.min(buf.length, 4000); for (let i = 0; i < n; i++) if (buf[i] === 0) return true; return false }

/* ---------------------------------- files ---------------------------------- */
async function readFile({ cwd, path: p, offset = 1, limit = 2000, allowOutside }) {
  const { abs, rel } = resolveIn(cwd, p, allowOutside)
  let st
  try { st = await fsp.stat(abs) } catch { throw new ToolError(`No such file: ${rel}`, 'ENOENT') }
  if (st.isDirectory()) throw new ToolError(`${rel} is a folder. Use list_files.`, 'EISDIR')
  if (st.size > MAX_READ_BYTES) throw new ToolError(`${rel} is ${(st.size / 1e6).toFixed(1)} MB, too large to read. Use search_code or read part of it with run_command.`, 'TOOBIG')
  const buf = await fsp.readFile(abs)
  if (isBinary(buf)) throw new ToolError(`${rel} looks like a binary file.`, 'BINARY')
  const lines = buf.toString('utf8').split('\n')
  const start = Math.max(1, Math.floor(offset))
  const slice = lines.slice(start - 1, start - 1 + Math.max(1, Math.floor(limit)))
  const width = String(start + slice.length).length
  const text = slice.map((l, i) => `${String(start + i).padStart(width, ' ')}\t${l.length > 2000 ? l.slice(0, 2000) + '…' : l}`).join('\n')
  return { path: rel, totalLines: lines.length, from: start, to: start + slice.length - 1, text, truncated: start - 1 + slice.length < lines.length }
}

/** Small line diff (common head and tail trimmed) with a few lines of context, for display. */
function makeDiff(oldText, newText) {
  const a = oldText.split('\n'), b = newText.split('\n')
  let s = 0
  while (s < a.length && s < b.length && a[s] === b[s]) s++
  let ea = a.length, eb = b.length
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb-- }
  const ctx = 3
  const lines = []
  for (let i = Math.max(0, s - ctx); i < s; i++) lines.push({ t: ' ', n: i + 1, s: a[i] })
  for (let i = s; i < ea; i++) lines.push({ t: '-', n: i + 1, s: a[i] })
  for (let i = s; i < eb; i++) lines.push({ t: '+', n: i + 1, s: b[i] })
  for (let i = ea; i < Math.min(a.length, ea + ctx); i++) lines.push({ t: ' ', n: i - ea + eb + 1, s: a[i] })
  const cap = 400
  return { added: eb - s, removed: ea - s, lines: lines.length > cap ? lines.slice(0, cap) : lines, truncated: lines.length > cap, firstLine: s + 1 }
}

/** Numbered lines of a file, so the AI can see what is really in it after a write. */
function numbered(text, from, to) {
  const lines = text.split('\n')
  const a = Math.max(1, from), b = Math.min(lines.length, to)
  return lines.slice(a - 1, b).map((l, i) => `${a + i}\t${l.length > 200 ? l.slice(0, 200) + '…' : l}`).join('\n')
}
function preview(text, mode, addedFrom) {
  const n = text.split('\n').length
  if (mode === 'around' && addedFrom) return numbered(text, addedFrom - 3, addedFrom + 22) + (n > addedFrom + 22 ? `\n…(${n - addedFrom - 22} more lines)` : '')
  return numbered(text, 1, 30) + (n > 30 ? `\n…(${n - 30} more lines; read_file to see them)` : '')
}

/** A quick real check of what was written, for file types that have a cheap checker. Returns an error text, or '' when fine / not checkable. */
function syntaxCheck(abs, text) {
  const ext = path.extname(abs).toLowerCase()
  if (ext === '.json') { try { JSON.parse(text) } catch (e) { return String(e.message).slice(0, 300) } return Promise.resolve('') }
  const run = (cmd, args, env) => new Promise((resolve) => execFile(cmd, args, { timeout: 6000, maxBuffer: 100_000, env: { ...process.env, ...(env || {}) } }, (err, _o, stderr) => resolve(err ? String(stderr || err.message).split('\n').filter((l) => !/^\s+at |^Node\.js v|^\s*$/.test(l)).join('\n').replace(/^\S*\/([^/\s]+:\d+)/gm, '$1').slice(0, 500) : '')))
  if (ext === '.cjs' || ext === '.mjs' || ext === '.js') {
    return run(process.execPath, ['--check', abs], { ELECTRON_RUN_AS_NODE: '1' }).then((e) => (/Cannot use import statement|Unexpected token 'export'|Cannot use 'import\.meta'|await is only valid/.test(e) ? '' : e))
  }
  if (ext === '.py') return run('python3', ['-m', 'py_compile', abs]).then((e) => (/No such file or directory.*python3|not found/i.test(e) ? '' : e))
  if (ext === '.sh') return run('bash', ['-n', abs])
  return Promise.resolve('')
}

/** How much of the old file would survive: share of its meaningful lines that are still present in the new text. */
function keptShare(old, next) {
  const keep = new Set(next.split('\n').map((l) => l.trim()).filter(Boolean))
  const lines = old.split('\n').map((l) => l.trim()).filter((l) => l.length > 1)
  if (!lines.length) return { total: 0, lost: 0 }
  const lost = lines.filter((l) => !keep.has(l)).length
  return { total: lines.length, lost }
}

async function writeFile({ cwd, path: p, content, allowOutside, guard, overwrite }) {
  const { abs, rel } = resolveIn(cwd, p, allowOutside)
  let old = null
  try { const st = await fsp.stat(abs); if (st.isDirectory()) throw new ToolError(`${rel} is a folder.`, 'EISDIR'); old = await fsp.readFile(abs, 'utf8') } catch (e) { if (e instanceof ToolError) throw e }
  const text = String(content ?? '')
  // When the AI replaces an existing file, refuse if that would throw away most of what was there (the usual mistake is
  // "add one thing" done as a rewrite that keeps only the new thing). It can still pass overwrite:true when it means it.
  if (guard && old !== null && !overwrite) {
    const { total, lost } = keptShare(old, text)
    if (total >= 8 && lost / total > 0.35) {
      throw new ToolError(`Refused: ${rel} already has ${old.split('\n').length} lines and this write would delete ${lost} of its ${total} lines. Nothing was changed. To ADD something, use append_file (adds to the end) or edit_file (insert next to existing text). To change one part, use edit_file. Only if you really mean to replace the whole file, read it first and call write_file again with overwrite set to true.`, 'CLOBBER')
    }
  }
  if (old !== null && old === text) return { path: rel, created: false, unchanged: true, bytes: Buffer.byteLength(text), diff: makeDiff(old, text) }
  await fsp.mkdir(path.dirname(abs), { recursive: true })
  await fsp.writeFile(abs, text, 'utf8')
  return { path: rel, created: old === null, bytes: Buffer.byteLength(text), diff: makeDiff(old ?? '', text), totalLines: text.split('\n').length, preview: preview(text, 'head'), syntax: await syntaxCheck(abs, text) }
}

/* Finding the text to replace. The AI copies from read_file output, which has line numbers in front, and it often loses tabs, trailing
   spaces, Windows line endings or indentation on the way. Try the exact text first, then forgive those slips one at a time. */
const stripNums = (t) => { const ls = t.split('\n'); return ls.filter((l) => l.trim()).length && ls.every((l) => !l.trim() || /^\s*\d+(\t| {1,2}\|? ?)/.test(l)) ? ls.map((l) => l.replace(/^\s*\d+(\t| {1,2}\|? ?)/, '')).join('\n') : t }
const indentOf = (l) => /^[ \t]*/.exec(l)[0]

function locate(old, find, repl) {
  const crlf = old.includes('\r\n')
  const norm = (t) => (crlf ? t.replace(/\r?\n/g, '\r\n') : t.replace(/\r\n/g, '\n'))
  const tries = [{ f: find, r: repl, how: '' }]
  const nf = stripNums(find)
  if (nf !== find) tries.push({ f: nf, r: stripNums(repl), how: 'ignoring the line numbers copied from read_file' })
  for (const t of [...tries]) if (norm(t.f) !== t.f) tries.push({ f: norm(t.f), r: norm(t.r), how: 'ignoring a line-ending difference' })
  for (const t of tries) { const c = old.split(t.f).length - 1; if (c > 0) return { find: t.f, repl: t.r, count: c, how: t.how } }
  // line by line, ignoring indentation and trailing spaces
  const eol = crlf ? '\r\n' : '\n'
  const oldLines = old.split('\n').map((l) => l.replace(/\r$/, ''))
  const want = nf.split('\n').map((l) => l.replace(/\r$/, ''))
  while (want.length && !want[want.length - 1].trim()) want.pop()
  while (want.length && !want[0].trim()) want.shift()
  if (!want.length) return null
  const key = (l) => l.trim().replace(/\s+/g, ' ')
  const wk = want.map(key)
  const hits = []
  for (let i = 0; i + want.length <= oldLines.length; i++) {
    let ok = true
    for (let j = 0; j < want.length && ok; j++) if (key(oldLines[i + j]) !== wk[j]) ok = false
    if (ok) { hits.push(i); i += want.length - 1 }
  }
  if (!hits.length) return null
  return { fuzzy: true, hits, want, oldLines, eol, count: hits.length, how: 'ignoring whitespace and indentation differences' }
}

/** The part of the file that looks most like what the AI asked for, shown with line numbers so it can copy it exactly. */
function nearest(old, find) {
  const lines = old.split('\n')
  const probes = stripNums(find).split('\n').map((l) => l.trim()).filter((l) => l.length > 3)
  for (const probe of [...probes].sort((a, b) => b.length - a.length).slice(0, 4)) {
    const k = probe.replace(/\s+/g, ' ')
    const i = lines.findIndex((l) => { const x = l.replace(/\s+/g, ' ').trim(); return x.includes(k) || (x.length >= 6 && k.includes(x)) })
    if (i >= 0) return `The closest match in the file is around line ${i + 1}. This is what is actually there (copy from it, keep its exact spacing):\n${numbered(old, Math.max(1, i - 1), i + 12)}`
  }
  return `None of the lines of your old_string were found anywhere in the file (it has ${lines.length} lines). The file may have changed since you read it: call read_file again, then copy a short, unique piece from the result.`
}

async function editFile({ cwd, path: p, oldString, newString, replaceAll, allowOutside }) {
  const { abs, rel } = resolveIn(cwd, p, allowOutside)
  let old
  try { old = await fsp.readFile(abs, 'utf8') } catch { throw new ToolError(`No such file: ${rel}. Use write_file to create it.`, 'ENOENT') }
  const find0 = String(oldString ?? ''), repl0 = String(newString ?? '')
  if (!find0) throw new ToolError('old_string is empty. To create or overwrite a file use write_file.', 'EMPTY')
  if (find0 === repl0) throw new ToolError('old_string and new_string are identical.', 'SAME')
  const m = locate(old, find0, repl0)
  if (!m) throw new ToolError(`old_string was not found in ${rel}. ${nearest(old, find0)}`, 'NOTFOUND')
  if (m.count > 1 && !replaceAll) throw new ToolError(`old_string appears ${m.count} times in ${rel}. Add more surrounding lines to make it unique, or set replace_all.`, 'AMBIGUOUS')
  let next
  if (m.fuzzy) {
    const replLines = stripNums(repl0).split('\n').map((l) => l.replace(/\r$/, ''))
    const out = []
    let at = 0
    const hits = replaceAll ? m.hits : [m.hits[0]]
    for (const h of hits) {
      out.push(...m.oldLines.slice(at, h))
      // the replacement takes the file's indentation where the AI's copy had a different one
      const fileInd = indentOf(m.oldLines[h]), askedInd = indentOf(m.want[0])
      for (const l of replLines) out.push(!l.trim() ? l : askedInd === fileInd ? l : l.startsWith(askedInd) ? fileInd + l.slice(askedInd.length) : fileInd + l.trimStart())
      at = h + m.want.length
    }
    out.push(...m.oldLines.slice(at))
    next = out.join(m.eol)
  } else {
    next = replaceAll ? old.split(m.find).join(m.repl) : old.replace(m.find, () => m.repl)
  }
  await fsp.writeFile(abs, next, 'utf8')
  return { path: rel, replaced: replaceAll ? m.count : 1, diff: makeDiff(old, next), totalLines: next.split('\n').length, matched: m.how || undefined, syntax: await syntaxCheck(abs, next) }
}

async function appendFile({ cwd, path: p, content, position, allowOutside }) {
  const { abs, rel } = resolveIn(cwd, p, allowOutside)
  let old
  try { old = await fsp.readFile(abs, 'utf8') } catch { throw new ToolError(`No such file: ${rel}. Use write_file to create it.`, 'ENOENT') }
  const add = String(content ?? '')
  if (!add) throw new ToolError('content is empty.', 'EMPTY')
  if (add.trim().length >= 12 && old.includes(add.trim())) return { path: rel, unchanged: true, diff: makeDiff(old, old), bytes: Buffer.byteLength(old), totalLines: old.split('\n').length }
  const nl = (t) => (t.endsWith('\n') || !t ? t : t + '\n')
  const next = position === 'start' ? nl(add) + old : (old && !old.endsWith('\n') ? old + '\n' : old) + nl(add)
  await fsp.writeFile(abs, next, 'utf8')
  const addedFrom = position === 'start' ? 1 : old.split('\n').length - (old.endsWith('\n') ? 1 : 0) + 1
  return { path: rel, diff: makeDiff(old, next), bytes: Buffer.byteLength(next), totalLines: next.split('\n').length, preview: preview(next, 'around', addedFrom), syntax: await syntaxCheck(abs, next) }
}

async function writeBase64({ cwd, path: p, base64, allowOutside }) {
  const { abs, rel } = resolveIn(cwd, p, allowOutside)
  let existed = true
  try { await fsp.stat(abs) } catch { existed = false }
  await fsp.mkdir(path.dirname(abs), { recursive: true })
  const buf = Buffer.from(String(base64 ?? ''), 'base64')
  await fsp.writeFile(abs, buf)
  return { path: rel, bytes: buf.length, created: !existed }
}

/* --------------------------------- listing --------------------------------- */
async function listFiles({ cwd, path: p = '.', depth = 2, allowOutside }) {
  const { abs, rel } = resolveIn(cwd, p, allowOutside)
  let count = 0
  const lines = []
  async function walk(dir, level, prefix) {
    let ents
    try { ents = await fsp.readdir(dir, { withFileTypes: true }) } catch { return }
    ents.sort((x, y) => (x.isDirectory() === y.isDirectory() ? x.name.localeCompare(y.name) : x.isDirectory() ? -1 : 1))
    for (const e of ents) {
      if (count >= 500) { lines.push(`${prefix}…`); return }
      if (e.name === '.DS_Store') continue
      count++
      if (e.isDirectory()) {
        lines.push(`${prefix}${e.name}/`)
        if (IGNORED_DIRS.has(e.name)) { lines[lines.length - 1] += ' (skipped)'; continue }
        if (level < depth) await walk(path.join(dir, e.name), level + 1, prefix + '  ')
      } else lines.push(`${prefix}${e.name}`)
    }
  }
  try { if (!(await fsp.stat(abs)).isDirectory()) throw new ToolError(`${rel} is a file.`, 'ENOTDIR') } catch (e) { if (e instanceof ToolError) throw e; throw new ToolError(`No such folder: ${rel}`, 'ENOENT') }
  await walk(abs, 1, '')
  return { path: rel, text: lines.join('\n') || '(empty)', count }
}

/** glob -> RegExp: ** crosses folders, * and ? stay inside one, {a,b} alternatives. */
function globToRegex(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') { i++; if (glob[i + 1] === '/') { i++; re += '(?:.*/)?' } else re += '.*' } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else if (c === '{') { const j = glob.indexOf('}', i); if (j > i) { re += '(?:' + glob.slice(i + 1, j).split(',').map((x) => x.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|') + ')'; i = j } else re += '\\{' }
    else re += /[.+^$()|[\]\\]/.test(c) ? '\\' + c : c
  }
  return new RegExp('^' + re + '$')
}

async function* walkFiles(root, signal) {
  const stack = [root]
  while (stack.length) {
    if (signal?.aborted) return
    const dir = stack.pop()
    let ents
    try { ents = await fsp.readdir(dir, { withFileTypes: true }) } catch { continue }
    for (const e of ents) {
      if (e.isDirectory()) { if (!IGNORED_DIRS.has(e.name) && !e.isSymbolicLink()) stack.push(path.join(dir, e.name)) }
      else if (e.isFile()) yield path.join(dir, e.name)
    }
  }
}

async function findFiles({ cwd, pattern, path: p = '.', allowOutside }) {
  const { abs, rel } = resolveIn(cwd, p, allowOutside)
  if (!pattern) throw new ToolError('Provide a glob pattern like **/*.ts', 'EMPTY')
  const re = globToRegex(String(pattern).replace(/^\.\//, ''))
  const matchBase = !String(pattern).includes('/')
  const out = []
  for await (const f of walkFiles(abs)) {
    const r = path.relative(abs, f).split(path.sep).join('/')
    if (re.test(matchBase ? path.basename(f) : r)) out.push(r)
    if (out.length >= 300) break
  }
  out.sort()
  return { path: rel, files: out, truncated: out.length >= 300 }
}

async function searchCode({ cwd, pattern, path: p = '.', glob, ignoreCase, context = 0, maxResults = 150, allowOutside }) {
  const { abs, rel } = resolveIn(cwd, p, allowOutside)
  if (!pattern) throw new ToolError('Provide a search pattern.', 'EMPTY')
  let re
  try { re = new RegExp(pattern, ignoreCase ? 'i' : '') } catch { re = new RegExp(String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), ignoreCase ? 'i' : '') }
  const gre = glob ? globToRegex(String(glob)) : null
  const base = glob && !String(glob).includes('/')
  const results = []
  let files = 0
  const ctxN = Math.min(5, Math.max(0, Number(context) || 0))
  let single = false
  try { single = (await fsp.stat(abs)).isFile() } catch { throw new ToolError(`No such path: ${rel}`, 'ENOENT') }
  const iter = single ? (async function* () { yield abs })() : walkFiles(abs)
  outer: for await (const f of iter) {
    const r = path.relative(single ? path.dirname(abs) : abs, f).split(path.sep).join('/')
    if (gre && !gre.test(base ? path.basename(f) : r)) continue
    let st
    try { st = await fsp.stat(f) } catch { continue }
    if (st.size > 1_500_000) continue
    let buf
    try { buf = await fsp.readFile(f) } catch { continue }
    if (isBinary(buf)) continue
    files++
    const lines = buf.toString('utf8').split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i])) continue
      for (let k = Math.max(0, i - ctxN); k <= Math.min(lines.length - 1, i + ctxN); k++) results.push(`${r}:${k + 1}${k === i ? ':' : '-'} ${lines[k].slice(0, 300)}`)
      if (ctxN) results.push('--')
      if (results.length >= maxResults) break outer
    }
  }
  return { path: rel, files, matches: results.filter((x) => x !== '--').length, text: results.join('\n'), truncated: results.length >= maxResults }
}

/* ----------------------------------- shell ----------------------------------- */
const running = new Map()
/* A zsh/bash login shell reads .zprofile but not .zshrc, where most people set PATH (nvm, pyenv, brew, cargo…).
   Ask the user's own interactive shell for its environment once, and run commands with that. */
let shellEnv = null
let shellEnvReady = null
function loadShellEnv() {
  if (shellEnvReady) return shellEnvReady
  if (process.platform === 'win32') return (shellEnvReady = Promise.resolve())
  shellEnvReady = new Promise((resolve) => {
    const mark = '__KOKO_ENV__'
    execFile(process.env.SHELL || '/bin/zsh', ['-ilc', `printf '${mark}'; env -0; printf '${mark}'`], { timeout: 8000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, TERM: 'dumb', DISABLE_AUTO_UPDATE: 'true' } }, (err, out) => {
      try {
        const body = String(out || '').split(mark)[1]
        if (body) { const e = {}; for (const kv of body.split('\0')) { const i = kv.indexOf('='); if (i > 0) e[kv.slice(0, i)] = kv.slice(i + 1) } if (e.PATH) shellEnv = e }
      } catch { /* keep the default environment */ }
      resolve()
    })
  })
  return shellEnvReady
}


async function runCommand({ id, cwd, command, timeoutMs = 120_000, env, onData }) {
  await loadShellEnv()
  return new Promise((resolve) => {
    const { abs } = resolveIn(cwd, '.', true)
    const win = process.platform === 'win32'
    const child = spawn(win ? process.env.ComSpec || 'cmd.exe' : process.env.SHELL || '/bin/bash', win ? ['/d', '/s', '/c', command] : ['-lc', command], {
      cwd: abs, env: { ...process.env, ...(shellEnv || {}), ...(env || {}), TERM: 'dumb', CI: process.env.CI ?? '1', GIT_TERMINAL_PROMPT: '0', PAGER: 'cat' }, detached: !win, stdio: ['ignore', 'pipe', 'pipe'],
    })
    running.set(id, child)
    let out = '', total = 0, timedOut = false, done = false
    const push = (b) => {
      const s = b.toString('utf8')
      total += s.length
      if (out.length < MAX_OUTPUT * 2) out += s
      onData?.(s)
    }
    child.stdout.on('data', push)
    child.stderr.on('data', push)
    const kill = () => { try { if (win) spawn('taskkill', ['/pid', String(child.pid), '/t', '/f']); else process.kill(-child.pid, 'SIGKILL') } catch { try { child.kill('SIGKILL') } catch { /* gone */ } } }
    const timer = setTimeout(() => { timedOut = true; kill() }, Math.min(Math.max(1000, timeoutMs), 600_000))
    const finish = (exitCode, signal) => {
      if (done) return
      done = true
      clearTimeout(timer); running.delete(id)
      let text = out
      if (text.length > MAX_OUTPUT) text = text.slice(0, MAX_OUTPUT / 2) + `\n…[${total - MAX_OUTPUT} characters omitted]…\n` + text.slice(-MAX_OUTPUT / 2)
      resolve({ exitCode, signal: signal || null, output: text, timedOut, killed: signal === 'SIGKILL' && !timedOut })
    }
    child.on('error', (e) => { out += `\n${e.message}`; finish(127, null) })
    child.on('close', (code, signal) => finish(code, signal))
  })
}

function killCommand(id) {
  const c = running.get(id)
  if (!c) return false
  try { if (process.platform === 'win32') spawn('taskkill', ['/pid', String(c.pid), '/t', '/f']); else process.kill(-c.pid, 'SIGKILL') } catch { try { c.kill('SIGKILL') } catch { /* gone */ } }
  return true
}

/* ------------------------------- project context ------------------------------- */
function sh(cmd, args, cwd) {
  return new Promise((resolve) => execFile(cmd, args, { cwd, timeout: 4000, maxBuffer: 200_000 }, (err, stdout) => resolve(err ? '' : String(stdout).trim())))
}

async function projectContext({ cwd }) {
  const { abs } = resolveIn(cwd, '.', true)
  let instructions = ''
  for (const name of ['CLAUDE.md', 'AGENTS.md', '.koko/instructions.md']) {
    try { const t = await fsp.readFile(path.join(abs, name), 'utf8'); instructions += `\n\n# ${name}\n${t.slice(0, 12_000)}`; break } catch { /* next */ }
  }
  const top = (await fsp.readdir(abs).catch(() => [])).filter((n) => n !== '.DS_Store').slice(0, 60)
  const [branch, status] = await Promise.all([sh('git', ['rev-parse', '--abbrev-ref', 'HEAD'], abs), sh('git', ['status', '--short'], abs)])
  return { cwd: abs, instructions: instructions.trim(), top, git: branch ? { branch, dirty: status.split('\n').filter(Boolean).length } : null, platform: process.platform, shell: process.env.SHELL || (process.platform === 'win32' ? 'cmd' : 'sh'), home: os.homedir() }
}


/* ------------------------------ file browser & git ------------------------------ */
const IMG = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon' }

/** One folder level, for the file tree (folders first). */
async function readTree({ cwd, path: p = '.', allowOutside }) {
  const { abs, rel } = resolveIn(cwd, p, allowOutside)
  let ents
  try { ents = await fsp.readdir(abs, { withFileTypes: true }) } catch { throw new ToolError(`Cannot open ${rel}.`, 'ENOENT') }
  const out = []
  for (const e of ents) {
    if (e.name === '.git' || e.name === '.DS_Store') continue
    const dir = e.isDirectory()
    if (dir && IGNORED_DIRS.has(e.name)) { out.push({ name: e.name, type: 'dir', hidden: true }); continue }
    let size = 0
    if (!dir) { try { size = (await fsp.stat(path.join(abs, e.name))).size } catch { /* broken link */ } }
    out.push({ name: e.name, type: dir ? 'dir' : 'file', size })
  }
  out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.type === 'dir' ? -1 : 1))
  return { path: rel, entries: out.slice(0, 800), truncated: out.length > 800 }
}

/** A file's contents for the viewer: text (capped), or a picture, or "binary". */
async function readRaw({ cwd, path: p, allowOutside }) {
  const { abs, rel } = resolveIn(cwd, p, allowOutside)
  let st
  try { st = await fsp.stat(abs) } catch { throw new ToolError(`No such file: ${rel}`, 'ENOENT') }
  if (st.isDirectory()) throw new ToolError(`${rel} is a folder.`, 'EISDIR')
  const ext = path.extname(abs).slice(1).toLowerCase()
  if (IMG[ext] && st.size <= 4_000_000) { const buf = await fsp.readFile(abs); return { path: rel, size: st.size, image: `data:${IMG[ext]};base64,${buf.toString('base64')}` } }
  const cap = 400_000
  const fh = await fsp.open(abs, 'r')
  try {
    const buf = Buffer.alloc(Math.min(st.size, cap))
    await fh.read(buf, 0, buf.length, 0)
    if (isBinary(buf)) return { path: rel, size: st.size, binary: true }
    return { path: rel, size: st.size, text: buf.toString('utf8'), truncated: st.size > cap }
  } finally { await fh.close() }
}

const git = (cwd, args, okCodes = [0]) => new Promise((resolve, reject) => {
  execFile('git', args, { cwd, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, ...(shellEnv || {}), GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' } }, (err, stdout) => {
    if (err && !okCodes.includes(err.code)) return reject(err)
    resolve(String(stdout || ''))
  })
})

/** What changed in the working tree compared with the last commit (with what is staged for the next commit). */
async function gitStatus({ cwd }) {
  const { abs } = resolveIn(cwd, '.', true)
  let out
  try { out = await git(abs, ['status', '--porcelain=v1', '-b', '-uall']) } catch { return { isRepo: false, files: [] } }
  const lines = out.split('\n').filter(Boolean)
  const head = lines[0]?.startsWith('## ') ? lines.shift().slice(3) : ''
  const branch = head.split('...')[0].replace(/^No commits yet on /, '')
  const upstream = head.includes('...') ? head.split('...')[1].split(' ')[0] : ''
  const ahead = +((/ahead (\d+)/.exec(head) || [])[1] || 0), behind = +((/behind (\d+)/.exec(head) || [])[1] || 0)
  const stats = {}
  try {
    for (const l of (await git(abs, ['diff', '--numstat', 'HEAD'], [0, 128])).split('\n')) { const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(l); if (m) stats[m[3]] = { added: m[1] === '-' ? 0 : +m[1], removed: m[2] === '-' ? 0 : +m[2] } }
  } catch { /* no commits yet */ }
  const files = lines.map((l) => {
    const x = l[0], y = l[1]
    let f = l.slice(3)
    if (f.includes(' -> ')) f = f.split(' -> ')[1]
    f = f.replace(/^"|"$/g, '')
    const untracked = x === '?'
    const status = untracked ? 'U' : (x !== ' ' ? x : y)
    return { path: f, status, staged: !untracked && x !== ' ', unstaged: untracked || y !== ' ', ...(stats[f] ?? {}) }
  })
  return { isRepo: true, branch, upstream, ahead, behind, files }
}

/** A unified diff of one file against the last commit (new files are shown in full). */
async function gitDiff({ cwd, path: p, status }) {
  const { abs, rel } = resolveIn(cwd, '.', true)
  if (status === 'U') {
    const { text, binary, truncated } = await readRaw({ cwd, path: p })
    if (binary || text === undefined) return { binary: true, text: '' }
    return { text: text.replace(/\n$/, '').split('\n').map((l) => '+' + l).join('\n'), truncated, untracked: true }
  }
  let out = ''
  try { out = await git(abs, ['diff', 'HEAD', '--no-color', '-U3', '--', p], [0, 1]) } catch { out = await git(abs, ['diff', '--no-color', '-U3', '--', p], [0, 1]) }
  if (/^Binary files/m.test(out)) return { binary: true, text: '' }
  const truncated = out.length > 300_000
  return { text: truncated ? out.slice(0, 300_000) : out, truncated }
}


/* ------------------------------------ git actions ------------------------------------ */
const gitRun = (cwd, args) => git(resolveIn(cwd, '.', true).abs, args)
const safePaths = (paths) => (Array.isArray(paths) ? paths : []).map(String).filter((p) => p && !p.startsWith('-')).slice(0, 2000)

async function gitStage({ cwd, paths, all }) { if (all) await gitRun(cwd, ['add', '-A']); else { const p = safePaths(paths); if (p.length) await gitRun(cwd, ['add', '--', ...p]) } return true }
async function gitUnstage({ cwd, paths, all }) {
  const args = all ? [] : safePaths(paths)
  try { await gitRun(cwd, ['restore', '--staged', '--', ...(all ? ['.'] : args)]) } catch { await gitRun(cwd, ['rm', '--cached', '-r', '-q', '--', ...(all ? ['.'] : args)]) } // (no commits yet: nothing to restore from)
  return true
}
/** Throw away changes to files: tracked ones go back to the last commit, untracked ones are deleted. */
async function gitDiscard({ cwd, paths }) {
  const p = safePaths(paths)
  if (!p.length) return true
  const st = await gitStatus({ cwd })
  const untracked = new Set(st.files.filter((f) => f.status === 'U').map((f) => f.path))
  const tracked = p.filter((x) => !untracked.has(x)), fresh = p.filter((x) => untracked.has(x))
  if (tracked.length) await gitRun(cwd, ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...tracked])
  for (const f of fresh) await fsp.rm(resolveIn(cwd, f).abs, { force: true, recursive: true })
  return true
}
async function gitCommit({ cwd, message, stageAll }) {
  const msg = String(message ?? '').trim()
  if (!msg) throw new ToolError('Write a commit message first.', 'EMPTY')
  if (stageAll) await gitRun(cwd, ['add', '-A'])
  const staged = (await gitRun(cwd, ['diff', '--cached', '--name-only'])).trim()
  if (!staged) throw new ToolError('Nothing is staged to commit.', 'NOTHING')
  const out = await new Promise((resolve, reject) => {
    execFile('git', ['commit', '-m', msg], { cwd: resolveIn(cwd, '.', true).abs, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, ...(shellEnv || {}), GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } }, (err, stdout, stderr) => (err ? reject(new ToolError(String(stderr || stdout || err.message).trim().slice(0, 600), 'COMMIT')) : resolve(String(stdout))))
  })
  const hash = (await gitRun(cwd, ['rev-parse', '--short', 'HEAD'])).trim()
  return { hash, summary: out.split('\n').find((l) => /file.* changed/.test(l))?.trim() || '' }
}
async function gitBranches({ cwd }) {
  const out = await gitRun(cwd, ['branch', '--format=%(HEAD)|%(refname:short)|%(upstream:short)'])
  const list = out.split('\n').filter(Boolean).map((l) => { const [h, name, up] = l.split('|'); return { name, current: h === '*', upstream: up || '' } }).filter((b) => !/^\(.*\)$/.test(b.name))
  return { branches: list }
}
async function gitCheckout({ cwd, branch, create }) {
  const b = String(branch ?? '').trim()
  if (!/^[\w][\w./-]{0,100}$/.test(b) || b.includes('..')) throw new ToolError('That is not a valid branch name.', 'BADNAME')
  await gitRun(cwd, create ? ['switch', '-c', b] : ['switch', b])
  return true
}
const gitNet = (cwd, args) => new Promise((resolve, reject) => {
  execFile('git', args, { cwd: resolveIn(cwd, '.', true).abs, timeout: 90_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, ...(shellEnv || {}), GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } }, (err, stdout, stderr) => (err ? reject(new ToolError(String(stderr || stdout || err.message).trim().slice(0, 600) || 'git failed', 'GIT')) : resolve(String(stderr || stdout).trim())))
})
async function gitPush({ cwd }) {
  const st = await gitStatus({ cwd })
  return { output: await gitNet(cwd, st.upstream ? ['push'] : ['push', '-u', 'origin', 'HEAD']) || 'Pushed.' }
}
async function gitPull({ cwd }) { return { output: await gitNet(cwd, ['pull', '--ff-only']) || 'Up to date.' } }
async function gitLog({ cwd, n = 12 }) {
  const out = await gitRun(cwd, ['log', `-${Math.min(50, Math.max(1, +n || 12))}`, '--format=%h%x1f%s%x1f%an%x1f%cr'])
  return { commits: out.split('\n').filter(Boolean).map((l) => { const [hash, subject, author, when] = l.split('\x1f'); return { hash, subject, author, when } }).slice(0, 50) }
}
/** Everything on this branch that the base branch does not have yet (for a pull request description). */
async function gitBranchChanges({ cwd }) {
  const abs = resolveIn(cwd, '.', true).abs
  let base = ''
  for (const c of ['origin/HEAD', 'origin/main', 'origin/master', 'main', 'master']) { try { await git(abs, ['rev-parse', '--verify', '-q', c]); base = c; break } catch { /* try the next */ } }
  const cur = (await git(abs, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  if (!base || base.replace('origin/', '') === cur) throw new ToolError('Switch to a feature branch first: there is no other branch to compare with.', 'NOBASE')
  const log = (await git(abs, ['log', `${base}..HEAD`, '--format=%s%n%b---'])).trim()
  const stat = (await git(abs, ['diff', `${base}...HEAD`, '--stat', '--no-color'])).trim()
  let diff = await git(abs, ['diff', `${base}...HEAD`, '--no-color', '-U1'])
  if (diff.length > 20000) diff = diff.slice(0, 20000) + '\n…[diff truncated]'
  return { base, branch: cur, log, stat, diff }
}
/** The change text the AI reads to write a commit message: staged changes, or everything if nothing is staged. */
async function gitChangeText({ cwd }) {
  const staged = (await gitRun(cwd, ['diff', '--cached', '--stat', '--no-color'])).trim()
  const useStaged = !!staged
  const stat = useStaged ? staged : (await gitRun(cwd, ['diff', 'HEAD', '--stat', '--no-color']).catch(() => '')).trim()
  let diff = useStaged ? await gitRun(cwd, ['diff', '--cached', '--no-color', '-U2']) : await gitRun(cwd, ['diff', 'HEAD', '--no-color', '-U2']).catch(() => '')
  const untracked = (await gitRun(cwd, ['ls-files', '--others', '--exclude-standard'])).split('\n').filter(Boolean)
  if (!useStaged && untracked.length) diff += '\n\nNew files (not yet tracked): ' + untracked.slice(0, 40).join(', ')
  const recent = (await gitRun(cwd, ['log', '-8', '--format=%s']).catch(() => '')).trim()
  return { stat, diff: diff.length > 24000 ? diff.slice(0, 24000) + '\n…[diff truncated]' : diff, recent, staged: useStaged }
}

module.exports = {
  gitStage, gitUnstage, gitDiscard, gitCommit, gitBranches, gitCheckout, gitPush, gitPull, gitLog, gitChangeText, gitBranchChanges,
  readTree, readRaw, gitStatus, gitDiff,
  loadShellEnv, getShellEnv: () => shellEnv, ToolError, resolveIn, readFile, writeFile, appendFile, editFile, writeBase64, listFiles, findFiles, searchCode, runCommand, killCommand, projectContext, globToRegex, makeDiff }
