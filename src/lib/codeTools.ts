import { useStore } from '../store'
import type { ToolDef } from './tools'
import { baseName, koko, type IpcResult } from './desktop'
import { requireApproval, riskOf, rulePrefix } from './permissions'
import { looseArgs } from './integrations'
import { BROWSER_TOOLS, isBrowserTool, runBrowserTool } from './browser'
import { ACTION_TOOLS, isActionTool, runActionTool } from './actions'

/* ------------------------------- tool definitions ------------------------------- */
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false })

export const CODE_TOOLS: ToolDef[] = [
  ...BROWSER_TOOLS,
  ...ACTION_TOOLS,
  {
    name: 'read_file',
    description: 'Read a text file from the project. Returns numbered lines. Read a file before editing it. Large files: pass offset and limit to read a part.',
    parameters: obj({ path: { type: 'string', description: 'Path relative to the project folder (or absolute).' }, offset: { type: 'number', description: 'First line to read, starting at 1.' }, limit: { type: 'number', description: 'Number of lines, default 2000.' } }, ['path']),
  },
  {
    name: 'edit_file',
    description: 'Change a file by replacing exact text. old_string must match the file exactly (whitespace included) and be unique, unless replace_all is set. Prefer this over rewriting whole files.',
    parameters: obj({ path: { type: 'string' }, old_string: { type: 'string', description: 'The exact text to replace. Include a few surrounding lines so it is unique.' }, new_string: { type: 'string', description: 'The replacement text.' }, replace_all: { type: 'boolean', description: 'Replace every occurrence (for renames).' } }, ['path', 'old_string', 'new_string']),
  },
  {
    name: 'write_file',
    description: 'Create a new file, or completely replace an existing one, with the given content. Parent folders are created. For small changes to an existing file use edit_file instead.',
    parameters: obj({ path: { type: 'string' }, content: { type: 'string', description: 'The full file content.' } }, ['path', 'content']),
  },
  {
    name: 'list_files',
    description: 'List the files and folders in a directory of the project as a tree (node_modules, .git and build folders are skipped).',
    parameters: obj({ path: { type: 'string', description: 'Folder, default the project root.' }, depth: { type: 'number', description: 'How many levels deep, default 2.' } }),
  },
  {
    name: 'find_files',
    description: 'Find files by name with a glob pattern such as "**/*.tsx" or "*.json" or "src/**/test_*.py".',
    parameters: obj({ pattern: { type: 'string' }, path: { type: 'string', description: 'Folder to search in, default the project root.' } }, ['pattern']),
  },
  {
    name: 'search_code',
    description: 'Search the text of the project\'s files with a regular expression. Returns file:line matches. Use it to find definitions, usages and strings before reading whole files.',
    parameters: obj({ pattern: { type: 'string', description: 'Regular expression (or plain text).' }, path: { type: 'string', description: 'Folder or file to search, default the project root.' }, glob: { type: 'string', description: 'Only files matching this glob, e.g. "*.ts".' }, ignore_case: { type: 'boolean' }, context: { type: 'number', description: 'Lines of context around each match (0-5).' } }, ['pattern']),
  },
  {
    name: 'run_command',
    description: 'Run a shell command in the project folder and return its output and exit code. Use it for installs, builds, tests, linters, git and scripts. Each call is a fresh shell (cd does not carry over). Commands must not wait for input. The user is asked to approve most commands.',
    parameters: obj({ command: { type: 'string' }, description: { type: 'string', description: 'What this does, in a few plain words (shown to the user), e.g. "Install dependencies".' }, timeout_seconds: { type: 'number', description: 'Default 120, max 600. Start long-running servers in the background with & and redirect their output.' } }, ['command']),
  },
]

/** In Code mode image generation can save the picture straight into the project. */
export const CODE_GENERATE_IMAGE: ToolDef = {
  name: 'generate_image',
  description: 'Generate an image (logo, icon, illustration, mockup, texture, photo) and save it into the project. Use it whenever the user wants a picture or asset made. Pick a sensible path and format from the project (for example public/logo.png or src/assets/hero.webp). The `prompt` is sent verbatim to the image model, so write a rich, enhanced prompt yourself.',
  parameters: obj({
    prompt: { type: 'string', description: 'The FINAL enhanced image prompt, written by you: subject, composition, style, colors, lighting, mood. For logos: simple flat shapes, centered, plain background, no text unless asked. Keep every detail the user gave and render quoted text verbatim.' },
    path: { type: 'string', description: 'Where to save it in the project, ending in .png, .jpg or .webp.' },
    title: { type: 'string', description: 'A short title (2-5 words).' },
    aspect: { type: 'string', enum: ['square', 'landscape', 'portrait'] },
  }, ['prompt', 'path']),
}

const NAMES = new Set(CODE_TOOLS.map((t) => t.name))
export const isCodeTool = (name: string) => NAMES.has(name)
export const isCodeChat = (chatId?: string) => !!chatId && useStore.getState().chats.find((c) => c.id === chatId)?.mode === 'code'

/* ------------------------------- how a call reads ------------------------------- */
export interface CodeDescribe { icon: 'read' | 'edit' | 'create' | 'list' | 'find' | 'search' | 'run' | 'web' | 'shot' | 'action'; present: string; past: string; failed: string; subject?: string; extra?: string; code?: boolean }

const hostOf = (u: unknown) => { try { return new URL(/^[a-z][a-z0-9+.-]*:/i.test(String(u)) ? String(u) : 'http://' + u).host } catch { return u ? String(u) : undefined } }
const short = (s: string, n = 70) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

export function describeCode(name: string, a: Record<string, any>, meta?: Record<string, any>): CodeDescribe {
  const path = a.path ? String(a.path) : ''
  const file = path ? baseName(path) : ''
  switch (name) {
    case 'read_file': return { icon: 'read', present: 'Reading', past: 'Read', failed: "Couldn't read", subject: file || 'a file', extra: a.offset ? `from line ${a.offset}` : undefined }
    case 'edit_file': return { icon: 'edit', present: 'Editing', past: 'Edited', failed: "Couldn't edit", subject: file || 'a file' }
    case 'write_file': return meta?.created === false ? { icon: 'edit', present: 'Rewriting', past: 'Rewrote', failed: "Couldn't write", subject: file || 'a file' } : { icon: 'create', present: 'Creating', past: 'Created', failed: "Couldn't create", subject: file || 'a file' }
    case 'list_files': return { icon: 'list', present: 'Looking at', past: 'Looked at', failed: "Couldn't list", subject: path && path !== '.' ? path : 'the project' }
    case 'find_files': return { icon: 'find', present: 'Finding files', past: 'Found files', failed: "Couldn't search for files", subject: a.pattern ? String(a.pattern) : undefined }
    case 'search_code': return { icon: 'search', present: 'Searching code for', past: 'Searched code for', failed: "Couldn't search for", subject: a.pattern ? `“${short(String(a.pattern), 40)}”` : undefined, extra: a.glob ? `in ${a.glob}` : undefined }
    case 'create_action': return { icon: 'action', present: 'Adding action', past: 'Added action', failed: "Couldn't add the action", subject: a.name ? String(a.name) : undefined }
    case 'remove_action': return { icon: 'action', present: 'Removing action', past: 'Removed action', failed: "Couldn't remove the action", subject: a.name ? String(a.name) : undefined }
    case 'list_actions': return { icon: 'action', present: 'Checking actions', past: 'Checked actions', failed: "Couldn't list actions" }
    case 'browser_open': return { icon: 'web', present: 'Opening', past: 'Opened', failed: "Couldn't open", subject: hostOf(a.url) }
    case 'browser_navigate': return { icon: 'web', present: a.action ? `Going ${a.action === 'reload' ? 'to reload' : a.action}` : 'Loading', past: a.action ? (a.action === 'reload' ? 'Reloaded the page' : `Went ${a.action}`) : 'Loaded', failed: "Couldn't load", subject: a.action ? undefined : hostOf(a.url) }
    case 'browser_read': return { icon: 'web', present: 'Reading the page', past: 'Read the page', failed: "Couldn't read the page", subject: meta?.title ? short(String(meta.title), 50) : undefined }
    case 'browser_click': return { icon: 'web', present: 'Clicking', past: 'Clicked', failed: "Couldn't click", subject: meta?.label ? `“${short(String(meta.label), 40)}”` : undefined }
    case 'browser_type': return { icon: 'web', present: 'Typing in', past: 'Typed in', failed: "Couldn't type in", subject: meta?.label ? `“${short(String(meta.label), 40)}”` : undefined, extra: a.text ? `“${short(String(a.text), 30)}”` : undefined }
    case 'browser_key': return { icon: 'web', present: 'Pressing', past: 'Pressed', failed: "Couldn't press", subject: a.key ? String(a.key) : undefined }
    case 'browser_scroll': return { icon: 'web', present: 'Scrolling', past: 'Scrolled', failed: "Couldn't scroll", subject: a.direction ? String(a.direction) : undefined }
    case 'browser_screenshot': return { icon: 'shot', present: 'Taking a screenshot', past: 'Took a screenshot', failed: "Couldn't take a screenshot" }
    case 'browser_tabs': return { icon: 'web', present: 'Checking browser tabs', past: 'Checked browser tabs', failed: "Couldn't list tabs" }
    default: return { icon: 'run', present: 'Running', past: 'Ran', failed: 'Command failed:', subject: a.command ? short(oneLine(String(a.command)), 80) : 'a command', code: true }
  }
}

export const describeBlock = (b: { name: string; args: string; meta?: Record<string, unknown> }) => describeCode(b.name, looseArgs(b.args), b.meta as any)

/* ---------------------------------- running ---------------------------------- */
interface Ctx { chatId: string; callId: string; signal: AbortSignal; update: (fn: (b: any) => void) => void; /** the reply these changes belong to (for undo) */ turn?: string }

const need = () => {
  const k = koko()
  if (!k) throw new Error('Code mode only works in the Koko desktop app.')
  return k
}
const cwdOf = (chatId: string) => {
  const cwd = useStore.getState().chats.find((c) => c.id === chatId)?.cwd
  if (!cwd) throw new Error('This session has no project folder. Choose one first.')
  return cwd
}

/** Call a filesystem tool; if it reaches outside the project folder, ask first and retry. */
async function withFs<T>(ctx: Ctx, kind: 'read' | 'write', what: string, call: (allowOutside: boolean) => Promise<IpcResult<T>>): Promise<T> {
  let r = await call(false)
  if (!r.ok && r.error.code === 'OUTSIDE') {
    await requireApproval(ctx.chatId, ctx.callId, { kind: 'outside', title: kind === 'read' ? 'Read outside the project folder' : 'Change a file outside the project folder', detail: what, risky: 'This is not inside your project' }, ctx.signal, ctx.update)
    r = await call(true)
  }
  if (!r.ok) throw new Error(r.error.message)
  return r.data
}

const diffSummary = (d: { added: number; removed: number }) => `+${d.added} −${d.removed}`

export async function runCodeTool(name: string, a: Record<string, any>, ctx: Ctx): Promise<{ output: string; images?: string[] }> {
  if (isBrowserTool(name)) return runBrowserTool(name, a, ctx)
  if (isActionTool(name)) return runActionTool(name, a, { chatId: ctx.chatId, update: ctx.update })
  const k = need()
  const cwd = cwdOf(ctx.chatId)
  const meta = (m: Record<string, unknown>) => ctx.update((b) => { b.meta = { ...(b.meta ?? {}), ...m } })
  const path = String(a.path ?? '')

  if (name === 'read_file') {
    const r = await withFs(ctx, 'read', path, (o) => k.fs.read({ cwd, path, offset: Number(a.offset) || 1, limit: Number(a.limit) || 2000, allowOutside: o }))
    meta({ path: r.path, summary: `${r.to - r.from + 1} lines` })
    return { output: `${r.path} (lines ${r.from}-${r.to} of ${r.totalLines})\n${r.text}${r.truncated ? `\n…[more lines follow; call read_file again with offset ${r.to + 1}]` : ''}` }
  }

  if (name === 'edit_file') {
    if (!path) throw new Error('path is required')
    meta({ path })
    await requireApproval(ctx.chatId, ctx.callId, { kind: 'edit', title: `Edit ${baseName(path)}`, detail: path }, ctx.signal, ctx.update)
    const r = await withFs(ctx, 'write', path, (o) => k.fs.edit({ cwd, path, oldString: String(a.old_string ?? ''), newString: String(a.new_string ?? ''), replaceAll: !!a.replace_all, allowOutside: o, turn: ctx.turn }))
    meta({ path: r.path, diff: r.diff, summary: diffSummary(r.diff) })
    const ctxLines = r.diff.lines.slice(0, 60).map((l) => `${l.t === ' ' ? ' ' : l.t}${l.n}\t${l.s}`).join('\n')
    return { output: `Edited ${r.path}: replaced ${r.replaced} occurrence${r.replaced === 1 ? '' : 's'} (${diffSummary(r.diff)}).\n${ctxLines}` }
  }

  if (name === 'write_file') {
    if (!path) throw new Error('path is required')
    meta({ path })
    await requireApproval(ctx.chatId, ctx.callId, { kind: 'edit', title: `Write ${baseName(path)}`, detail: path }, ctx.signal, ctx.update)
    const r = await withFs(ctx, 'write', path, (o) => k.fs.write({ cwd, path, content: String(a.content ?? ''), allowOutside: o, turn: ctx.turn }))
    meta({ path: r.path, created: r.created, diff: r.diff, summary: r.created ? `${r.diff.added} lines` : diffSummary(r.diff) })
    return { output: `${r.created ? 'Created' : 'Overwrote'} ${r.path} (${r.bytes} bytes).` }
  }

  if (name === 'list_files') {
    const r = await withFs(ctx, 'read', String(a.path ?? '.'), (o) => k.fs.list({ cwd, path: String(a.path ?? '.'), depth: Number(a.depth) || 2, allowOutside: o }))
    meta({ path: r.path, summary: `${r.count} items` })
    return { output: `${r.path}\n${r.text}` }
  }

  if (name === 'find_files') {
    const r = await withFs(ctx, 'read', String(a.path ?? '.'), (o) => k.fs.find({ cwd, pattern: String(a.pattern ?? ''), path: String(a.path ?? '.'), allowOutside: o }))
    meta({ summary: `${r.files.length} file${r.files.length === 1 ? '' : 's'}` })
    return { output: r.files.length ? r.files.join('\n') + (r.truncated ? '\n…[more files, narrow the pattern]' : '') : 'No files matched.' }
  }

  if (name === 'search_code') {
    const r = await withFs(ctx, 'read', String(a.path ?? '.'), (o) => k.fs.search({ cwd, pattern: String(a.pattern ?? ''), path: String(a.path ?? '.'), glob: a.glob ? String(a.glob) : undefined, ignoreCase: !!a.ignore_case, context: Number(a.context) || 0, allowOutside: o }))
    meta({ summary: `${r.matches} match${r.matches === 1 ? '' : 'es'}` })
    return { output: r.matches ? r.text + (r.truncated ? '\n…[more matches, narrow the search]' : '') : 'No matches.' }
  }

  // run_command
  const command = String(a.command ?? '').trim()
  if (!command) throw new Error('command is empty')
  meta({ command, description: a.description ? String(a.description) : undefined })
  await requireApproval(ctx.chatId, ctx.callId, { kind: 'command', title: a.description ? String(a.description) : 'Run a command', detail: command, risky: riskOf(command), rule: rulePrefix(command), purpose: a.description ? String(a.description) : undefined }, ctx.signal, ctx.update)
  const id = ctx.callId
  let live = ''
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = () => { timer = undefined; const o = live.length > 30_000 ? '…' + live.slice(-30_000) : live; ctx.update((b) => { b.meta = { ...(b.meta ?? {}), output: o } }) }
  const off = k.shell.onData((d) => { if (d.id !== id) return; live += d.chunk; if (!timer) timer = setTimeout(flush, 120) })
  const onAbort = () => { void k.shell.kill(id) }
  ctx.signal.addEventListener('abort', onAbort, { once: true })
  try {
    const r = await k.shell.run({ id, cwd, command, timeoutMs: Math.min(600, Math.max(1, Number(a.timeout_seconds) || 120)) * 1000 })
    if (!r.ok) throw new Error(r.error.message)
    const res = r.data
    if (timer) clearTimeout(timer)
    meta({ output: res.output, exit: res.timedOut ? 'timeout' : res.exitCode, summary: res.timedOut ? 'timed out' : res.exitCode === 0 ? undefined : `exit ${res.exitCode}` })
    if (ctx.signal.aborted) throw new DOMException('Aborted', 'AbortError')
    const tail = res.timedOut ? '\n[The command timed out and was stopped.]' : `\n[exit code ${res.exitCode}]`
    return { output: (res.output.trim() || '(no output)') + tail }
  } finally {
    off()
    ctx.signal.removeEventListener('abort', onAbort)
  }
}

/* ---------------------- saving a generated image into the project ---------------------- */
const MIME_BY_EXT: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }

/** Re-encode an image data URL to the format of the file name it is going to be saved as. */
export async function dataUrlForPath(dataUrl: string, path: string): Promise<string> {
  const want = MIME_BY_EXT[(path.split('.').pop() ?? '').toLowerCase()]
  const have = /^data:([^;]+);/.exec(dataUrl)?.[1]
  if (!want || want === have) return dataUrl
  const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl })
  const c = document.createElement('canvas')
  c.width = img.width; c.height = img.height
  const x = c.getContext('2d')!
  if (want === 'image/jpeg') { x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height) }
  x.drawImage(img, 0, 0)
  return c.toDataURL(want, 0.92)
}

export async function saveImageToProject(ctx: Ctx, path: string, dataUrl: string): Promise<{ path: string; bytes: number }> {
  const k = need()
  const cwd = cwdOf(ctx.chatId)
  await requireApproval(ctx.chatId, ctx.callId, { kind: 'edit', title: `Save image to ${baseName(path)}`, detail: path }, ctx.signal, ctx.update)
  const out = await dataUrlForPath(dataUrl, path)
  const base64 = out.slice(out.indexOf(',') + 1)
  const r = await withFs(ctx, 'write', path, (o) => k.fs.writeBase64({ cwd, path, base64, allowOutside: o, turn: ctx.turn }))
  return { path: r.path, bytes: r.bytes }
}
