'use strict'
// Export mode (KOKO_EXPORT=<file>): write everything this app has saved to one JSON file and quit, so the Rust app can
// take it over. The app's own code never loads, so nothing is changed. The file holds your API keys: it is created
// readable only by you, and the Rust app deletes it as soon as it has read it.
const { app, BrowserWindow, protocol } = require('electron')
const fs = require('node:fs')

// runs inside a blank page on the app's own origin
async function dump() {
  const toB64 = (buf) => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s) }
  // JSON cannot hold files or binary data, so tag them
  const pack = async (v) => {
    if (v instanceof Blob) return { __koko: 'blob', type: v.type, data: toB64(await v.arrayBuffer()) }
    if (v instanceof ArrayBuffer) return { __koko: 'buffer', data: toB64(v) }
    if (ArrayBuffer.isView(v)) return { __koko: 'view', kind: v.constructor.name, data: toB64(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)) }
    if (v instanceof Date) return { __koko: 'date', time: v.getTime() }
    if (v instanceof Map) return { __koko: 'map', entries: await pack([...v]) }
    if (v instanceof Set) return { __koko: 'set', values: await pack([...v]) }
    if (Array.isArray(v)) return Promise.all(v.map(pack))
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = await pack(v[k]); return o }
    return v
  }
  const wait = (q) => new Promise((res, rej) => { q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error) })
  const open = indexedDB.open('keyval-store')
  open.onupgradeneeded = () => open.result.createObjectStore('keyval')
  const db = await wait(open)
  const store = db.transaction('keyval').objectStore('keyval')
  const [keys, values] = await Promise.all([wait(store.getAllKeys()), wait(store.getAll())])
  const idb = []
  for (let i = 0; i < keys.length; i++) idb.push([keys[i], await pack(values[i])])
  const local = {}
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); local[k] = localStorage.getItem(k) }
  return JSON.stringify({ format: 'koko-export', version: 1, idb, local })
}

async function run(out) {
  protocol.handle('app', () => new Response('<!doctype html><title>export</title>', { headers: { 'content-type': 'text/html' } }))
  const w = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } })
  try {
    await w.loadURL('app://koko/__export')
    const json = await w.webContents.executeJavaScript(`(${dump.toString()})()`)
    fs.rmSync(out, { force: true })
    fs.writeFileSync(out, json, { mode: 0o600, flag: 'wx' })
    app.exit(0)
  } catch (e) {
    console.error(String((e && e.stack) || e))
    app.exit(1)
  }
}

module.exports = { run }
