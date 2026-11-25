/**
 * Drag a panel's edge. While dragging, a see-through sheet covers the window: without it the side panel's web page
 * (an Electron <webview>, or a native view in the Rust app, which hides when covered) swallows the mouse and the drag stalls.
 */
export function dragResize(e: React.PointerEvent, width: (clientX: number) => number, apply: (w: number) => void, saveAs: string) {
  if (e.button !== 0) return
  e.preventDefault()
  const sheet = document.createElement('div')
  sheet.style.cssText = 'position:fixed;inset:0;z-index:1000;cursor:col-resize;-webkit-app-region:no-drag'
  document.body.appendChild(sheet)
  let last = 0
  const move = (ev: PointerEvent) => { last = Math.round(width(ev.clientX)); apply(last) }
  const end = () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); window.removeEventListener('blur', end)
    sheet.remove()
    if (last) { try { localStorage.setItem(saveAs, String(last)) } catch { /* private mode */ } }
  }
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end); window.addEventListener('blur', end)
}

export const clampWidth = (w: number, min: number, max: number) => Math.min(Math.max(w, min), Math.max(min, max))
