'use strict'
// Undo for Code mode. Before the agent changes a file through its edit / write tools, the original is saved here,
// per "turn" (one assistant reply). Reverting puts every file of that turn back. Changes made by shell commands are not tracked.
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')

let root = ''
const locks = new Map()

const sha = (buf) => crypto.createHash('sha1').update(buf).digest('hex')
const safe = (s) => String(s).replace(/[^\w.-]+/g, '_').slice(0, 120)
const dirOf = (key) => path.join(root, safe(key))
const readOrNull = async (p) => { try { return await fsp.readFile(p) } catch { return null } }

function init(dir) {
  root = dir
  fs.mkdirSync(root, { recursive: true })
  // forget checkpoints older than two weeks
  const cutoff = Date.now() - 14 * 864e5
  try { for (const d of fs.readdirSync(root)) { const p = path.join(root, d); if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { recursive: true, force: true }) } } catch { /* ignore */ }
}

async function load(key) {
  try { return JSON.parse(await fsp.readFile(path.join(dirOf(key), 'manifest.json'), 'utf8')) } catch { return { files: {}, reverted: false, createdAt: Date.now() } }
}
const save = async (key, m) => { await fsp.mkdir(dirOf(key), { recursive: true }); await fsp.writeFile(path.join(dirOf(key), 'manifest.json'), JSON.stringify(m)) }

/** run one thing at a time per turn, so parallel tool calls cannot trample the manifest */
const serial = (key, fn) => { const prev = locks.get(key) ?? Promise.resolve(); const next = prev.then(fn, fn); locks.set(key, next.catch(() => {})); return next }

/** call before a file is changed */
const before = (key, abs) => serial(key, async () => {
  const m = await load(key)
  if (m.files[abs]) return
  const buf = await readOrNull(abs)
  const entry = { existed: buf !== null, origHash: buf ? sha(buf) : null }
  if (buf) { entry.backup = sha(Buffer.from(abs)) + '.bak'; await fsp.mkdir(dirOf(key), { recursive: true }); await fsp.writeFile(path.join(dirOf(key), entry.backup), buf) }
  m.files[abs] = entry
  await save(key, m)
})

/** call after it was changed: remembers what the agent left, so later edits by you can be noticed */
const after = (key, abs) => serial(key, async () => {
  const m = await load(key)
  if (!m.files[abs]) return
  const buf = await readOrNull(abs)
  m.files[abs].afterHash = buf ? sha(buf) : null
  await save(key, m)
})

const changed = (e, current) => (e.existed ? current === null || sha(current) !== e.origHash : current !== null)

async function info(key, cwd) {
  const m = await load(key)
  const files = []
  for (const [abs, e] of Object.entries(m.files)) {
    const cur = await readOrNull(abs)
    if (m.reverted || changed(e, cur)) files.push(cwd && abs.startsWith(cwd + path.sep) ? path.relative(cwd, abs) : abs)
  }
  return { files, reverted: !!m.reverted, count: m.reverted ? Object.keys(m.files).length : files.length }
}

async function revert(key, force) {
  const m = await load(key)
  if (m.reverted) return { restored: 0, deleted: 0, conflicts: [], already: true }
  const conflicts = []
  for (const [abs, e] of Object.entries(m.files)) {
    const cur = await readOrNull(abs)
    const now = cur ? sha(cur) : null
    if (e.afterHash !== undefined && now !== e.afterHash && changed(e, cur)) conflicts.push(abs)
  }
  if (conflicts.length && !force) return { restored: 0, deleted: 0, conflicts }
  let restored = 0, deleted = 0
  for (const [abs, e] of Object.entries(m.files)) {
    if (e.existed) {
      const buf = await readOrNull(path.join(dirOf(key), e.backup))
      if (buf === null) continue
      await fsp.mkdir(path.dirname(abs), { recursive: true })
      await fsp.writeFile(abs, buf); restored++
    } else if (fs.existsSync(abs)) { await fsp.rm(abs, { force: true }); deleted++ }
  }
  m.reverted = true
  await save(key, m)
  return { restored, deleted, conflicts: [] }
}

module.exports = { init, before, after, info, revert }
