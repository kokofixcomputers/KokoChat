'use strict'
// System notifications for the app window. Buttons on a notification (Allow / Deny) are reported back to the page by id.
const { Notification, BrowserWindow } = require('electron')

const open = new Map()

function show(sender, p) {
  if (!p || typeof p.id !== 'string' || !Notification.isSupported()) return false
  close(p.id)
  const actions = Array.isArray(p.actions) ? p.actions.slice(0, 2).map((t) => ({ type: 'button', text: String(t).slice(0, 24) })) : []
  const n = new Notification({
    title: String(p.title || 'Koko').slice(0, 120),
    body: String(p.body || '').slice(0, 300),
    silent: p.sound === false,
    ...(actions.length ? { actions, timeoutType: 'never' } : {}),
  })
  const send = (event) => { try { if (!sender.isDestroyed()) sender.send('koko:notify:event', { id: p.id, ...event }) } catch { /* window closed */ } }
  n.on('click', () => {
    const w = BrowserWindow.fromWebContents(sender)
    if (w && !w.isDestroyed()) { if (w.isMinimized()) w.restore(); w.show(); w.focus() }
    send({ type: 'click' })
  })
  n.on('action', (_e, index) => send({ type: 'action', index }))
  n.on('close', () => { if (open.get(p.id) === n) open.delete(p.id) })
  open.set(p.id, n)
  n.show()
  return true
}

function close(id) {
  const n = open.get(id)
  if (!n) return
  open.delete(id)
  try { n.close() } catch { /* already gone */ }
}

function register(ipcMain) {
  ipcMain.handle('koko:notify:show', (e, p) => show(e.sender, p))
  ipcMain.on('koko:notify:close', (_e, id) => close(String(id)))
}

module.exports = { register, show, close, _open: open }
