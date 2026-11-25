'use strict'
// Lets the agent drive the side panel's browser tabs (they are <webview> guests of the app window).
// Only guests that belong to the window that asks can be controlled, and only through these few operations.
const { webContents } = require('electron')

function guest(e, id) {
  const wc = webContents.fromId(Number(id))
  if (!wc || wc.isDestroyed() || wc.getType() !== 'webview' || !wc.hostWebContents || wc.hostWebContents.id !== e.sender.id) throw new Error('That browser tab is not available.')
  return wc
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const KEYS = { Enter: 'Return', Return: 'Return', Tab: 'Tab', Escape: 'Escape', Esc: 'Escape', Backspace: 'Backspace', Delete: 'Delete', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Up: 'Up', Down: 'Down', Left: 'Left', Right: 'Right', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Space: 'Space', ' ': 'Space' }

const ops = {
  exec: async (wc, { code }) => wc.executeJavaScript(String(code), true),

  shot: async (wc) => {
    const img = await wc.capturePage()
    const { width, height } = img.getSize()
    if (!width || !height) throw new Error('The page has nothing to show yet (is the browser tab visible?).')
    const big = width > 1280 ? img.resize({ width: 1280 }) : img
    const small = img.resize({ width: Math.min(520, width) })
    return { dataUrl: 'data:image/jpeg;base64,' + big.toJPEG(80).toString('base64'), thumb: 'data:image/jpeg;base64,' + small.toJPEG(60).toString('base64'), width, height }
  },

  click: async (wc, { x, y, double }) => {
    x = Math.round(x); y = Math.round(y)
    wc.sendInputEvent({ type: 'mouseMove', x, y })
    for (let n = 1; n <= (double ? 2 : 1); n++) {
      wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: n })
      wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: n })
    }
    return true
  },

  text: async (wc, { text }) => { await wc.insertText(String(text)); return true },

  key: async (wc, { key, modifiers }) => {
    const code = KEYS[key] || (String(key).length === 1 ? String(key) : null)
    if (!code) throw new Error(`Unknown key "${key}". Use Enter, Tab, Escape, Backspace, Delete, ArrowUp/Down/Left/Right, Home, End, PageUp, PageDown, Space or a single character.`)
    const m = Array.isArray(modifiers) ? modifiers : []
    wc.sendInputEvent({ type: 'keyDown', keyCode: code, modifiers: m })
    if (code.length === 1 || code === 'Space' || code === 'Return') wc.sendInputEvent({ type: 'char', keyCode: code === 'Return' ? '\r' : code === 'Space' ? ' ' : code, modifiers: m })
    wc.sendInputEvent({ type: 'keyUp', keyCode: code, modifiers: m })
    return true
  },

  scroll: async (wc, { x = 200, y = 200, dx = 0, dy = 0 }) => {
    wc.sendInputEvent({ type: 'mouseWheel', x, y, deltaX: -dx, deltaY: -dy, canScroll: true })
    await sleep(120)
    return true
  },
}

function register(ipcMain) {
  ipcMain.handle('koko:browser', async (e, { op, id, args }) => {
    try {
      if (!ops[op]) throw new Error('Unknown browser operation')
      return { ok: true, data: await ops[op](guest(e, id), args || {}) }
    } catch (err) { return { ok: false, error: { message: String((err && err.message) || err), code: 'BROWSER' } } }
  })
}

module.exports = { register }
