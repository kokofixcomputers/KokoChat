'use strict'
// Real terminals for the side panel: one pseudo-terminal per tab, streamed to the window that opened it.
const os = require('node:os')
const fs = require('node:fs')
const tools = require('./tools.cjs')

let nodePty = null
const load = () => {
  if (!nodePty) {
    // npm and the packager can drop the executable bit on node-pty's helper, which makes every spawn fail
    try {
      const path = require('node:path')
      const base = path.join(path.dirname(require.resolve('node-pty/package.json')).replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep), 'prebuilds')
      for (const d of fs.readdirSync(base)) { const h = path.join(base, d, 'spawn-helper'); if (fs.existsSync(h)) fs.chmodSync(h, 0o755) }
    } catch { /* not on this platform */ }
    nodePty = require('node-pty')
  }
  return nodePty
}
const terms = new Map()

function open({ id, cwd, cols, rows }, sender) {
  if (terms.has(id)) return { reused: true }
  const win = process.platform === 'win32'
  const dir = cwd && fs.existsSync(cwd) ? cwd : os.homedir()
  const shell = win ? process.env.ComSpec || 'powershell.exe' : process.env.SHELL || '/bin/zsh'
  const env = { ...process.env, ...(tools.getShellEnv() || {}), TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'Koko' }
  const p = load().spawn(shell, win ? [] : ['-il'], { name: 'xterm-256color', cols: Math.max(2, cols | 0 || 80), rows: Math.max(2, rows | 0 || 24), cwd: dir, env })
  terms.set(id, p)
  const send = (ch, payload) => { try { if (!sender.isDestroyed()) sender.send(ch, payload) } catch { /* window closed */ } }
  p.onData((data) => send('koko:pty:data', { id, data }))
  p.onExit(({ exitCode }) => { terms.delete(id); send('koko:pty:exit', { id, code: exitCode }) })
  return { pid: p.pid, shell: shell.split(/[\\/]/).pop() }
}

const write = ({ id, data }) => { terms.get(id)?.write(String(data)) }
const resize = ({ id, cols, rows }) => { try { terms.get(id)?.resize(Math.max(2, cols | 0), Math.max(2, rows | 0)) } catch { /* already gone */ } }
const kill = ({ id }) => { const p = terms.get(id); if (p) { terms.delete(id); try { p.kill() } catch { /* gone */ } } }
const killAll = () => { for (const id of [...terms.keys()]) kill({ id }) }

module.exports = { open, write, resize, kill, killAll }
