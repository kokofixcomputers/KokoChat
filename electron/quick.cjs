'use strict'
// Quick ask: a global shortcut opens a small floating box on top of whatever you are doing. Type and press Enter, or capture an
// area of the screen to send with your message. The question is handed to the main window, which starts a new chat with it.
const { app, BrowserWindow, globalShortcut, ipcMain, screen, desktopCapturer, systemPreferences, shell, Tray, Menu, nativeImage } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const DEFAULTS = { enabled: true, shortcut: 'CommandOrControl+Shift+Space', menuBar: true }
let cfg = { ...DEFAULTS }
let ctx = null // { preload, url(query), getMain, showMain }
let quickWin = null
let overlay = null
let capturing = false
let registered = ''
let tray = null
let lastHide = 0
let closing = null // the timer that hides the box once its closing animation has played
const isOpen = () => !!quickWin && quickWin.isVisible() && !closing
const canFade = process.platform === 'darwin' || process.platform === 'win32'

const file = () => path.join(app.getPath('userData'), 'quick.json')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function loadCfg() { try { cfg = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) } } catch { cfg = { ...DEFAULTS } } }
function saveCfg() { try { fs.writeFileSync(file(), JSON.stringify(cfg)) } catch { /* read-only profile */ } }

function child(opts) {
  return new BrowserWindow({ ...opts, webPreferences: { preload: ctx.preload, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } })
}

function createQuickWindow() {
  // On macOS a "panel" takes your typing without bringing Koko to the front, so closing it leaves you where you were
  // (an ordinary window activates the app, and closing it then raised Koko's main window).
  quickWin = child({ ...(process.platform === 'darwin' ? { type: 'panel' } : {}), width: 720, height: 220, show: false, frame: false, transparent: true, resizable: false, movable: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: false, fullscreenable: false, minimizable: false, maximizable: false, backgroundColor: '#00000000', title: 'Koko quick ask' })
  quickWin.setAlwaysOnTop(true, 'screen-saver')
  // follow you to whichever desktop you are on. (Not visibleOnFullScreen: on macOS that turns Koko into a background app and removes it from the Dock.)
  if (process.platform === 'darwin') quickWin.setVisibleOnAllWorkspaces(true)
  quickWin.loadURL(ctx.url('quick=1'))
  quickWin.on('blur', () => { if (!capturing && quickWin && !quickWin.webContents.isDevToolsOpened()) hideQuick() })
  quickWin.on('closed', () => { quickWin = null })
}

/** Open the box: centred near the top of the screen, or dropped from the menu bar icon when it was opened from there. */
function showQuick(anchor) {
  if (closing) { clearTimeout(closing); closing = null }
  if (!quickWin) createQuickWindow()
  const point = screen.getCursorScreenPoint()
  const d = screen.getDisplayNearestPoint(anchor ? { x: anchor.x, y: anchor.y } : point)
  const [w] = quickWin.getSize()
  if (anchor) {
    const x = Math.min(Math.max(Math.round(anchor.x + anchor.width / 2 - w / 2), d.workArea.x + 6), d.workArea.x + d.workArea.width - w - 6)
    quickWin.setPosition(x, Math.round(Math.max(anchor.y + anchor.height, d.workArea.y) - 14))
  } else quickWin.setPosition(Math.round(d.workArea.x + (d.workArea.width - w) / 2), Math.round(d.workArea.y + d.workArea.height * 0.2))
  quickWin.show(); quickWin.focus()
  quickWin.webContents.send('koko:quick:show')
}
function hideQuick(now) {
  if (!isOpen()) return
  lastHide = Date.now()
  const done = () => { closing = null; if (quickWin) quickWin.hide() }
  if (now === true) return done()
  quickWin.webContents.send('koko:quick:hiding')
  closing = setTimeout(done, 140)
}
const toggle = () => (isOpen() ? hideQuick() : showQuick())

/* ------------------------------ menu bar / tray icon ------------------------------ */
function syncTray() {
  if (!cfg.menuBar) { if (tray) { tray.destroy(); tray = null } return }
  if (tray) return
  const img = process.platform === 'darwin'
    ? nativeImage.createFromPath(path.join(__dirname, 'assets', 'trayTemplate.png'))
    : nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png')).resize({ width: 18, height: 18 })
  if (process.platform === 'darwin') img.setTemplateImage(true)
  tray = new Tray(img)
  tray.setToolTip('Koko: quick ask')
  const menu = () => Menu.buildFromTemplate([
    { label: 'Quick ask', accelerator: cfg.shortcut || undefined, registerAccelerator: false, click: () => showQuick(tray && tray.getBounds()) },
    { label: 'Open Koko', click: () => ctx.showMain() },
    { type: 'separator' },
    { label: 'Quit Koko', role: 'quit' },
  ])
  // clicking the icon first takes focus from the box (which closes it), so a click right after a close means "close"
  tray.on('click', () => { if (isOpen()) hideQuick(); else if (Date.now() - lastHide > 300) showQuick(tray.getBounds()) })
  tray.on('right-click', () => tray.popUpContextMenu(menu()))
}

/** (Re)register the global shortcut. Returns an error message if the system refused it. */
function register() {
  if (registered) { try { globalShortcut.unregister(registered) } catch { /* ignore */ } registered = '' }
  if (!cfg.enabled || !cfg.shortcut) return null
  try {
    if (!globalShortcut.register(cfg.shortcut, toggle)) return 'Another app is already using that shortcut.'
    registered = cfg.shortcut
    return null
  } catch (e) { return 'That is not a valid shortcut.' }
}

/* ------------------------------ capturing an area ------------------------------ */
async function captureArea() {
  if (capturing) return { error: 'busy' }
  const point = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(point)
  if (process.platform === 'darwin') {
    const st = systemPreferences.getMediaAccessStatus('screen')
    if (st !== 'granted') {
      try { await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 8, height: 8 } }) } catch { /* triggers the system prompt */ }
      return { error: 'permission' }
    }
  }
  capturing = true
  try {
    // Make the quick-ask box invisible instead of hiding it: hiding makes macOS bring Koko's main window to the front,
    // and that window would then be what gets captured. (Linux cannot do opacity, so it hides.)
    if (canFade) { quickWin.setIgnoreMouseEvents(true); quickWin.setOpacity(0) } else hideQuick(true)
    await sleep(220)
    const scale = display.scaleFactor || 1
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(display.size.width * scale), height: Math.round(display.size.height * scale) } })
    const src = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0]
    const img = src && src.thumbnail
    if (!img || img.isEmpty()) return { error: 'permission' }

    overlay = child({ x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height, frame: false, transparent: false, backgroundColor: '#000000', alwaysOnTop: true, skipTaskbar: true, resizable: false, movable: false, fullscreenable: false, hasShadow: false, show: false, enableLargerThanScreen: true })
    overlay.setAlwaysOnTop(true, 'screen-saver')
    const result = await new Promise((resolve) => {
      const done = (rect) => { cleanup(); resolve(rect) }
      const onReady = (e) => { if (e.sender === overlay.webContents) { e.sender.send('koko:select:image', { dataUrl: 'data:image/jpeg;base64,' + img.toJPEG(90).toString('base64') }); overlay.show(); overlay.focus() } }
      const onDone = (e, rect) => { if (e.sender === overlay.webContents) done(rect) }
      const cleanup = () => { ipcMain.removeListener('koko:select:ready', onReady); ipcMain.removeListener('koko:select:done', onDone) }
      ipcMain.on('koko:select:ready', onReady)
      ipcMain.on('koko:select:done', onDone)
      overlay.on('closed', () => done(null))
      overlay.loadURL(ctx.url('select=1'))
    })
    if (overlay && !overlay.isDestroyed()) overlay.destroy()
    overlay = null
    if (!result || !(result.w > 4 && result.h > 4)) return { cancelled: true }
    const size = img.getSize()
    const f = size.width / display.bounds.width
    let crop = img.crop({ x: Math.max(0, Math.round(result.x * f)), y: Math.max(0, Math.round(result.y * f)), width: Math.max(1, Math.round(result.w * f)), height: Math.max(1, Math.round(result.h * f)) })
    const cs = crop.getSize()
    if (cs.width > 2200) crop = crop.resize({ width: 2200 })
    return { dataUrl: 'data:image/png;base64,' + crop.toPNG().toString('base64'), width: cs.width, height: cs.height }
  } catch (e) {
    return { error: String((e && e.message) || e) }
  } finally {
    capturing = false
    if (overlay && !overlay.isDestroyed()) overlay.destroy()
    overlay = null
    if (quickWin) { if (canFade) { quickWin.setOpacity(1); quickWin.setIgnoreMouseEvents(false) } quickWin.show(); quickWin.focus() }
  }
}

/* ------------------------------------ setup ------------------------------------ */
function init(c) {
  ctx = c
  loadCfg()
  const ownQuick = (e) => quickWin && e.sender === quickWin.webContents
  ipcMain.on('koko:quick:hide', (e) => { if (ownQuick(e)) hideQuick() })
  ipcMain.on('koko:quick:resize', (e, h) => { if (ownQuick(e) && quickWin) { const [w] = quickWin.getSize(); quickWin.setSize(w, Math.max(120, Math.min(640, Math.round(h)))) } })
  ipcMain.on('koko:quick:submit', (e, payload) => {
    if (!ownQuick(e) || !payload || typeof payload !== 'object') return
    hideQuick()
    ctx.showMain()
    const main = ctx.getMain()
    if (!main) return
    const send = () => main.webContents.send('koko:quick:submit', payload)
    if (main.webContents.isLoading()) main.webContents.once('did-finish-load', () => setTimeout(send, 600)); else send()
  })
  ipcMain.handle('koko:quick:capture', (e) => (ownQuick(e) ? captureArea() : { error: 'denied' }))
  ipcMain.handle('koko:quick:open-screen-settings', () => { if (process.platform === 'darwin') shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture') })
  ipcMain.handle('koko:quick:get', () => ({ ...cfg, registered: !!registered, defaultShortcut: DEFAULTS.shortcut }))
  ipcMain.handle('koko:quick:set', (e, patch) => {
    if (!patch || typeof patch !== 'object') return { ...cfg, registered: !!registered }
    if (typeof patch.enabled === 'boolean') cfg.enabled = patch.enabled
    if (typeof patch.shortcut === 'string' && patch.shortcut.length < 60) cfg.shortcut = patch.shortcut
    if (typeof patch.menuBar === 'boolean') cfg.menuBar = patch.menuBar
    syncTray()
    const error = register()
    saveCfg()
    return { ...cfg, registered: !!registered, error }
  })
  app.on('will-quit', () => globalShortcut.unregisterAll())
  register()
  syncTray()
}

module.exports = { init, show: showQuick }
