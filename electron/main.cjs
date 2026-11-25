'use strict'
const { app, BrowserWindow, protocol, net, ipcMain, dialog, shell, session, Menu } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')
const tools = require('./tools.cjs')
const term = require('./pty.cjs')
const browserCtl = require('./browser.cjs')
const cp = require('./checkpoints.cjs')
const quick = require('./quick.cjs')
const notifier = require('./notify.cjs')
const oauth = require('./oauth.cjs')

const DEV_URL = process.env.KOKO_DEV_URL || (process.argv.includes('--dev') ? 'http://localhost:5173' : '')
const DIST = path.join(__dirname, '..', 'dist')

// the bundled app is served from app://koko so absolute paths like /providers/x.svg keep working
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }])

if (!app.requestSingleInstanceLock()) app.quit()

let win = null
let quitting = false
let busy = 0 // agents currently running, reported by the renderer
// Ask before closing while agents are still working. The question is shown by the app window itself (a modal);
// the window answers through 'koko:close-answer'. Returns true only when nothing is running.
let asking = false
function confirmClose() {
  if (!busy || process.env.KOKO_SMOKE) return true
  if (!win || win.isDestroyed()) return true
  if (!asking) {
    asking = true
    if (!win.isVisible()) win.show()
    win.focus()
    win.webContents.send('koko:close-request', busy)
  }
  return false
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 880, minWidth: 760, minHeight: 520,
    title: 'Koko',
    backgroundColor: '#0d0d0e',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    show: false,
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 16 } } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true, backgroundThrottling: false, webviewTag: true },
  })
  // the side panel's browser tabs are <webview>s: no Node access, web pages only, links that want a new window become new tabs
  win.webContents.on('will-attach-webview', (_e, prefs, params) => {
    delete prefs.preload; delete prefs.preloadURL
    prefs.nodeIntegration = false; prefs.contextIsolation = true; prefs.sandbox = true; prefs.webSecurity = true
    prefs.partition = 'persist:koko-browser'
    if (!/^(https?:|about:blank)/i.test(params.src || 'about:blank')) params.src = 'about:blank'
  })
  win.webContents.on('did-attach-webview', (_e, wc) => {
    wc.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) win?.webContents.send('koko:browser:open', url); return { action: 'deny' } })
  })
  win.once('ready-to-show', () => win.show())
  win.loadURL(DEV_URL || 'app://koko/')
  // links open in the real browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' } })
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://') && !(DEV_URL && url.startsWith(DEV_URL))) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url) } })
  // on macOS closing the window only hides it, so scheduled co-worker jobs keep running; quitting really quits
  win.on('close', (e) => {
    if (!quitting && busy && !confirmClose()) return e.preventDefault()
    if (process.platform === 'darwin' && !quitting && !process.env.KOKO_SMOKE) { e.preventDefault(); win.hide() }
  })
  win.on('closed', () => { win = null; if (process.platform !== 'darwin') app.quit() })
}

function serveApp() {
  protocol.handle('app', (req) => {
    const url = new URL(req.url)
    let file = path.normalize(path.join(DIST, decodeURIComponent(url.pathname)))
    if (!file.startsWith(DIST)) return new Response('Forbidden', { status: 403 })
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html') // single-page app
    return net.fetch(pathToFileURL(file).toString())
  })
}

/** A desktop app that brings its own API keys talks to many providers; not all of them send CORS headers, so add them here. */
function relaxCors() {
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    if (details.url.startsWith('app://') || details.url.startsWith('devtools://') || (DEV_URL && details.url.startsWith(DEV_URL))) return cb({})
    const h = { ...details.responseHeaders }
    for (const k of Object.keys(h)) if (/^access-control-/i.test(k)) delete h[k]
    h['Access-Control-Allow-Origin'] = ['*']
    h['Access-Control-Allow-Headers'] = ['*']
    h['Access-Control-Allow-Methods'] = ['GET, POST, PUT, PATCH, DELETE, OPTIONS']
    h['Access-Control-Expose-Headers'] = ['*']
    cb(details.method === 'OPTIONS' ? { responseHeaders: h, statusLine: 'HTTP/1.1 204 No Content' } : { responseHeaders: h })
  })
}

/** Run a tool and return {ok, data} or {ok:false, error} (errors thrown through IPC lose their codes). */
const wrap = (fn) => async (_e, args) => {
  try { return { ok: true, data: await fn(args || {}) } }
  catch (err) { return { ok: false, error: { message: String(err && err.message || err), code: err && err.code || 'ERR' } } }
}

function registerIpc() {
  ipcMain.handle('koko:pick-folder', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose a project folder', properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.on('koko:close-answer', (_e, ok) => { asking = false; if (ok) { busy = 0; quitting = true; app.quit() } })
  ipcMain.on('koko:busy', (_e, n) => { busy = Math.max(0, Number(n) || 0) })
  ipcMain.handle('koko:reveal', (_e, p) => { if (typeof p === 'string') shell.showItemInFolder(p) })
  ipcMain.handle('koko:open-folder', (_e, p) => { if (typeof p === 'string') return shell.openPath(p) })
  ipcMain.handle('koko:fs:read', wrap(tools.readFile))
  // file changes by the agent are saved per turn first, so the whole turn can be undone
  const tracked = (fn) => async (a) => {
    if (!a || !a.turn) return fn(a)
    const { abs } = tools.resolveIn(a.cwd, a.path, a.allowOutside)
    await cp.before(a.turn, abs)
    try { return await fn(a) } finally { await cp.after(a.turn, abs) }
  }
  ipcMain.handle('koko:fs:write', wrap(tracked(tools.writeFile)))
  ipcMain.handle('koko:fs:edit', wrap(tracked(tools.editFile)))
  ipcMain.handle('koko:fs:write-base64', wrap(tracked(tools.writeBase64)))
  ipcMain.handle('koko:fs:tree', wrap(tools.readTree))
  ipcMain.handle('koko:fs:readraw', wrap(tools.readRaw))
  ipcMain.handle('koko:git:status', wrap(tools.gitStatus))
  ipcMain.handle('koko:git:diff', wrap(tools.gitDiff))
  for (const [n, f] of [['stage', tools.gitStage], ['unstage', tools.gitUnstage], ['discard', tools.gitDiscard], ['commit', tools.gitCommit], ['branches', tools.gitBranches], ['checkout', tools.gitCheckout], ['push', tools.gitPush], ['pull', tools.gitPull], ['log', tools.gitLog], ['changes', tools.gitChangeText], ['branchchanges', tools.gitBranchChanges]]) ipcMain.handle('koko:git:' + n, wrap(f))
  ipcMain.handle('koko:checkpoint:info', wrap((a) => cp.info(String(a.key), a.cwd)))
  ipcMain.handle('koko:checkpoint:revert', wrap((a) => cp.revert(String(a.key), !!a.force)))
  ipcMain.handle('koko:fs:list', wrap(tools.listFiles))
  ipcMain.handle('koko:fs:find', wrap(tools.findFiles))
  ipcMain.handle('koko:fs:search', wrap(tools.searchCode))
  ipcMain.handle('koko:project:context', wrap(tools.projectContext))
  ipcMain.handle('koko:shell:run', (e, args) => wrap((a) => tools.runCommand({ ...a, onData: (chunk) => { try { e.sender.send('koko:shell:data', { id: a.id, chunk }) } catch { /* window closed */ } } }))(e, args))
  browserCtl.register(ipcMain)
  notifier.register(ipcMain)
  ipcMain.handle('koko:oauth:popup', (e, a) => oauth.popup(BrowserWindow.fromWebContents(e.sender), a || {}))
  ipcMain.handle('koko:pty:open', (e, a) => { try { return { ok: true, data: term.open(a || {}, e.sender) } } catch (err) { return { ok: false, error: { message: String(err && err.message || err), code: 'PTY' } } } })
  ipcMain.on('koko:pty:write', (_e, a) => term.write(a || {}))
  ipcMain.on('koko:pty:resize', (_e, a) => term.resize(a || {}))
  ipcMain.on('koko:pty:kill', (_e, a) => term.kill(a || {}))
  ipcMain.handle('koko:shell:kill', (_e, id) => tools.killCommand(String(id)))
}

app.setAppUserModelId('cc.kokodev.koko') // needed for notifications on Windows
app.whenReady().then(() => {
  cp.init(path.join(app.getPath('userData'), 'checkpoints'))
  serveApp()
  relaxCors()
  registerIpc()
  tools.loadShellEnv() // warm up your shell's PATH in the background
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null)
  else {
    // the app menu gets a Settings… item with the usual ⌘, shortcut (the rest keeps the standard Mac menus, so copy and paste still work)
    const openSettings = () => { if (!win) createWindow(); if (win.isMinimized()) win.restore(); win.show(); win.focus(); const send = () => win.webContents.send('koko:open-settings'); if (win.webContents.isLoading()) win.webContents.once('did-finish-load', () => setTimeout(send, 400)); else send() }
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Settings…', accelerator: 'Command+,', click: openSettings }, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
      { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
    ]))
  }
  quick.init({
    preload: path.join(__dirname, 'preload.cjs'),
    url: (q) => (DEV_URL ? `${DEV_URL}/?${q}` : `app://koko/?${q}`),
    getMain: () => win,
    showMain: () => { if (!win) createWindow(); if (win.isMinimized()) win.restore(); win.show(); win.focus() },
  })
  createWindow()
  if (process.env.KOKO_SMOKE) setTimeout(() => app.quit(), 4000)
  app.on('activate', () => { if (win) win.show(); else createWindow() })
})
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus() } })
app.on('before-quit', (e) => { if (!quitting && busy && !confirmClose()) return e.preventDefault(); quitting = true; term.killAll() })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
