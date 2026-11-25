import type { Artifact, ChatSandbox, Settings } from '../types'
import { useStore, type SandboxState } from '../store'
import { recompressImage } from './images'
import { uid } from './utils'

/* ------------------------------------------------------------------ *
 *  Sandbox = one persistent Freestyle Linux VM per chat, reached through
 *  the sync worker's /v1/sandbox proxy (Freestyle's API blocks browser
 *  Authorization headers). https://www.freestyle.sh/docs/vms
 * ------------------------------------------------------------------ */

export class SandboxError extends Error {}

const clipText = (t: string, max = 20_000) => (t.length > max ? t.slice(0, max / 2) + `\n…[${t.length - max} characters omitted]…\n` + t.slice(-max / 2) : t)

interface Cfg { url: string; token: string; key: string; settings: Settings['sandbox'] }
function cfg(): Cfg {
  const s = useStore.getState()
  const { sync, settings } = s
  if (!settings.sandbox.apiKey.trim()) throw new SandboxError('No Freestyle API key. Ask the user to add one in Settings → Tools → Sandbox.')
  if (!sync.token || !sync.url) throw new SandboxError('The sandbox runs through the sync server. Ask the user to sign in under Settings → Sync first.')
  return { url: sync.url, token: sync.token, key: settings.sandbox.apiKey.trim(), settings: settings.sandbox }
}

async function raw(method: string, path: string, opts: { query?: Record<string, string>; json?: unknown; body?: BodyInit; signal?: AbortSignal; headers?: Record<string, string> } = {}) {
  const c = cfg()
  const qs = opts.query ? '?' + new URLSearchParams(opts.query).toString() : ''
  let res: Response
  try {
    res = await fetch(`${c.url}/v1/sandbox${path}${qs}`, {
      method, signal: opts.signal,
      headers: { Authorization: `Bearer ${c.token}`, 'X-Freestyle-Key': c.key, ...(opts.json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...opts.headers },
      body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body,
    })
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e
    throw new SandboxError('Could not reach the sync server.')
  }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try { const j = await res.clone().json(); msg = j.message ?? j.error ?? msg } catch { /* ignore */ }
    const e = new SandboxError(msg) as SandboxError & { status: number }
    e.status = res.status
    throw e
  }
  return res
}
const json = async <T>(method: string, path: string, opts?: Parameters<typeof raw>[2]) => (await raw(method, path, opts)).json() as Promise<T>

/* ------------------------------ lifecycle ----------------------------- */
interface VmData { id: string; state: 'starting' | 'running' | 'pausing' | 'paused' | 'stopped'; slug?: string | null }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitRunning(id: string, signal?: AbortSignal) {
  let started = false
  for (let i = 0; i < 40; i++) {
    const d = await json<VmData>('GET', `/v5/vms/${id}`, { signal })
    if (d.state === 'running') return
    if (!started && (d.state === 'paused' || d.state === 'stopped')) { started = true; await json('POST', `/v5/vms/${id}/start`, { signal }) }
    await sleep(1200)
  }
  throw new SandboxError('The sandbox did not start in time.')
}

const toState = (s: VmData['state']): SandboxState => (s === 'running' ? 'active' : s === 'starting' ? 'waking' : s === 'pausing' ? 'sleeping' : 'asleep')
const setState = (chatId: string, s: SandboxState) => useStore.getState().setSandboxState(chatId, s)

/** Refresh the status shown in the UI from Freestyle. */
export async function refreshSandboxState(chatId: string) {
  const sb = useStore.getState().chats.find((c) => c.id === chatId)?.sandbox
  if (!sb) return
  try { setState(chatId, toState((await json<VmData>('GET', `/v5/vms/${sb.vmId}`)).state)) }
  catch (e: any) { if (e?.status === 404 || e?.status === 410) setState(chatId, 'gone') }
}

export async function wakeSandbox(chatId: string) {
  const sb = useStore.getState().chats.find((c) => c.id === chatId)?.sandbox
  if (!sb) return
  setState(chatId, 'waking')
  try { await waitRunning(sb.vmId); setState(chatId, 'active') } catch (e) { await refreshSandboxState(chatId); throw e }
}

export async function pauseSandbox(chatId: string) {
  const sb = useStore.getState().chats.find((c) => c.id === chatId)?.sandbox
  if (!sb) return
  setState(chatId, 'sleeping')
  try { await json('POST', `/v5/vms/${sb.vmId}/pause`) } catch { /* already paused or gone: the refresh below tells us */ }
  await refreshSandboxState(chatId)
}

/**
 * After each reply: pause the VM so it stops costing compute. Files and memory are kept, and the next
 * command or file write wakes it. A VM that is serving a deployed app stays awake so the app stays up.
 */
export async function sleepAfterTurn(chatId: string) {
  const st = useStore.getState()
  const chat = st.chats.find((c) => c.id === chatId)
  if (!chat?.sandbox || !st.settings.sandbox.sleepAfterTurn || !st.settings.sandbox.apiKey || !st.sync.token) return
  if (chat.sandbox.urls?.length) return void refreshSandboxState(chatId)
  if (st.streaming[chatId]) return // a new turn already started
  if (st.sandboxState[chatId] === 'asleep') return // nothing woke it this turn (e.g. only read files)
  await pauseSandbox(chatId)
}

const PROBE = `echo "user=$(whoami) home=$HOME cwd=$(pwd)"; . /etc/os-release 2>/dev/null && echo "os=$PRETTY_NAME"; echo "arch=$(uname -m) cpus=$(nproc) mem=$(free -m 2>/dev/null | awk '/Mem:/{print $2"MB"}')"; for t in python3 pip3 node npm git curl gcc make; do command -v $t >/dev/null 2>&1 && printf "%s " $t; done; echo`

export interface SandboxHandle { sb: ChatSandbox; fresh: boolean; asleep?: boolean }

/** Returns the chat's VM (waking it if paused), creating a fresh one if none exists or it expired. */
export async function ensureSandbox(chatId: string, signal?: AbortSignal, wake = true): Promise<SandboxHandle> {
  const st = useStore.getState()
  const chat = st.chats.find((c) => c.id === chatId)
  if (!chat) throw new SandboxError('Chat not found.')
  const c = cfg()

  if (chat.sandbox) {
    try {
      const d = await json<VmData>('GET', `/v5/vms/${chat.sandbox.vmId}`, { signal })
      if (d.state === 'running') { setState(chatId, 'active'); return { sb: chat.sandbox, fresh: false } }
      if (!wake) { setState(chatId, toState(d.state)); return { sb: chat.sandbox, fresh: false, asleep: true } } // reading files works while paused
      setState(chatId, 'waking')
      await waitRunning(chat.sandbox.vmId, signal)
      setState(chatId, 'active')
      return { sb: chat.sandbox, fresh: false }
    } catch (e: any) {
      if (e?.name === 'AbortError') throw e
      if (e?.status !== 404 && e?.status !== 410) throw e
      // the VM is gone (deleted or expired): fall through and make a new one
    }
  }

  const slug = `koko-${chatId.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 8)}-${uid().slice(0, 5)}`.toLowerCase()
  const body: Record<string, unknown> = {
    firewall: { rules: [{ action: 'allow', source: {}, destination: { public: true } }] },
    slug,
    metadata: { app: 'kokochat', chat: chatId.slice(0, 24) },
  }
  if (c.settings.idleMinutes > 0) body.idleTimeoutSeconds = Math.round(c.settings.idleMinutes * 60)
  if (c.settings.ttlHours > 0) body.ttlSeconds = Math.round(c.settings.ttlHours * 3600)
  if (c.settings.snapshotId.trim()) body.snapshotId = c.settings.snapshotId.trim()
  setState(chatId, 'waking')
  const vm = await json<VmData>('POST', '/v5/vms', { json: body, signal })
  await waitRunning(vm.id, signal)
  setState(chatId, 'active')

  const sb: ChatSandbox = { vmId: vm.id, slug: vm.slug ?? slug, createdAt: Date.now() }
  try {
    const r = await rawExec(sb.vmId, PROBE, 30_000, undefined, signal)
    sb.info = (r.stdout ?? '').trim()
    sb.home = /home=(\S+)/.exec(sb.info)?.[1]
  } catch { /* probe is best effort */ }
  useStore.getState().setSandbox(chatId, sb)
  return { sb, fresh: true }
}

export async function deleteSandbox(sb: ChatSandbox) {
  try { await raw('DELETE', `/v5/vms/${sb.vmId}`) } catch (e: any) { if (e?.status !== 404) throw e }
}

/* -------------------------------- exec -------------------------------- */
export interface ExecResult { stdout?: string | null; stderr?: string | null; statusCode?: number | null }

async function rawExec(vmId: string, command: string, timeoutMs: number, env?: Record<string, string>, signal?: AbortSignal): Promise<ExecResult> {
  return json<ExecResult>('POST', `/v5/vms/${vmId}/exec-await`, { json: { command, timeoutMs, ...(env && Object.keys(env).length ? { env } : {}) }, signal })
}

export async function execInSandbox(chatId: string, command: string, o: { timeoutSeconds?: number; workdir?: string; env?: Record<string, string> }, signal?: AbortSignal) {
  const { sb, fresh } = await ensureSandbox(chatId, signal)
  const timeoutMs = Math.min(300, Math.max(1, o.timeoutSeconds ?? 60)) * 1000
  const full = o.workdir ? `mkdir -p ${shq(o.workdir)} && cd ${shq(o.workdir)} && ${command}` : command
  const t0 = Date.now()
  const r = await rawExec(sb.vmId, full, timeoutMs, o.env, signal)
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  const out = [
    fresh ? `[A new sandbox was created for this chat: ${sb.info ?? 'Linux VM'}]\n` : '',
    r.stdout ? `STDOUT:\n${clipText(r.stdout)}` : '',
    r.stderr ? `STDERR:\n${clipText(r.stderr)}` : '',
    r.statusCode === null || r.statusCode === undefined ? `(killed: timed out after ${timeoutMs / 1000}s. Run long jobs in the background with nohup … & and poll their log.)` : `exit code: ${r.statusCode} (${secs}s)`,
  ].filter(Boolean).join('\n')
  return { output: out, exitCode: r.statusCode ?? null, fresh }
}

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

/* -------------------------------- files ------------------------------- */
const sha256Hex = async (b: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b as BufferSource))].map((x) => x.toString(16).padStart(2, '0')).join('')

function resolvePath(sb: ChatSandbox, p: string) {
  if (p.startsWith('~/')) return (sb.home ?? '/root') + p.slice(1)
  if (!p.startsWith('/')) return `${sb.home ?? '/root'}/${p}`
  return p
}

export async function writeSandboxFile(chatId: string, path: string, content: string, executable = false, signal?: AbortSignal) {
  const { sb } = await ensureSandbox(chatId, signal)
  const abs = resolvePath(sb, path)
  const bytes = new TextEncoder().encode(content)
  if (bytes.length > 8 * 1024 * 1024) throw new SandboxError('File is larger than 8 MB.')
  const put = async () => raw('PUT', `/v5/vms/${sb.vmId}/fs/write`, {
    query: { path: abs, ...(executable ? { mode: '493' } : {}), sha256: await sha256Hex(bytes) },
    body: bytes as BodyInit, headers: { 'Content-Type': 'application/octet-stream' }, signal,
  })
  try { await put() } catch (e: any) {
    if (e?.name === 'AbortError') throw e
    // most likely the parent directory is missing
    const dir = abs.slice(0, abs.lastIndexOf('/')) || '/'
    await rawExec(sb.vmId, `mkdir -p ${shq(dir)}`, 15_000, undefined, signal)
    await put()
  }
  return { path: abs, bytes: bytes.length }
}

export async function readSandboxBytes(chatId: string, path: string, signal?: AbortSignal) {
  const { sb } = await ensureSandbox(chatId, signal, false) // files can be read while the VM sleeps
  const abs = resolvePath(sb, path)
  const res = await raw('GET', `/v5/vms/${sb.vmId}/fs/read`, { query: { path: abs }, signal })
  return { path: abs, bytes: new Uint8Array(await res.arrayBuffer()) }
}

export async function readSandboxText(chatId: string, path: string, signal?: AbortSignal) {
  const { path: abs, bytes } = await readSandboxBytes(chatId, path, signal)
  return { path: abs, text: new TextDecoder().decode(bytes), size: bytes.length }
}

/* ------------------------------- deploy ------------------------------- */
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40)

export async function exposePort(chatId: string, port: number, name: string | undefined, signal?: AbortSignal) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new SandboxError('Port must be between 1 and 65535.')
  const { sb } = await ensureSandbox(chatId, signal)
  const existing = sb.urls?.find((u) => u.port === port)
  const probe = async () => {
    const r = await rawExec(sb.vmId, `curl -s -o /dev/null -m 5 -w "%{http_code}" http://127.0.0.1:${port}/ || echo none`, 15_000, undefined, signal).catch(() => null)
    return (r?.stdout ?? '').trim() || 'unknown'
  }
  if (existing) return { url: existing.url, listening: await probe(), reused: true }

  const base = slugify(name || `${sb.slug}-${port}`) || `koko-${port}`
  let lastErr: unknown
  for (let i = 0; i < 4; i++) {
    const sub = i === 0 ? base : `${base}-${uid().slice(0, 4)}`
    try {
      await json('POST', '/v5/tls', { json: { action: 'allow', domain: `${sub}.style.dev`, source: { public: true }, destination: { vmId: sb.vmId, port } }, signal })
      const url = `https://${sub}.style.dev`
      useStore.getState().setSandbox(chatId, { ...sb, urls: [...(sb.urls ?? []), { port, url }] })
      return { url, listening: await probe(), reused: false }
    } catch (e: any) {
      lastErr = e
      if (e?.status && e.status !== 400 && e.status !== 409) throw e // only retry name collisions
    }
  }
  throw lastErr
}

/* ------------------------------ artifacts ----------------------------- */
const IMG: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }
const LANG: Record<string, string> = { py: 'python', js: 'javascript', ts: 'typescript', tsx: 'tsx', jsx: 'jsx', json: 'json', sh: 'bash', rs: 'rust', go: 'go', java: 'java', c: 'c', cpp: 'cpp', css: 'css', sql: 'sql', yml: 'yaml', yaml: 'yaml', toml: 'toml', csv: 'csv', txt: 'text' }

export async function sandboxFileToArtifact(chatId: string, path: string, title: string | undefined, kind: string | undefined, signal?: AbortSignal): Promise<Artifact> {
  const { path: abs, bytes } = await readSandboxBytes(chatId, path, signal)
  const ext = abs.split('.').pop()?.toLowerCase() ?? ''
  const name = abs.split('/').pop() ?? 'file'
  const t = title?.trim() || name
  if (IMG[ext] || kind === 'image') {
    if (bytes.length > 6 * 1024 * 1024) throw new SandboxError('Image is larger than 6 MB.')
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    let dataUrl = `data:${IMG[ext] ?? 'image/png'};base64,${btoa(bin)}`
    if (dataUrl.length > 300_000) dataUrl = await recompressImage(dataUrl, { maxSide: 2048, quality: 0.92 })
    return { id: uid(), title: t, kind: 'image', content: dataUrl, version: 1 }
  }
  const text = new TextDecoder().decode(bytes)
  if (text.length > 600_000) throw new SandboxError('File is too large to show as an artifact (over 600 KB).')
  const k = kind && ['html', 'svg', 'markdown', 'code', 'chart', 'diagram'].includes(kind) ? kind : ext === 'html' || ext === 'htm' ? 'html' : ext === 'svg' ? 'svg' : ext === 'md' || ext === 'markdown' ? 'markdown' : 'code'
  return { id: uid(), title: t, kind: k as Artifact['kind'], language: k === 'code' ? LANG[ext] ?? ext : undefined, content: text, version: 1 }
}
