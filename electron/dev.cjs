'use strict'
// Starts the Vite dev server, waits for it, then opens the app window pointed at it.
const { spawn } = require('node:child_process')
const net = require('node:net')
const path = require('node:path')
const root = path.join(__dirname, '..')
const vite = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', '--port', '5173', '--strictPort'], { cwd: root, stdio: 'inherit' })
const wait = () => new Promise((res) => { const t = () => { const s = net.connect(5173, '127.0.0.1'); s.on('connect', () => { s.destroy(); res() }); s.on('error', () => setTimeout(t, 300)) }; t() })
wait().then(() => {
  const electron = require('electron')
  const app = spawn(electron, ['.', '--dev'], { cwd: root, stdio: 'inherit' })
  app.on('close', () => { vite.kill(); process.exit(0) })
})
process.on('SIGINT', () => { vite.kill(); process.exit(0) })
