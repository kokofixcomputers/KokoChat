function ({ x, y, double }) {
  const el = document.elementFromPoint(x, y)
  if (!el) return false
  const o = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0 }
  const fire = (type, extra) => el.dispatchEvent(new (type.startsWith('pointer') ? PointerEvent : MouseEvent)(type, { ...o, ...extra }))
  for (let n = 1; n <= (double ? 2 : 1); n++) {
    fire('pointerover'); fire('mouseover'); fire('mousemove')
    fire('pointerdown', { detail: n, buttons: 1 })
    const go = fire('mousedown', { detail: n, buttons: 1 })
    if (go) { const f = el.closest('input,textarea,select,button,a[href],[tabindex],[contenteditable=""],[contenteditable=true]'); if (f) f.focus(); else document.activeElement?.blur?.() }
    fire('pointerup', { detail: n })
    fire('mouseup', { detail: n })
    fire('click', { detail: n })
  }
  if (double) fire('dblclick', { detail: 2 })
  return true
}
