'use strict'
// "Sign in" windows for OAuth: a small window shows the provider's page and hands back the code the moment the provider redirects
// to the registered address. That address is never actually loaded.
const { BrowserWindow, shell } = require('electron')

const okUrl = (u) => { try { const x = new URL(u); return x.protocol === 'https:' || (x.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(x.hostname)) } catch { return false } }

function popup(parent, { url, redirectUri }) {
  return new Promise((resolve) => {
    if (!okUrl(url) || !okUrl(redirectUri)) return resolve({ error: 'Only https addresses can be used for sign-in.' })
    const w = new BrowserWindow({
      width: 520, height: 760, title: 'Sign in', autoHideMenuBar: true, parent: parent || undefined, minimizable: false,
      webPreferences: { partition: 'persist:koko-oauth', contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    let done = false
    const finish = (r) => { if (done) return; done = true; resolve(r); if (!w.isDestroyed()) w.destroy() }
    const check = (e, u) => {
      if (typeof u !== 'string' || !u.startsWith(redirectUri)) return
      if (e && e.preventDefault) e.preventDefault()
      const q = new URL(u).searchParams
      finish({ code: q.get('code') || undefined, state: q.get('state') || undefined, error: q.get('error') || undefined })
    }
    const wc = w.webContents
    wc.on('will-redirect', (e, u) => check(e, typeof u === 'string' ? u : e.url))
    wc.on('will-navigate', (e, u) => check(e, typeof u === 'string' ? u : e.url))
    wc.setWindowOpenHandler(({ url: u }) => { if (/^https?:/i.test(u)) shell.openExternal(u); return { action: 'deny' } })
    w.on('closed', () => finish({ error: 'closed' }))
    w.loadURL(url).catch(() => finish({ error: 'Could not open the sign-in page.' }))
  })
}

module.exports = { popup }
